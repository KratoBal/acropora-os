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
  type AuthenticatedUser,
  type BillingDocumentDetail,
  type BillingDocumentType,
  type InvoiceFormat,
} from "@acropora/types";

import {
  HttpSzamlazzAgentClient,
  SzamlazzAgentHttpError,
  type SzamlazzAgentClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { buildSzamlazzAgentInvoiceXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import { SzamlazzConnectionError } from "../integrations/szamlazz/szamlazz-connection.types.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { buildIssueInput } from "./billing-document-issue.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import {
  BillingDocumentAdapterError,
  toSzamlazzAgentInput,
} from "./billing-document-szamlazz.adapter.js";
import { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { toBillingDocumentDetail } from "./billing-documents.service.js";
import { billingIssueEnabled } from "./billing-issue.config.js";

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

  async issue(
    id: string,
    expectedUpdatedAt: string,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    if (!billingIssueEnabled(this.environment))
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

    let agentKey: string;
    try {
      agentKey = (await this.credentials.resolve()).agentKey;
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

    let response;
    try {
      response = await this.client.generateInvoice(xml);
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
        issueDate: new Date(),
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
