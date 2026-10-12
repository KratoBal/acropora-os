import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  BILLING_STORNABLE_TYPES,
  type AuthenticatedUser,
  type BillingDocumentDetail,
} from "@acropora/types";

import { budapestDayKey } from "../dashboard/budapest-day.js";
import { StubSzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent-stub.client.js";
import {
  HttpSzamlazzAgentClient,
  SzamlazzAgentHttpError,
  type SzamlazzAgentStornoClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { buildSzamlazzAgentStornoXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import { SzamlazzConnectionError } from "../integrations/szamlazz/szamlazz-connection.types.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  BILLING_ISSUE_ENV,
  httpsUrl,
  ISSUED_PDF,
} from "./billing-document-issue.service.js";
import { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { toBillingDocumentDetail } from "./billing-documents.service.js";
import { billingIssueMode } from "./billing-issue.config.js";

/** Injectable for tests: the Számlázz.hu storno client (a fake never calls out). */
export const BILLING_SZAMLAZZ_STORNO_CLIENT = Symbol(
  "BILLING_SZAMLAZZ_STORNO_CLIENT",
);

const negate = (value: Prisma.Decimal | null) =>
  value === null ? null : value.negated();

/**
 * A SZTORNÓ (számlázási brief, 1. pont; Balázs 2026-10-12 09:44 UTC „Mehet”).
 * A kiállítás mintáján (`BillingDocumentIssueService.issue`):
 *
 *   1. a kapcsoló a legelső: kikapcsolva nincs hívás, álszámlázóval a stub;
 *   2. csak kiállított számla vagy előlegszámla sztornózható;
 *   3. a FOGLALÁS egy STORNO sor ISSUING állapotban, az eredetire hivatkozva.
 *      Számlánként legfeljebb egy ilyen sor lehet (a migráció részleges egyedi
 *      indexe): két egyidejű kattintásból egy hívás lesz. Az elutasított
 *      sztornó sora újra foglalható;
 *   4. egy Számlázz.hu-hívás (`action-szamla_agent_st`);
 *   5. a kimenet: ISSUED (a sztornó száma, PDF-je, az eredeti ellentett
 *      összegei), ISSUE_FAILED (hibakóddal elutasítva), vagy ISSUING marad
 *      (ismeretlen kimenet: kézi ellenőrzés, nincs újrapróbálás);
 *   6. a készlet: a számla eladása visszajön (`postStornoReturn`), saját
 *      tranzakcióban, mint a kiállítás készletkönyvelése.
 *
 * A sztornó sor NEM saját bizonylat a listán (`sourceType` üres, tehát kívül
 * esik az `OWN_ROWS`-on): az eredeti számla viseli, a részletein és a listán
 * jelölve. A Számlázz.hu feedje a sztornót külső SS sorként hozza vissza.
 */
@Injectable()
export class BillingDocumentStornoService {
  private readonly logger = new Logger(BillingDocumentStornoService.name);
  private readonly database = prisma;

  constructor(
    private readonly documents: BillingDocumentsRepository,
    private readonly credentials: SzamlazzCredentialProvider,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    private readonly stock: BillingDocumentStockRepository,
    @Optional()
    @Inject(BILLING_SZAMLAZZ_STORNO_CLIENT)
    private readonly client: SzamlazzAgentStornoClient = new HttpSzamlazzAgentClient(),
    @Optional()
    @Inject(BILLING_ISSUE_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async storno(
    id: string,
    reason: string | undefined,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    const mode = billingIssueMode(this.environment);
    if (mode === "conflict")
      throw new ConflictException(
        "A kiállítás beállítása ellentmondásos: a valódi kiállítás és az álszámlázó egyszerre van bekapcsolva. Egyiket ki kell kapcsolni.",
      );
    if (mode === "off")
      throw new ConflictException(
        "A valódi kiállítás ezen a szerveren nincs bekapcsolva, ezért sztornó sem készülhet.",
      );

    const original = await this.documents.find(id);
    if (!original) throw new NotFoundException("A bizonylat nem található.");
    if (
      original.status !== "ISSUED" ||
      !original.invoiceNumber ||
      !(BILLING_STORNABLE_TYPES as ReadonlySet<string>).has(
        original.documentType,
      )
    )
      throw new ConflictException(
        "Csak kiállított számla vagy előlegszámla sztornózható.",
      );

    const finalBlock = await this.finalInvoiceBlock(original);
    if (finalBlock) throw new ConflictException(finalBlock);

    const existing = original.correctionInvoices[0] ?? null;
    // a sikeres sztornó utáni második kattintás a sztornózott számlát kapja;
    // ha a készlet visszavétele elmaradt, most pótolja (idempotensen)
    if (existing?.status === "ISSUED")
      return this.withStock(id, existing.id, existing.invoiceNumber, user);
    if (existing?.status === "ISSUING")
      throw new ConflictException(
        "Ennek a számlának a sztornózása már elindult, és ellenőrzésre vár: nézd meg a Számlázz.hu-n, mielőtt bármit újra próbálsz.",
      );

    let agentKey: string;
    try {
      // az álszámlázó a tárolt kulcsot SEM olvassa: a teszt-szerveren az az éles fiókra szólhat
      agentKey =
        mode === "stub" ? "stub" : (await this.credentials.resolve()).agentKey;
    } catch (error) {
      if (error instanceof SzamlazzConnectionError)
        throw new ConflictException(
          "A Számlázz.hu kapcsolat nincs beállítva (Beállítások > Számlázz.hu).",
        );
      throw error;
    }
    const xml = buildSzamlazzAgentStornoXml({
      agentKey,
      invoiceNumber: original.invoiceNumber,
      electronic: original.invoiceFormat === "ELECTRONIC",
      issueDate: budapestDayKey(new Date()),
      reason,
    });

    const stornoId = await this.claim(original, existing, user);
    if (!stornoId)
      throw new ConflictException(
        "Ennek a számlának a sztornózása már elindult: töltsd újra, és nézd meg, mi lett vele.",
      );

    // A FOGLALÁS UTÁN MÉG EGYSZER (barracuda, #1674): a végszámla kiállítása a
    // fenti őr és a foglalás között indulhatott el. A végszámla a saját
    // foglalása után ugyanígy visszaolvassa ezt a sztornót, tehát a kettő közül
    // legalább az egyik látja a másikat.
    const lateBlock = await this.finalInvoiceBlock(original);
    if (lateBlock) {
      await this.database.invoice.updateMany({
        where: { id: stornoId, status: "ISSUING" },
        data: {
          status: "ISSUE_FAILED",
          syncStatus: "ERROR",
          syncError: lateBlock.slice(0, 500),
        },
      });
      throw new ConflictException(lateBlock);
    }

    let response;
    try {
      response = await (
        mode === "stub" ? new StubSzamlazzAgentClient() : this.client
      ).stornoInvoice(xml);
    } catch (error) {
      await this.markOutcomeUnknown(
        stornoId,
        `A Számlázz.hu válasza nem érkezett meg (${
          error instanceof SzamlazzAgentHttpError
            ? `HTTP ${error.status}`
            : error instanceof Error
              ? error.name
              : "ismeretlen hiba"
        }). Ellenőrizd a Számlázz.hu-n, elkészült-e a sztornó, mielőtt bármit újra próbálsz.`,
      );
      throw new ServiceUnavailableException(
        "A Számlázz.hu válasza nem érkezett meg, ezért nem tudni, elkészült-e a sztornó. Ellenőrizd a Számlázz.hu-n; a rendszer nem próbálja újra.",
      );
    }
    if (!response.successful && response.errorCode) {
      const message = `A Számlázz.hu elutasította a sztornót (${response.errorCode}): ${
        response.errorMessage ?? "nincs részletezés"
      }`;
      await this.database.invoice.updateMany({
        where: { id: stornoId, status: "ISSUING" },
        data: {
          status: "ISSUE_FAILED",
          syncStatus: "ERROR",
          syncError: message.slice(0, 500),
        },
      });
      throw new BadRequestException(message);
    }
    if (!response.successful || !response.invoiceNumber) {
      await this.markOutcomeUnknown(
        stornoId,
        "A Számlázz.hu válasza nem mondta meg egyértelműen, elkészült-e a sztornó (nincs hibakód és nincs szám). Ellenőrizd a Számlázz.hu-n.",
      );
      throw new ServiceUnavailableException(
        "A Számlázz.hu válasza nem egyértelmű; ellenőrizd a Számlázz.hu-n, elkészült-e a sztornó.",
      );
    }

    /*
      AZ ÖSSZEGEK AZ EREDETI ELLENTETTJEI (barracuda, #1662: a sztornó előjele).
      A sztornó a teljes számlát vonja vissza, tehát nettó, ÁFA és bruttó az
      eredeti mínusz egyszerese, és a havi csomag összesítője így levonja. Ha a
      Számlázz.hu más bruttót mond, az a naplóba kerül, nem a sorra.
    */
    const gross = negate(original.grossAmount);
    if (
      response.grossTotal !== undefined &&
      gross !== null &&
      Math.abs(response.grossTotal) !== Math.abs(gross.toNumber())
    )
      this.logger.warn(
        `A(z) ${response.invoiceNumber} sztornó bruttója (${response.grossTotal}) eltér az eredeti ${original.invoiceNumber} bruttójától (${original.grossAmount?.toString()}).`,
      );
    try {
      await this.database.invoice.update({
        where: { id: stornoId },
        data: {
          status: "ISSUED",
          invoiceNumber: response.invoiceNumber,
          issueDate: new Date(),
          netAmount: negate(original.netAmount),
          vatAmount: negate(original.vatAmount),
          grossAmount: gross,
          externalUrl: httpsUrl(response.customerAccountUrl),
          syncStatus: "RECEIVED",
          syncError: null,
        },
      });
    } catch {
      await this.markOutcomeUnknown(
        stornoId,
        `A Számlázz.hu elkészítette a(z) ${response.invoiceNumber} sztornót, de a rögzítése nálunk nem sikerült. Rögzítsd kézzel ezt a számot.`,
      ).catch(() => undefined);
      throw new ServiceUnavailableException(
        `A(z) ${response.invoiceNumber} sztornó elkészült, de a rögzítése nálunk nem sikerült. Ne sztornózd újra.`,
      );
    }

    if (response.pdf) {
      const key = {
        owner: "invoice" as const,
        ownerId: stornoId,
        documentId: ISSUED_PDF,
      };
      try {
        await this.documentStore.put(key, response.pdf);
        await this.database.invoice.update({
          where: { id: stornoId },
          data: { pdfStorageKey: storageKeyFor(key) },
        });
      } catch (error) {
        // the storno exists and is recorded; only its PDF is missing here
        this.logger.warn(
          `A(z) ${response.invoiceNumber} sztornó PDF-jének mentése nem sikerült: ${
            error instanceof Error ? error.name : "ismeretlen hiba"
          }`,
        );
      }
    }

    return this.withStock(id, stornoId, response.invoiceNumber, user);
  }

  /**
   * A FOGLALÁS: új STORNO sor ISSUING-ben, vagy az elutasított sztornó sorának
   * feltételes visszavétele. `null`: valaki más már foglal (az egyedi index
   * vagy a feltételes frissítés mondja meg).
   */
  /**
   * AZ ELŐLEGET LEVONÓ VÉGSZÁMLA (barracuda, #1672): ha kiállított vagy
   * kiállítás alatt álló, sztornózatlan végszámla vonja le az előleget, előbb
   * azt kell sztornózni, különben a végszámla egy sztornózott előlegre
   * hivatkozna. A végszámla-vázlat nem akadály: annak a kiállítását a végszámla
   * saját őre állítja meg.
   *
   * AMIT NEM FED (barracuda, #1674): a `finalInvoiceOf` csak a saját sorokat
   * látja. Egy közvetlenül a Számlázz.hu felületén kiállított végszámla (csak a
   * feedben van) nem állítja meg az előleg sztornóját.
   */
  private async finalInvoiceBlock(original: {
    id: string;
    documentType: string;
  }): Promise<string | null> {
    if (original.documentType !== "ADVANCE_INVOICE") return null;
    const final = await this.documents.finalInvoiceOf(original.id);
    if (
      final &&
      (final.status === "ISSUING" ||
        (final.status === "ISSUED" && final.correctionInvoices.length === 0))
    )
      return `Erre az előlegszámlára a(z) ${final.invoiceNumber ?? "kiállítás alatt álló"} végszámla hivatkozik: előbb a végszámlát sztornózd.`;
    return null;
  }

  private async claim(
    original: NonNullable<
      Awaited<ReturnType<BillingDocumentsRepository["find"]>>
    >,
    existing: { id: string; status: string } | null,
    user: AuthenticatedUser,
  ): Promise<string | null> {
    if (existing) {
      const claimed = await this.database.invoice.updateMany({
        where: { id: existing.id, status: "ISSUE_FAILED" },
        data: {
          status: "ISSUING",
          issueAttemptCount: { increment: 1 },
          issuedByUserId: user.id,
          syncStatus: "PENDING",
          syncError: null,
        },
      });
      return claimed.count === 1 ? existing.id : null;
    }
    try {
      const created = await this.database.invoice.create({
        data: {
          direction: "OUTBOUND",
          documentType: "STORNO",
          source: "SZAMLAZZ",
          status: "ISSUING",
          referencedInvoiceId: original.id,
          partnerName: original.partnerName,
          partnerTaxNumber: original.partnerTaxNumber,
          customerId: original.customerId,
          currency: original.currency,
          invoiceFormat: original.invoiceFormat,
          paymentMethod: original.paymentMethod,
          language: original.language,
          buyerSnapshot: original.buyerSnapshot ?? Prisma.JsonNull,
          issueAttemptCount: 1,
          createdByUserId: user.id,
          issuedByUserId: user.id,
          syncStatus: "PENDING",
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return null;
      throw error;
    }
  }

  private markOutcomeUnknown(id: string, note: string) {
    return this.database.invoice.updateMany({
      where: { id, status: "ISSUING" },
      data: { syncStatus: "ERROR", syncError: note.slice(0, 500) },
    });
  }

  /**
   * A KÉSZLET VISSZAVÉTELE A SZTORNÓ UTÁN, SAJÁT TRANZAKCIÓBAN: egy
   * készlet-oldali hiba nem veheti el a Számlázz.hu-n már létező sztornó
   * rögzítését. Ha elbukik, a következő sztornó-kattintás (ami a sztornózott
   * számlát adja vissza) újra megpróbálja; az idempotencia-kulcs miatt ez
   * sosem ad vissza kétszer.
   */
  private async withStock(
    id: string,
    stornoId: string,
    stornoNumber: string | null,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    try {
      await this.stock.postStornoReturn(id, stornoId, stornoNumber, user.id);
    } catch (error) {
      this.logger.error(
        `A(z) ${id} számla sztornójának készlet-visszavétele nem sikerült: ${
          error instanceof Error ? error.message : "ismeretlen hiba"
        }`,
      );
    }
    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    return toBillingDocumentDetail(row);
  }
}
