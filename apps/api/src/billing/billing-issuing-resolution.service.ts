import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  billingEmailDelivery,
  type AuthenticatedUser,
  type BillingDocumentDetail,
  type BillingDocumentType,
  type BillingIssuingCheck,
  type BillingIssuingResolveInput,
  type InvoiceFormat,
} from "@acropora/types";
import type { Prisma } from "@acropora/database";

import {
  HttpSzamlazzAgentClient,
  type SzamlazzAgentPdfClient,
  type SzamlazzAgentQueryClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { buildSzamlazzAgentPdfXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import { SzamlazzConnectionError } from "../integrations/szamlazz/szamlazz-connection.types.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { buildIssueInput } from "./billing-document-issue.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import {
  BILLING_ISSUE_ENV,
  BILLING_SZAMLAZZ_CLIENT,
  ISSUED_PDF,
} from "./billing-document-issue.service.js";
import { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { toBillingDocumentDetail } from "./billing-documents.service.js";
import { billingIssueMode } from "./billing-issue.config.js";
import { classifyIssuing } from "./billing-issuing-diagnose.js";
import {
  decideResolution,
  lookupKeyFor,
  type ResolutionDecision,
} from "./billing-issuing-resolution.js";
import {
  ISSUING_AUDIT,
  BillingIssuingResolutionRepository,
} from "./billing-issuing-resolution.repository.js";
import { isOwnRow } from "./billing-own-rows.js";
import {
  buildSzamlazzQueryXml,
  parseSzamlazzQueryResponse,
  type SzamlazzQueryKey,
  type SzamlazzQueryResult,
} from "./billing-szamlazz-query.js";

type QueryClient = Partial<SzamlazzAgentQueryClient & SzamlazzAgentPdfClient>;

interface Evaluation {
  check: BillingIssuingCheck;
  decision: ResolutionDecision;
  lookup: SzamlazzQueryResult | { outcome: "UNAVAILABLE" };
  agentKey: string;
  note: string | null;
  documentType: BillingDocumentType;
  invoiceFormat: InvoiceFormat | null;
}

/**
 * A KIÁLLÍTÁS VÉSZÁLLAPOTÁBÓL KIVEZETŐ ÚT (kártya 38e9271d; terv: acrobot
 * jóváhagyása, 37530). KÉT LÉPÉS:
 *
 *   check    lekérdezi a Számlázz.hu-t (CSAK OLVAS), és megmondja, mit lehet
 *            tenni. Állapotot nem ír, csak az ellenőrzés nyomát az AuditLogba.
 *   resolve  a megerősített javaslattal jön, a szerver MÉG EGYSZER lekérdez
 *            (a kliens szavát nem hiszi el), egyezést vár, és feltételesen ír.
 *
 * A KIÁLLÍTÓ HÍVÁS ITT SEHOL NINCS, DE A KIZÁRÁS A TÍPUSÉ, NEM A FUTÁSIDEJŰ
 * OBJEKTUMÉ (barracuda, #1961): a `QueryClient` típus csak a lekérdező és a
 * PDF-letöltő metódust engedi, a beinjektált futásidejű kliens viszont
 * ugyanaz a `HttpSzamlazzAgentClient`, aminek van `generateInvoice`-a. Amit
 * ez tartja: az osztály kódja sehol nem hívja (a tesztben a hamis kliens
 * `generateInvoice`-a eldobja a futást), és az integrációs spec megméri, hogy
 * az ellenőrzés és a végrehajtás előtt és után a kiállító hívások száma
 * egyezik. Dupla kiállítás ellen a fő védelem a döntés: a kockázat az volt,
 * hogy egy hamis
 * "nincs szám" DRAFT-ba teszi a sort, és a kiállítás gombja másodikat állít
 * ki. Ezért a DRAFT-hoz a döntés (billing-issuing-resolution.ts) pozitív
 * kontrollt, kort és érvényes 7-es hibakódot kér.
 *
 * A Számlázz.hu válaszából CSAK a szám, a kelt, a végösszeg, a típus és a
 * hibakód kerül tárolásra / naplóba (acrobot, 37530): a teljes XML-t nem
 * őrizzük, mert vevő-adatot hordoz.
 */
@Injectable()
export class BillingIssuingResolutionService {
  private readonly logger = new Logger(BillingIssuingResolutionService.name);

  constructor(
    private readonly documents: BillingDocumentsRepository,
    private readonly repository: BillingIssuingResolutionRepository,
    private readonly issueRepository: BillingDocumentIssueRepository,
    private readonly credentials: SzamlazzCredentialProvider,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
    private readonly stock: BillingDocumentStockRepository,
    @Optional()
    @Inject(BILLING_SZAMLAZZ_CLIENT)
    private readonly client: QueryClient = new HttpSzamlazzAgentClient(),
    @Optional()
    @Inject(BILLING_ISSUE_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async check(
    id: string,
    user: AuthenticatedUser,
  ): Promise<BillingIssuingCheck> {
    this.requireLive();
    const head = await this.documents.find(id);
    if (
      head &&
      isOwnRow(head) &&
      (head.status === "ISSUED" || head.status === "DRAFT")
    )
      return this.probe(head, user);
    const evaluation = await this.evaluate(id);
    await this.repository.audit({
      actorUserId: user.id,
      invoiceId: id,
      action: ISSUING_AUDIT.check,
      metadata: this.checkMetadata(evaluation),
    });
    return evaluation.check;
  }

  /**
   * A LEKÉRDEZÉS MÉRÉSE NEM ISSUING SOROKON (acrobot kérése, 10-28: az első éles
   * olvasáshoz nincs ISSUING sor). CSAK OLVAS, és semmilyen javaslatot nem ad:
   *   - kiállított saját sor: a külső azonosítójára a Számlázz.hu a SAJÁT számát
   *     kell adja (ez a "talált" eset);
   *   - vázlat: a Számlázz.hu nem ismerheti az azonosítót, a hibakód 7 jön
   *     (ez a "nincs találat" eset).
   * A végrehajtás ezt nem fogadja el (a `resolve` csak ISSUING sort ír).
   */
  private async probe(
    row: NonNullable<Awaited<ReturnType<BillingDocumentsRepository["find"]>>>,
    user: AuthenticatedUser,
  ): Promise<BillingIssuingCheck> {
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
    const lookup = await this.query(agentKey, {
      by: "externalId",
      value: row.id,
    });
    const issued = row.status === "ISSUED";
    let reason: string;
    let outcome: "FOUND" | "NOT_FOUND" | "UNKNOWN" = "UNKNOWN";
    if (lookup.outcome === "FOUND") {
      outcome = "FOUND";
      reason =
        issued && lookup.invoiceNumber === row.invoiceNumber
          ? `Próba: a Számlázz.hu megtalálta a kiállított bizonylatot a külső azonosítójával, a saját számával (${lookup.invoiceNumber}): a lekérdezés működik.`
          : `Próba: ELLENTMONDÁS, a Számlázz.hu a(z) ${lookup.invoiceNumber} számot adja erre az azonosítóra, ami nem egyezik a ${issued ? "tárolt számmal" : "vázlattal (vázlathoz nem lehet bizonylat)"}.`;
    } else if (lookup.outcome === "NOT_FOUND") {
      outcome = "NOT_FOUND";
      reason = issued
        ? "Próba: ELLENTMONDÁS, a Számlázz.hu nem találja a kiállított bizonylatot a külső azonosítójával (hibakód 7): a lekérdezés vagy az azonosító nem működik, a 7-es hibakód nem hihető."
        : "Próba: a Számlázz.hu nem ismeri a vázlat azonosítóját (hibakód 7), ahogy egy sosem kiállított vázlatnál várható.";
    } else {
      reason =
        "Próba: a Számlázz.hu válasza nem érkezett meg, hibakódot adott, vagy nem érthető.";
    }
    await this.repository.audit({
      actorUserId: user.id,
      invoiceId: row.id,
      action: ISSUING_AUDIT.check,
      metadata: {
        probe: true,
        status: row.status,
        szamlazzOutcome: lookup.outcome,
        ...(lookup.outcome === "FOUND"
          ? {
              szamlazzInvoiceNumber: lookup.invoiceNumber,
              szamlazzKindCode: lookup.kindCode,
              szamlazzGrossTotal: lookup.grossTotal,
            }
          : {}),
        ...(lookup.outcome === "ERROR" ? { errorCode: lookup.errorCode } : {}),
      },
    });
    return {
      documentId: row.id,
      kind: null,
      probe: true,
      lookup: outcome,
      action: "NONE",
      invoiceNumber: null,
      reason,
      expectedUpdatedAt: row.updatedAt.toISOString(),
      ageMinutes: Math.max(
        0,
        Math.floor((Date.now() - row.updatedAt.getTime()) / 60_000),
      ),
    };
  }

  private requireLive(): void {
    const mode = billingIssueMode(this.environment);
    if (mode !== "live")
      throw new ConflictException(
        mode === "conflict"
          ? "A kiállítás beállítása ellentmondásos: a valódi kiállítás és az álszámlázó egyszerre van bekapcsolva."
          : "Az ellenőrzés csak a valódi Számlázz.hu-kapcsolattal megy: ezen a szerveren nincs bekapcsolva.",
      );
  }

  async resolve(
    id: string,
    input: BillingIssuingResolveInput,
    user: AuthenticatedUser,
  ): Promise<BillingDocumentDetail> {
    const evaluation = await this.evaluate(id);
    const { check, decision } = evaluation;
    if (
      check.expectedUpdatedAt !== input.expectedUpdatedAt ||
      decision.action !== input.action ||
      decision.invoiceNumber !== (input.invoiceNumber ?? null)
    )
      throw new ConflictException(
        "Az ellenőrzés óta változott a bizonylat vagy a Számlázz.hu válasza: futtasd újra az ellenőrzést, és azt erősítsd meg.",
      );
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    const metadata = {
      ...this.checkMetadata(evaluation),
      previousNote: evaluation.note?.slice(0, 500) ?? null,
    } satisfies Prisma.InputJsonObject;

    if (decision.action === "BACK_TO_DRAFT") {
      const done = await this.repository.backToDraft({
        id,
        expectedUpdatedAt,
        actorUserId: user.id,
        auditMetadata: metadata,
      });
      if (!done) throw this.changedMeanwhile();
      return this.detail(id);
    }

    // RECORD_ISSUED: a döntés csak kelttel és számmal engedi idáig
    const found = evaluation.lookup;
    if (found.outcome !== "FOUND" || !found.issueDate)
      throw this.changedMeanwhile();
    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    const built = buildIssueInput(row);
    if (!built.ok) throw this.changedMeanwhile();
    const delivery = billingEmailDelivery(
      evaluation.documentType,
      evaluation.invoiceFormat,
    );
    const done = await this.repository.recordIssued({
      id,
      expectedUpdatedAt,
      actorUserId: user.id,
      invoiceNumber: found.invoiceNumber,
      issueDate: new Date(`${found.issueDate}T00:00:00.000Z`),
      buyer: built.buyer,
      lines: built.lines,
      totals: built.totals,
      emailStatus: delivery === "REQUIRED" ? "PENDING" : "NOT_REQUIRED",
      auditMetadata: metadata,
    });
    if (!done) throw this.changedMeanwhile();
    await this.fetchPdf(id, found.invoiceNumber, evaluation.agentKey);
    try {
      await this.stock.postIssuedInvoice(id, user.id);
    } catch (error) {
      this.logger.error(
        `A(z) ${id} bizonylat készletkönyvelése nem sikerült: ${
          error instanceof Error ? error.message : "ismeretlen hiba"
        }`,
      );
    }
    return this.detail(id);
  }

  private changedMeanwhile() {
    return new ConflictException(
      "A bizonylat közben megváltozott: töltsd újra, és futtasd újra az ellenőrzést.",
    );
  }

  private async detail(id: string): Promise<BillingDocumentDetail> {
    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    return toBillingDocumentDetail(row);
  }

  private checkMetadata(evaluation: Evaluation): Prisma.InputJsonObject {
    const { check, lookup } = evaluation;
    return {
      kind: check.kind,
      lookup: check.lookup,
      action: check.action,
      invoiceNumber: check.invoiceNumber,
      ageMinutes: check.ageMinutes,
      szamlazzOutcome: lookup.outcome,
      ...(lookup.outcome === "FOUND"
        ? {
            szamlazzInvoiceNumber: lookup.invoiceNumber,
            szamlazzKindCode: lookup.kindCode,
            szamlazzGrossTotal: lookup.grossTotal,
          }
        : {}),
      ...(lookup.outcome === "ERROR" ? { errorCode: lookup.errorCode } : {}),
    };
  }

  /** A PDF-letöltés a rögzítés után, a kiállításhoz hasonlóan: hiánya nem veszi el a rögzítést. */
  private async fetchPdf(
    id: string,
    invoiceNumber: string,
    agentKey: string,
  ): Promise<void> {
    if (!this.client.downloadInvoicePdf) return;
    try {
      const response = await this.client.downloadInvoicePdf(
        buildSzamlazzAgentPdfXml({ agentKey, invoiceNumber }),
      );
      if (!response.pdf) return;
      const key = {
        owner: "invoice" as const,
        ownerId: id,
        documentId: ISSUED_PDF,
      };
      await this.documentStore.put(key, response.pdf);
      await this.issueRepository.setPdf(id, storageKeyFor(key));
    } catch (error) {
      this.logger.warn(
        `A(z) ${invoiceNumber} PDF-jének letöltése nem sikerült: ${
          error instanceof Error ? error.name : "ismeretlen hiba"
        }`,
      );
    }
  }

  /** Egy lekérdezés. Minden hiba (hálózat, HTTP, érthetetlen válasz) "nem érkezett érthető válasz". */
  private async query(
    agentKey: string,
    key: SzamlazzQueryKey,
  ): Promise<SzamlazzQueryResult | { outcome: "UNAVAILABLE" }> {
    if (!this.client.queryDocument) return { outcome: "UNAVAILABLE" };
    try {
      const body = await this.client.queryDocument(
        buildSzamlazzQueryXml({ agentKey, key }),
      );
      return parseSzamlazzQueryResponse(body);
    } catch {
      return { outcome: "UNAVAILABLE" };
    }
  }

  private async evaluate(id: string): Promise<Evaluation> {
    this.requireLive();
    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    if (!isOwnRow(row))
      throw new ConflictException(
        "Csak a saját kiállítású bizonylat ellenőrizhető.",
      );
    if (row.status !== "ISSUING")
      throw new ConflictException(
        "Csak az ISSUING (ellenőrzésre váró) állapotú bizonylat ellenőrizhető.",
      );

    const now = new Date();
    const classified = classifyIssuing(
      {
        id: row.id,
        documentType: row.documentType,
        status: row.status,
        syncError: row.syncError,
        invoiceNumber: row.invoiceNumber,
        issueAttemptCount: row.issueAttemptCount,
        updatedAt: row.updatedAt,
      },
      now,
    );
    const ageMinutes = Math.max(
      0,
      Math.floor((now.getTime() - row.updatedAt.getTime()) / 60_000),
    );
    const documentType = row.documentType as BillingDocumentType;
    const invoiceFormat = (row.invoiceFormat as InvoiceFormat | null) ?? null;
    const base = {
      documentId: row.id,
      kind: classified.kind,
      ageMinutes,
      expectedUpdatedAt: row.updatedAt.toISOString(),
    };
    const unknown = (reason: string, agentKey: string): Evaluation => ({
      check: {
        ...base,
        lookup: "UNKNOWN",
        action: "NONE",
        invoiceNumber: null,
        reason,
      },
      decision: {
        lookup: "UNKNOWN",
        action: "NONE",
        invoiceNumber: null,
        reason,
      },
      lookup: { outcome: "UNAVAILABLE" },
      agentKey,
      note: row.syncError,
      documentType,
      invoiceFormat,
    });

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

    const built = buildIssueInput(row);
    if (!built.ok)
      return unknown(
        "A vázlat adataiból nem számolható a végösszeg, ezért nincs mivel összevetni a Számlázz.hu bizonylatát.",
        agentKey,
      );
    const lookupKey = lookupKeyFor(classified.kind, classified.knownNumber);
    if (!lookupKey)
      return unknown(
        "A hibaszövegben nincs számlaszám, amivel a bizonylat megkereshető lenne.",
        agentKey,
      );

    const lookup = await this.query(
      agentKey,
      lookupKey.by === "externalId"
        ? { by: "externalId", value: row.id }
        : lookupKey,
    );

    // POZITÍV KONTROLL, csak ha a "nincs ilyen azonosító" válasz dönthet
    let controlProven = false;
    if (
      lookup.outcome === "NOT_FOUND" &&
      classified.kind !== "RECORDING_FAILED" &&
      classified.kind !== "STRAY_PREVIEW"
    ) {
      const control =
        await this.repository.latestIssuedForControl(documentType);
      if (control) {
        const controlResult = await this.query(agentKey, {
          by: "externalId",
          value: control.id,
        });
        controlProven =
          controlResult.outcome === "FOUND" &&
          controlResult.invoiceNumber === control.invoiceNumber;
      }
    }

    const decision = decideResolution({
      kind: classified.kind,
      knownNumber: classified.knownNumber,
      ageMinutes,
      documentType,
      computedGross: built.totals.grossAmount,
      lookup,
      controlProven,
    });
    return {
      check: {
        ...base,
        lookup: decision.lookup,
        action: decision.action,
        invoiceNumber: decision.invoiceNumber,
        reason: decision.reason,
      },
      decision,
      lookup,
      agentKey,
      note: row.syncError,
      documentType,
      invoiceFormat,
    };
  }
}
