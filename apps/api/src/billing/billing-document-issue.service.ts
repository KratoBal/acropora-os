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
import {
  billingEmailDelivery,
  checkBillingIssueDates,
  type AuthenticatedUser,
  type BillingDocumentDetail,
  type BillingDocumentType,
  type BillingIssueConfirmation,
  type BillingIssueSummary,
  type InvoiceFormat,
} from "@acropora/types";

import {
  HttpSzamlazzAgentClient,
  SzamlazzAgentHttpError,
  type SzamlazzAgentClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { buildSzamlazzAgentInvoiceXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import { contractOverbillingProblem } from "@acropora/types";
import { CONTRACT_GUARDED_DOCUMENT_TYPES } from "../contracts/contract-billed-lines.js";
import { SzamlazzConnectionError } from "../integrations/szamlazz/szamlazz-connection.types.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { budapestDayKey } from "../dashboard/budapest-day.js";
import {
  billingIssueSummary,
  buildIssueInput,
  finalInvoiceIssueProblem,
} from "./billing-document-issue.js";
import { customerTaxNumberProblem } from "./buyer-tax-number.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import {
  BillingDocumentAdapterError,
  toSzamlazzAgentInput,
} from "./billing-document-szamlazz.adapter.js";
import { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { toBillingDocumentDetail } from "./billing-documents.service.js";
import { billingIssueMode } from "./billing-issue.config.js";
import { StubSzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent-stub.client.js";

/** Injectable for tests: the environment the switch is read from. */
export const BILLING_ISSUE_ENV = Symbol("BILLING_ISSUE_ENV");
/** Injectable for tests: the Számlázz.hu client (a fake never calls out). */
export const BILLING_SZAMLAZZ_CLIENT = Symbol("BILLING_SZAMLAZZ_CLIENT");

export const ISSUED_PDF = "billing-document.pdf";

/**
 * A KIÁLLÍTÁS (Számlázás v0.1). A karbantartási számla kiállításának mintája
 * (maintenance-invoice-draft.service.ts issue()), a négy típusra, a #1273
 * adapterével és a #1275 összegeivel:
 *
 *   1. a kapcsoló (BILLING_ISSUE_ENABLED) a legelső: kikapcsolva nincs hívás;
 *   2. a vázlatból a kérés és a vevő-snapshot (tiszta függvény, hívás előtt);
 *   3. a kulcs feloldása, UTÁNA a feltételes foglalás DRAFT -> ISSUING;
 *   4. egy Számlázz.hu-hívás, `sendEmail=false`, `szamlaKulsoAzon = Invoice.id`;
 *   5. a kimenet: ISSUED / ISSUE_FAILED / ISSUING marad (ismeretlen).
 * Automatikus újrapróbálás nincs: egy második hívás egy második bizonylatot
 * állíthatna ki, és a Számlázz.hu is tiltja a hurokban ismétlést.
 * A kiküldés KÜLÖN hívás (`:id/email`), a kiállítás után (brief 22. pont).
 */
/**
 * Egy külső szolgáltatás által adott hivatkozás csak `https:` alakban kerül a
 * vevőnek menő levélbe és a felületre; minden más (üres, `http:`, `javascript:`)
 * `null`.
 */
export function httpsUrl(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    return new URL(text).protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

@Injectable()
export class BillingDocumentIssueService {
  private readonly logger = new Logger(BillingDocumentIssueService.name);

  constructor(
    private readonly documents: BillingDocumentsRepository,
    private readonly repository: BillingDocumentIssueRepository,
    private readonly credentials: SzamlazzCredentialProvider,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    private readonly stock: BillingDocumentStockRepository,
    @Optional()
    @Inject(BILLING_SZAMLAZZ_CLIENT)
    private readonly client: SzamlazzAgentClient = new HttpSzamlazzAgentClient(),
    @Optional()
    @Inject(BILLING_ISSUE_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  /**
   * A kiállítás módja ezen a szerveren (élő, álszámlázó, kikapcsolt vagy
   * ellentmondásos). Más modul ezzel nézi meg, MIELŐTT a kiállításhoz vezető
   * mellékhatást (partner, vázlat) létrehozná.
   */
  issueMode() {
    return billingIssueMode(this.environment);
  }

  /**
   * Túlszámlázná-e a bizonylat a forrás-szerződését (feladat d510)? Csak
   * szerződésből jött, számlázottnak számító típusú bizonylatnál, és csak a
   * szerződés-tételre mutató soraival; `null`, ha rendben.
   */
  private async contractOverbilling(row: {
    id: string;
    sourceType: string | null;
    sourceId: string | null;
    documentType: string;
    lines: Array<{
      kind: string;
      contractItemId: string | null;
      description: string;
      quantity: { toString(): string };
    }>;
    referencedInvoiceId?: string | null;
    referencedInvoice?: { id: string } | null;
  }): Promise<string | null> {
    if (row.sourceType !== "CONTRACT" || !row.sourceId) return null;
    if (
      !(CONTRACT_GUARDED_DOCUMENT_TYPES as readonly string[]).includes(
        row.documentType,
      )
    )
      return null;
    const draft = row.lines.flatMap((line) =>
      line.kind === "ITEM" && line.contractItemId
        ? [
            {
              contractItemId: line.contractItemId,
              description: line.description,
              quantity: line.quantity.toString(),
            },
          ]
        : [],
    );
    if (!draft.length) return null;
    // a végszámla a saját előlegét sem számolja „máshol számlázottnak”: az az
    // előleg épp most adja át a tételeit neki (contract-billed-lines.ts)
    const ownAdvance =
      row.documentType === "FINAL_INVOICE"
        ? (row.referencedInvoice?.id ?? row.referencedInvoiceId ?? null)
        : null;
    const facts = await this.documents.contractBillingFacts(
      row.sourceId,
      ownAdvance ? [row.id, ownAdvance] : [row.id],
    );
    return contractOverbillingProblem(facts.items, facts.billed, draft);
  }

  /**
   * THE CONFIRMATION WINDOW'S VALUES (card 7ba97e0d), from the builder the issue uses. Only for a draft: an issued
   * or issuing document has nothing left to confirm.
   */
  async summary(id: string, now = new Date()): Promise<BillingIssueSummary> {
    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    if (row.status !== "DRAFT")
      throw new ConflictException("Csak vázlat állítható ki.");
    const result = billingIssueSummary(row, budapestDayKey(now));
    if (!result.ok) throw new BadRequestException(result.message);
    return result.summary;
  }

  /**
   * `confirmation` is what the window showed and the person confirmed (card 7ba97e0d): the HTTP route requires it,
   * an internal caller that has not shown a window yet (the webshop, until its slice) passes none and issues as
   * before. With it, the shown values are recomputed and must match, and the three dates go into the invoice.
   */
  async issue(
    id: string,
    expectedUpdatedAt: string,
    user: AuthenticatedUser,
    confirmation?: BillingIssueConfirmation,
    now = new Date(),
  ): Promise<BillingDocumentDetail> {
    const mode = billingIssueMode(this.environment);
    if (mode === "conflict")
      throw new ConflictException(
        "A kiállítás beállítása ellentmondásos: a valódi kiállítás és az álszámlázó egyszerre van bekapcsolva. Egyiket ki kell kapcsolni.",
      );
    if (mode === "off")
      throw new ConflictException(
        "A valódi kiállítás ezen a szerveren nincs bekapcsolva.",
      );

    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    // a sikeres kiállítás utáni második kattintás a kiállított bizonylatot
    // kapja; ha a készletkönyvelése elmaradt, most pótolja (idempotensen)
    if (row.status === "ISSUED") return this.withStock(id, user);
    if (row.status === "ISSUING")
      throw new ConflictException(
        "Ennek a bizonylatnak a kiállítása már elindult, és ellenőrzésre vár: nézd meg a Számlázz.hu-n, mielőtt bármit újra próbálsz.",
      );
    if (row.status !== "DRAFT")
      throw new ConflictException(
        "A kiállítás elutasítva maradt: javítsd és mentsd a vázlatot, utána állítsd ki újra.",
      );

    const input = buildIssueInput(row);
    if (!input.ok) throw new BadRequestException(input.message);
    const taxProblem =
      row.customer && customerTaxNumberProblem(row.customer)
        ? // the reason names a same-named partner's tax number: where to copy it from
          customerTaxNumberProblem(
            row.customer,
            await this.documents.partnerTaxHint(row.customer),
          )
        : null;
    if (taxProblem) throw new BadRequestException(taxProblem);
    // a végszámla előlege közben sztornózható; a felületi sztornót a feed hozza
    const finalProblem = finalInvoiceIssueProblem(
      row,
      input.totals.grossAmount,
      row.documentType === "FINAL_INVOICE" &&
        row.referencedInvoice?.invoiceNumber != null &&
        (await this.documents.feedTwinCancelled(
          row.referencedInvoice.invoiceNumber,
        )),
    );
    if (finalProblem) throw new BadRequestException(finalProblem);
    // SZERZŐDÉSBŐL CSAK A MARADÉK (feladat d510): a saját sorai nélkül számolva
    // egy szerződés-tétel sem léphet túl a még nem számlázott mennyiségen
    const contractProblem = await this.contractOverbilling(row);
    if (contractProblem) throw new BadRequestException(contractProblem);

    // WHAT THE WINDOW SHOWED IS WHAT THE INVOICE CARRIES (card 7ba97e0d): the same summary again, the shown values
    // compared by their digest, the three dates checked by the shared rule and put into the invoice
    const today = budapestDayKey(now);
    let issueDay: string | null = null;
    if (confirmation) {
      const shown = billingIssueSummary(row, today);
      if (!shown.ok) throw new BadRequestException(shown.message);
      if (shown.summary.fingerprint !== confirmation.fingerprint)
        throw new ConflictException(
          "A számla adatai megváltoztak, mióta megnyitottad a megerősítést (például a partner neve, címe vagy adószáma). Nyisd meg újra, és nézd meg, mi változott.",
        );
      const dates = checkBillingIssueDates(confirmation, {
        today,
        showsPaymentFields: shown.summary.showsPaymentFields,
        dueDateFollowsIssueDate: shown.summary.dueDateFollowsIssueDate,
      });
      if (!dates.ok) throw new BadRequestException(dates.error);
      input.document.issueDate = dates.value.issueDate;
      input.document.fulfillmentDate = dates.value.fulfillmentDate;
      if (dates.value.dueDate !== null)
        input.document.dueDate = dates.value.dueDate;
      issueDay = dates.value.issueDate;
    }

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

    let xml: string;
    try {
      xml = buildSzamlazzAgentInvoiceXml(
        toSzamlazzAgentInput(input.document, { agentKey, previewOnly: false }),
      );
    } catch (error) {
      if (error instanceof BillingDocumentAdapterError)
        throw new BadRequestException(
          `A bizonylat nem küldhető a Számlázz.hu-ra (${error.code}).`,
        );
      throw error;
    }

    if (
      !(await this.repository.claim({
        id,
        expectedUpdatedAt: new Date(expectedUpdatedAt),
        actorUserId: user.id,
      }))
    )
      throw new ConflictException(
        "A vázlatot időközben mentették vagy már kiállítják: töltsd újra, és nézd meg, mi változott.",
      );

    // A FOGLALÁS UTÁN MÉG EGYSZER (barracuda, #1674): a fenti őr és az előleg
    // sztornója egyszerre is átmehet. A sztornó a saját foglalása után ugyanígy
    // visszaolvassa ezt a végszámlát, tehát a kettő közül legalább az egyik
    // látja a másikat; itt a folyamatban lévő sztornó is megállít. FELTÉTELE:
    // mindkét foglalás önálló, azonnal lezárt írás. Ha egy tranzakcióba kerülne
    // a visszaolvasással, READ COMMITTED mellett a másik oldal nem látná, és a
    // rés csendben újranyílna.
    if (
      row.documentType === "FINAL_INVOICE" &&
      row.referencedInvoice &&
      ((await this.documents.stornoStarted(row.referencedInvoice.id)) ||
        (row.referencedInvoice.invoiceNumber != null &&
          (await this.documents.feedTwinCancelled(
            row.referencedInvoice.invoiceNumber,
          ))))
    ) {
      const reason = `A(z) ${row.referencedInvoice.invoiceNumber ?? "levonandó"} előlegszámla sztornózása időközben elindult, ezért ez a végszámla nem állítható ki.`;
      await this.repository.markFailed(id, reason);
      throw new BadRequestException(reason);
    }

    // A FOGLALÁS UTÁN MÉG EGYSZER, a végszámla-előleg mintájára (#1674): két
    // egyszerre kiállított vázlat ugyanabból a szerződésből mindkettő átmehetett
    // a fenti őrön. A másik foglalása (ISSUING) most már számlázottnak számít,
    // tehát legalább az egyik látja a másikat. A foglalás önálló, azonnal
    // lezárt írás; egy tranzakcióba téve READ COMMITTED mellett újranyílna a rés.
    const contractRace = await this.contractOverbilling(row);
    if (contractRace) {
      await this.repository.markFailed(id, contractRace);
      throw new BadRequestException(contractRace);
    }

    let response;
    try {
      response = await (
        mode === "stub" ? new StubSzamlazzAgentClient() : this.client
      ).generateInvoice(xml);
    } catch (error) {
      await this.repository.markOutcomeUnknown(
        id,
        `A Számlázz.hu válasza nem érkezett meg (${
          error instanceof SzamlazzAgentHttpError
            ? `HTTP ${error.status}`
            : error instanceof Error
              ? error.name
              : "ismeretlen hiba"
        }). Ellenőrizd a Számlázz.hu-n, készült-e bizonylat, mielőtt bármit újra próbálsz.`,
      );
      throw new ServiceUnavailableException(
        "A Számlázz.hu válasza nem érkezett meg, ezért nem tudni, elkészült-e a bizonylat. Ellenőrizd a Számlázz.hu-n; a rendszer nem próbálja újra.",
      );
    }

    if (!response.successful && response.errorCode) {
      const reason = `A Számlázz.hu elutasította (${response.errorCode}): ${
        response.errorMessage ?? "nincs részletezés"
      }`;
      await this.repository.markFailed(id, reason);
      throw new BadRequestException(reason);
    }
    if (!response.successful || !response.invoiceNumber) {
      await this.repository.markOutcomeUnknown(
        id,
        "A Számlázz.hu válasza nem mondta meg egyértelműen, elkészült-e a bizonylat (nincs hibakód és nincs szám). Ellenőrizd a Számlázz.hu-n.",
      );
      throw new ServiceUnavailableException(
        "A Számlázz.hu válasza nem egyértelmű; ellenőrizd a Számlázz.hu-n, elkészült-e a bizonylat.",
      );
    }

    // a Számlázz.hu saját végösszege a mérvadó; a mi számításunk ugyanezt adja
    // a mért szabály szerint (#1275), eltérés esetén a válasz áll és naplózunk
    const totals =
      response.netTotal !== undefined && response.grossTotal !== undefined
        ? {
            netAmount: String(response.netTotal),
            vatAmount: String(response.grossTotal - response.netTotal),
            grossAmount: String(response.grossTotal),
          }
        : input.totals;
    if (
      Number(totals.grossAmount) !== Number(input.totals.grossAmount) ||
      Number(totals.netAmount) !== Number(input.totals.netAmount)
    )
      this.logger.warn(
        `A(z) ${response.invoiceNumber} végösszege eltér a számítottól (Számlázz.hu ${totals.netAmount}/${totals.grossAmount}, számított ${input.totals.netAmount}/${input.totals.grossAmount}).`,
      );

    const delivery = billingEmailDelivery(
      row.documentType as BillingDocumentType,
      row.invoiceFormat as InvoiceFormat | null,
    );
    try {
      await this.repository.markIssued({
        id,
        invoiceNumber: response.invoiceNumber,
        // the moment of the issue, as before; a confirmed earlier day is stored at its noon (UTC), so it reads as that
        // day in every time zone a page formats it in
        issueDate:
          issueDay === null || issueDay === today
            ? new Date()
            : new Date(`${issueDay}T12:00:00Z`),
        ...(confirmation
          ? {
              fulfillmentDate: dayDate(input.document.fulfillmentDate),
              dueDate: input.document.dueDate
                ? dayDate(input.document.dueDate)
                : null,
            }
          : {}),
        buyer: input.buyer,
        lines: input.lines,
        totals,
        emailStatus: delivery === "REQUIRED" ? "PENDING" : "NOT_REQUIRED",
        // acrobot döntése (25240): a kiküldés `{document_link}`-je ebből jön,
        // és a részletek is ezt mutatják Számlázz.hu-hivatkozásként.
        externalUrl: httpsUrl(response.customerAccountUrl),
      });
    } catch {
      await this.repository
        .markOutcomeUnknown(
          id,
          `A Számlázz.hu kiállította a(z) ${response.invoiceNumber} bizonylatot, de a rögzítése nálunk nem sikerült. Rögzítsd kézzel ezt a számot.`,
        )
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        `A(z) ${response.invoiceNumber} bizonylat elkészült, de a rögzítése nálunk nem sikerült. Ne állítsd ki újra.`,
      );
    }

    if (response.pdf) {
      const key = {
        owner: "invoice" as const,
        ownerId: id,
        documentId: ISSUED_PDF,
      };
      try {
        await this.documentStore.put(key, response.pdf);
        await this.repository.setPdf(id, storageKeyFor(key));
      } catch (error) {
        // the document exists and is recorded; only its PDF is missing here
        this.logger.warn(
          `A(z) ${response.invoiceNumber} PDF-jének mentése nem sikerült: ${
            error instanceof Error ? error.name : "ismeretlen hiba"
          }`,
        );
      }
    }

    return this.withStock(id, user);
  }

  /**
   * A KÉSZLETKÖNYVELÉS A KIÁLLÍTÁS UTÁN, SAJÁT TRANZAKCIÓBAN. Nem a kiállítás
   * tranzakciójában: egy készlet-oldali hiba nem veheti el a Számlázz.hu-n már
   * létező bizonylat rögzítését. Ha elbukik, a hiba naplóba kerül, és a
   * következő kiállítás-kattintás (ami a kiállított bizonylatot adja vissza)
   * újra megpróbálja; az idempotencia-kulcs miatt ez sosem von le kétszer.
   */
  private async withStock(
    id: string,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    try {
      await this.stock.postIssuedInvoice(id, user.id);
    } catch (error) {
      this.logger.error(
        `A(z) ${id} bizonylat készletkönyvelése nem sikerült: ${
          error instanceof Error ? error.message : "ismeretlen hiba"
        }`,
      );
    }
    const issued = await this.documents.find(id);
    if (!issued) throw new NotFoundException("A bizonylat nem található.");
    return toBillingDocumentDetail(issued);
  }
}

/** A confirmed calendar day as the draft stores its dates (UTC midnight, read back by `toISOString().slice(0, 10)`). */
function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}
