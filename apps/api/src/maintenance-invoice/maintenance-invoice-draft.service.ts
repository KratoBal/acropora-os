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
import { randomUUID } from "node:crypto";
import type { Prisma } from "@acropora/database";
import type { MaintenanceInvoiceSummary } from "@acropora/types";

import { CompletionCertificatesRepository } from "../completion-certificates/completion-certificates.repository.js";
import {
  assertStorageKeyMatches,
  storageKeyFor,
} from "../service-assets/document-store/document-storage-key.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  SzamlazzAgentHttpError,
  type SzamlazzAgentClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { HttpSzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import { buildSzamlazzAgentInvoiceXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { SzamlazzConnectionError } from "../integrations/szamlazz/szamlazz-connection.types.js";
import {
  maintenanceInvoiceXmlInputFrom,
  MaintenanceInvoiceInputError,
} from "./maintenance-invoice-xml-input.js";
import { maintenanceInvoiceIssueEnabled } from "./maintenance-invoice-issue.config.js";
import { MaintenanceInvoiceRepository } from "./maintenance-invoice.repository.js";

/** The environment the issue switch is read from (a test hands in its own). */
export const MAINTENANCE_INVOICE_ENV = Symbol("MAINTENANCE_INVOICE_ENV");

/** Where the two PDFs of one invoice live in the document store. */
const PREVIEW_PDF = "preview.pdf";
const ISSUED_PDF = "invoice.pdf";

/**
 * A KLIENSNEK SZÁNT, SZŰK ALAK -- a UNAS-tükör `toInvoiceSummary` mintája
 * (unas-order-sync.types.ts): a `Prisma.Decimal` mezők stringként mennek,
 * és csak azok a mezők szerepelnek, amiket a panel ténylegesen kiír.
 */
function toSummary(
  invoice: {
    id: string;
    status: string;
    currency: string;
    netAmount: Prisma.Decimal | null;
    vatAmount: Prisma.Decimal | null;
    grossAmount: Prisma.Decimal | null;
    createdAt: Date;
    invoiceNumber?: string | null;
    issueDate?: Date | null;
    syncError?: string | null;
  },
  issueEnabled: boolean,
): MaintenanceInvoiceSummary {
  return {
    id: invoice.id,
    status: invoice.status as MaintenanceInvoiceSummary["status"],
    currency: invoice.currency,
    netAmount: invoice.netAmount?.toString() ?? "0",
    vatAmount: invoice.vatAmount?.toString() ?? "0",
    grossAmount: invoice.grossAmount?.toString() ?? "0",
    createdAt: invoice.createdAt.toISOString(),
    ...(invoice.status === "ISSUED" && invoice.invoiceNumber
      ? {
          invoiceNumber: invoice.invoiceNumber,
          issuedAt: invoice.issueDate?.toISOString(),
        }
      : {}),
    ...(invoice.status === "ISSUING"
      ? {
          issueNote:
            invoice.syncError ??
            "A kiállítás folyamatban van, vagy megszakadt: ellenőrizd a Számlázz.hu-n.",
        }
      : {}),
    issueEnabled,
  };
}

/** The same amounts, to the fillér: what was shown is what gets issued. */
function sameAmounts(
  a: {
    netAmount: Prisma.Decimal | null;
    vatAmount: Prisma.Decimal | null;
    grossAmount: Prisma.Decimal | null;
  },
  b: {
    netAmount: Prisma.Decimal;
    vatAmount: Prisma.Decimal;
    grossAmount: Prisma.Decimal;
  },
): boolean {
  return (
    a.netAmount !== null &&
    a.vatAmount !== null &&
    a.grossAmount !== null &&
    a.netAmount.equals(b.netAmount) &&
    a.vatAmount.equals(b.vatAmount) &&
    a.grossAmount.equals(b.grossAmount)
  );
}

/**
 * A KARBANTARTÁSI PISZKOZAT-SZÁMLA LÉTREHOZÁSA (ADR-014, 4. szelet).
 *
 * NINCS FEATURE-KAPCSOLÓ ELŐTTE -- Balázs döntése (acrobot 23107, 2. pont):
 * a piszkozat szabadon készíthető, kapu csak a VALÓDI kiállítás előtt áll
 * (`MAINTENANCE_INVOICE_ISSUE_ENABLED`, 2026-09-29 óta megépítve, alapból KI;
 * lásd az `issue` metódust).
 *
 * MINDEN HÍVÁS VALÓDI KÜLSŐ HÍVÁS a Számlázz.hu felé, `előnézetpdf=true`
 * mellett -- ez a mai kör mégis megengedett, mert az `előnézetpdf` a
 * hivatalos dokumentáció szerint NEM hoz létre bizonylatot. Ennek ellenére
 * a hívás a TÁROLT, VALÓDI Agent Key-t használja, tehát ELSŐ ÉLES HASZNÁLAT
 * ELŐTT acrobot külön szól Balázsnak (23107) -- ezt a szolgáltatás maga nem
 * tudja kikényszeríteni, mert az egy szervezeti lépés, nem kód-feltétel.
 */
@Injectable()
export class MaintenanceInvoiceDraftService {
  private readonly logger = new Logger(MaintenanceInvoiceDraftService.name);

  constructor(
    private readonly certificates: CompletionCertificatesRepository,
    private readonly repository: MaintenanceInvoiceRepository,
    private readonly credentials: SzamlazzCredentialProvider,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    /**
     * `@Optional()`, MERT NEST KÜLÖNBEN INJEKTÁLNI PRÓBÁLNÁ: egy interfész-
     * típusra nincs futásidejű token, és az alkalmazás a TELJES függőségi
     * gráf építésekor hasalna el -- ugyanaz a hiba, amit a Medusa
     * `clientFactory` paraméterének doc-commentje ír le
     * (medusa-connection.service.ts), és amit a bootstrap teszt itt is
     * elkapott, még a beküldés előtt (2026-09-24).
     */
    @Optional()
    private readonly client: SzamlazzAgentClient = new HttpSzamlazzAgentClient(),
    @Optional()
    @Inject(MAINTENANCE_INVOICE_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  private summary(
    invoice: Parameters<typeof toSummary>[0],
  ): MaintenanceInvoiceSummary {
    return toSummary(invoice, maintenanceInvoiceIssueEnabled(this.environment));
  }

  /**
   * A MEGLÉVŐ PISZKOZAT, HA VAN -- CSAK OLVASÁS, Számlázz.hu-hívás nélkül.
   * A panel ezt hívja betöltéskor, hogy tudja, kell-e még "Piszkozat
   * készítése" gombot mutatnia.
   */
  async byCertificate(
    certificateId: string,
  ): Promise<MaintenanceInvoiceSummary | null> {
    const existing = await this.repository.existingInvoice(certificateId);
    return existing ? this.summary(existing) : null;
  }

  /**
   * A SZÁMLA PDF-JE: piszkozatnál az előnézet, kiállított számlánál a VALÓDI.
   *
   * 2026-09-29-ig ez beégetetten az előnézetet adta vissza, és a karbantartási
   * csomag (`maintenance-package.service.ts`) is ezen át kéri a kiállított
   * számlát: kiállítás után a csomagba az előnézet került volna. Kiállított
   * számla PDF nélkül (a Számlázz.hu nem küldte) HANGOSAN hibát ad, és soha
   * nem az előnézetet.
   */
  async pdfFor(invoiceId: string): Promise<Buffer> {
    return (await this.pdfDocument(invoiceId)).bytes;
  }

  /** A PDF és a letöltési neve (a vezérlő ezt adja ki). */
  async pdfDocument(
    invoiceId: string,
  ): Promise<{ bytes: Buffer; fileName: string }> {
    const invoice = await this.repository.invoicePdfLookup(invoiceId);
    if (!invoice) throw new NotFoundException("A számla nem található.");
    const issued = invoice.status === "ISSUED";
    if (!invoice.pdfStorageKey)
      throw new ServiceUnavailableException(
        issued
          ? "A kiállított számla PDF-je nem érkezett meg a Számlázz.hu-tól; töltsd le onnan."
          : "A piszkozat-számla PDF-je nem érhető el.",
      );
    const key = {
      owner: "invoice" as const,
      ownerId: invoice.id,
      documentId: issued ? ISSUED_PDF : PREVIEW_PDF,
    };
    // A kiállított számla kulcsa a VALÓDI PDF-re mutasson, ne az előnézetre.
    assertStorageKeyMatches(invoice.pdfStorageKey, key);
    const bytes = await this.documentStore.get(key);
    if (!bytes)
      throw new ServiceUnavailableException(
        "A számla PDF-je a dokumentum-tárolóban nem érhető el.",
      );
    return {
      bytes: Buffer.from(bytes),
      fileName:
        issued && invoice.invoiceNumber
          ? `szamla-${invoice.invoiceNumber.replace(/[^\w.-]+/g, "_")}.pdf`
          : "szamla-elonezet.pdf",
    };
  }

  /**
   * A TELJESÍTÉSI IGAZOLÁSBÓL A SZÁMLA TÉTELEI -- a piszkozat és a kiállítás
   * UGYANEZT használja, így a kiállításkor újraszámolt összeg a piszkozatéval
   * összevethető.
   */
  private async prepare(certificateId: string) {
    const certificate = await this.certificates.detail(certificateId);
    if (!certificate)
      throw new NotFoundException("A teljesítési igazolás nem található.");

    const signed = certificate.documents.some(
      (document) => document.type === "SIGNED_FORM",
    );
    if (!signed)
      throw new ConflictException(
        "A teljesítési igazolás aláírt példánya hiányzik -- piszkozat-számla enélkül nem készíthető.",
      );

    const customer = certificate.serviceJob.customer;
    if (!customer)
      throw new BadRequestException(
        "A karbantartási laphoz nincs vevő rendelve -- piszkozat-számla enélkül nem készíthető.",
      );

    let mapped;
    try {
      mapped = maintenanceInvoiceXmlInputFrom({
        number: certificate.number,
        issuedAt: certificate.issuedAt,
        serviceJob: { customer },
        items: certificate.items,
      });
    } catch (error) {
      if (error instanceof MaintenanceInvoiceInputError)
        throw new BadRequestException(
          error.code === "NO_BILLING_ADDRESS"
            ? "A vevőnek nincs alapértelmezett számlázási címe -- piszkozat-számla enélkül nem készíthető."
            : "A teljesítési igazolásnak nincs tétele -- piszkozat-számla enélkül nem készíthető.",
        );
      throw error;
    }
    return { certificate, customer, mapped };
  }

  private async agentKey(): Promise<string> {
    try {
      return (await this.credentials.resolve()).agentKey;
    } catch (error) {
      if (error instanceof SzamlazzConnectionError)
        throw new ServiceUnavailableException(
          "A Számlázz.hu kapcsolat nincs beállítva -- add meg az Agent Key-t a Beállítások oldalon.",
        );
      throw error;
    }
  }

  async draftFor(certificateId: string): Promise<MaintenanceInvoiceSummary> {
    const existing = await this.repository.existingInvoice(certificateId);
    if (existing) return this.summary(existing);

    const { certificate, customer, mapped } = await this.prepare(certificateId);
    const agentKey = await this.agentKey();

    const xml = buildSzamlazzAgentInvoiceXml({
      ...mapped.xmlInput,
      agentKey,
      previewOnly: true,
    });

    let response;
    try {
      response = await this.client.generateInvoice(xml);
    } catch (error) {
      /*
        MINDEN HIBA IDE FUT, NEM CSAK A `SzamlazzAgentHttpError` -- acrobot
        kérdése (23160): egy nyers hálózati hiba (DNS, kapcsolat megszakadt,
        időtúllépés) a `fetch`-ből érkezik, SOHA nem `SzamlazzAgentHttpError`
        (az csak akkor keletkezik, ha egyáltalán jött HTTP válasz). Egy
        `SzamlazzAgentXmlError` (érvénytelen/váratlan válasz-alak) ugyanígy
        idegen technikai szöveget adna a panelen. Mielőtt ez a javítás
        megtörtént, mindkettő a NYERS hibát dobta tovább a hívóig -- a
        felhasználó egy angol/technikai üzenetet látott volna a saját
        magyar nyelvű felülete helyett. Egyik ág sem ír adatbázisba: ez a
        hívás a piszkozat LÉTREHOZÁSA ELŐTT fut, tehát félkész DRAFT sor
        egyik esetben sem keletkezhet.
      */
      if (error instanceof SzamlazzAgentHttpError)
        throw new ServiceUnavailableException(
          `A Számlázz.hu nem érhető el vagy hibával válaszolt (HTTP ${error.status}).`,
        );
      throw new ServiceUnavailableException(
        "A Számlázz.hu nem érhető el (hálózati hiba). Próbáld újra.",
      );
    }

    if (!response.successful || !response.pdf)
      throw new ServiceUnavailableException(
        response.errorMessage ??
          "A Számlázz.hu elutasította az előnézet-kérést.",
      );

    const invoiceId = randomUUID();
    const documentKey = {
      owner: "invoice" as const,
      ownerId: invoiceId,
      documentId: "preview.pdf",
    };
    await this.documentStore.put(documentKey, response.pdf);

    const created = await this.repository.createDraft({
      id: invoiceId,
      completionCertificateId: certificateId,
      customerId: customer.id,
      partnerName: customer.displayName,
      partnerTaxNumber: customer.taxNumber,
      currency: mapped.xmlInput.currency,
      totals: mapped.totals,
      pdfStorageKey: storageKeyFor(documentKey),
      lines: certificate.items.map((item, index) => {
        const amounts = mapped.lineAmounts[index]!;
        return {
          description: item.description,
          quantity: item.quantity,
          unitNet: item.unitNet,
          vatRatePercent: item.vatRatePercent,
          netAmount: amounts.netAmount,
          vatAmount: amounts.vatAmount,
          grossAmount: amounts.grossAmount,
        };
      }),
    });
    return this.summary(created);
  }

  /**
   * A VALÓDI KIÁLLÍTÁS (146ccc61): DRAFT -> ISSUED, a Számlázz.hu Agent API-n,
   * `elonezetpdf` NÉLKÜL -- ez egy valódi, a NAV-nak bejelentett számla.
   *
   * A SORREND A LÉNYEG, és minden lépés azt védi, hogy ne készüljön se két
   * számla, se olyan, amit senki nem látott:
   *   1. a kapcsoló (alapból KI): kikapcsolva hívás nélkül elutasít;
   *   2. az összeg újraszámolva a teljesítési igazolásból, és a piszkozatéval
   *      EGYEZNIE kell (azt állítjuk ki, amit a felhasználó látott);
   *   3. a kulcs, még a foglalás ELŐTT (hiánya nem hagy félkész állapotot);
   *   4. DRAFT -> ISSUING egy feltételes frissítéssel: a hívás legfeljebb EGYSZER
   *      indul, dupla kattintásra vagy két felhasználóra is;
   *   5. a hívás; BIZTOS elutasításnál (a Számlázz.hu hibakóddal válaszolt)
   *      vissza DRAFT-ra; minden más hibánál (hálózat, időtúllépés, értelmetlen
   *      válasz) a sor ISSUING-ben MARAD, kézi ellenőrzésre -- újrapróbálás
   *      nincs, mert egy második valódi számlát állíthatna ki;
   *   6. sikernél ELŐBB a számlaszám kerül a sorra, a PDF utána: ha a PDF
   *      mentése bukik, a kiállított számla száma akkor sem vész el.
   */
  async issue(invoiceId: string): Promise<MaintenanceInvoiceSummary> {
    if (!maintenanceInvoiceIssueEnabled(this.environment))
      throw new ConflictException(
        "A valódi számla-kiállítás ezen a szerveren nincs bekapcsolva.",
      );

    const invoice = await this.repository.invoiceById(invoiceId);
    if (!invoice) throw new NotFoundException("A számla nem található.");
    if (invoice.status === "ISSUED") return this.summary(invoice);
    if (invoice.status === "ISSUING")
      throw new ConflictException(
        "Ennek a számlának a kiállítása már elindult, és ellenőrzésre vár: nézd meg a Számlázz.hu-n, mielőtt bármit újra próbálsz.",
      );
    if (!invoice.completionCertificateId)
      throw new ConflictException(
        "A számla nem teljesítési igazolásból készült, itt nem állítható ki.",
      );

    const { mapped } = await this.prepare(invoice.completionCertificateId);
    if (!sameAmounts(invoice, mapped.totals))
      throw new ConflictException(
        "A teljesítési igazolás a piszkozat óta megváltozott: az összeg már nem egyezik. Készíts új piszkozatot.",
      );
    const agentKey = await this.agentKey();

    if (!(await this.repository.claimForIssue(invoice.id)))
      throw new ConflictException(
        "Ennek a számlának a kiállítása már elindult egy másik kérésből.",
      );

    const xml = buildSzamlazzAgentInvoiceXml({
      ...mapped.xmlInput,
      agentKey,
      previewOnly: false,
    });

    let response;
    try {
      response = await this.client.generateInvoice(xml);
    } catch (error) {
      await this.repository.markOutcomeUnknown(
        invoice.id,
        `A Számlázz.hu válasza nem érkezett meg (${
          error instanceof SzamlazzAgentHttpError
            ? `HTTP ${error.status}`
            : error instanceof Error
              ? error.name
              : "ismeretlen hiba"
        }). Ellenőrizd a Számlázz.hu-n, készült-e számla, mielőtt bármit újra próbálsz.`,
      );
      throw new ServiceUnavailableException(
        "A Számlázz.hu válasza nem érkezett meg, ezért nem tudni, elkészült-e a számla. Ellenőrizd a Számlázz.hu-n; a rendszer nem próbálja újra.",
      );
    }

    if (!response.successful && response.errorCode) {
      await this.repository.releaseClaim(invoice.id);
      throw new BadRequestException(
        `A Számlázz.hu elutasította a kiállítást (${response.errorCode}): ${
          response.errorMessage ?? "nincs részletezés"
        }`,
      );
    }
    if (!response.successful || !response.invoiceNumber) {
      await this.repository.markOutcomeUnknown(
        invoice.id,
        "A Számlázz.hu válasza nem mondta meg egyértelműen, elkészült-e a számla (nincs hibakód és nincs számlaszám). Ellenőrizd a Számlázz.hu-n.",
      );
      throw new ServiceUnavailableException(
        "A Számlázz.hu válasza nem egyértelmű; ellenőrizd a Számlázz.hu-n, elkészült-e a számla.",
      );
    }

    const issuedAt = new Date();
    let issued;
    try {
      issued = await this.repository.markIssued(invoice.id, {
        invoiceNumber: response.invoiceNumber,
        issueDate: issuedAt,
        pdfStorageKey: null,
      });
    } catch (error) {
      await this.repository
        .markOutcomeUnknown(
          invoice.id,
          `A Számlázz.hu kiállította a(z) ${response.invoiceNumber} számlát, de a rögzítése nálunk nem sikerült. Rögzítsd kézzel ezt a számlaszámot.`,
        )
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        `A(z) ${response.invoiceNumber} számla elkészült, de a rögzítése nálunk nem sikerült. Ne állítsd ki újra.`,
      );
    }

    if (response.pdf) {
      const key = {
        owner: "invoice" as const,
        ownerId: invoice.id,
        documentId: ISSUED_PDF,
      };
      try {
        await this.documentStore.put(key, response.pdf);
        issued = await this.repository.markIssued(invoice.id, {
          invoiceNumber: response.invoiceNumber,
          issueDate: issuedAt,
          pdfStorageKey: storageKeyFor(key),
        });
      } catch (error) {
        // The invoice exists and is recorded; only its PDF is missing here.
        // The download says so and points to Számlázz.hu, never the preview.
        this.logger.warn(
          `A(z) ${response.invoiceNumber} számla PDF-jének mentése nem sikerült: ${
            error instanceof Error ? error.name : "ismeretlen hiba"
          }`,
        );
      }
    }
    return this.summary(issued);
  }
}
