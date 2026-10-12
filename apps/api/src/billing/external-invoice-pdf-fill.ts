import { prisma } from "@acropora/database";

import { buildSzamlazzAgentPdfXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import {
  SzamlazzAgentHttpError,
  type SzamlazzAgentPdfClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";

/**
 * A SZÁMLÁZZ.HU FELÜLETÉN KIÁLLÍTOTT SZÁMLA PDF-JE (hétfői lista N1, Balázs
 * 2026-10-09). Ezek a számlák a Számlázz.hu feedjéből jönnek
 * (`ExternalBillingDocument`, `source` SZAMLAZZ), és a feed PDF-et nem ad; az
 * eBIZ-forrású sor PDF-jét a saját szinkronja tölti le. Ez a pótlás az Agent
 * API `xmlszamlapdf` kérésével, számlaszám szerint kéri le és tárolja.
 *
 * A PDF-et nem adó számla nem esik ki csendben: a sor `pdfMissingReason`-t kap,
 * és a következő futás újra megpróbálja.
 */
export const SZAMLAZZ_PDF_DOCUMENT_ID = "szamlazz.pdf";

export interface ExternalPdfCandidate {
  id: string;
  documentNumber: string;
  issueDate: Date;
}

/**
 * A Számlázz.hu 7-es hibája: nincs ilyen számlaszám. Egy ilyen sor a
 * következő futáson sem fog PDF-et kapni, ezért alapból kimarad (barracuda,
 * #1658); a `retryUnknown` mégis újrapróbálja.
 */
export const UNKNOWN_NUMBER_REASON = "SZAMLAZZ_PDF_REJECTED_7";

export interface ExternalPdfStore {
  /**
   * A SZAMLAZZ-forrású, PDF nélküli sorok; `month` (ÉÉÉÉ-HH) a kelte szerint.
   * Az ismeretlen számú sor (`UNKNOWN_NUMBER_REASON`) csak `retryUnknown`-nal.
   */
  candidates(
    month: string | null,
    options?: { retryUnknown?: boolean },
  ): Promise<ExternalPdfCandidate[]>;
  setPdf(
    id: string,
    pdfStorageKey: string | null,
    pdfMissingReason: string | null,
  ): Promise<void>;
}

export type ExternalPdfOutcome =
  | { id: string; documentNumber: string; kind: "STORED"; bytes: number }
  | { id: string; documentNumber: string; kind: "FAILED"; reason: string };

export async function fillExternalInvoicePdfs(input: {
  candidates: readonly ExternalPdfCandidate[];
  agentKey: string;
  client: SzamlazzAgentPdfClient;
  documents: Pick<DocumentStore, "put">;
  store: Pick<ExternalPdfStore, "setPdf">;
}): Promise<ExternalPdfOutcome[]> {
  const outcomes: ExternalPdfOutcome[] = [];
  for (const row of input.candidates) {
    const base = { id: row.id, documentNumber: row.documentNumber };
    let bytes: Buffer;
    try {
      bytes = await fetchPdf(input, row.documentNumber);
    } catch (error) {
      const reason = reasonOf(error);
      await markFailed(input.store, row.id, reason);
      outcomes.push({ ...base, kind: "FAILED", reason });
      continue;
    }
    const key = {
      owner: "external-invoice" as const,
      ownerId: row.id,
      documentId: SZAMLAZZ_PDF_DOCUMENT_ID,
    };
    // egy tár- vagy adatbázis-hiba ennél a számlánál áll meg, nem a futásnál
    // (barracuda, #1658)
    try {
      await input.documents.put(key, bytes);
      await input.store.setPdf(row.id, storageKeyFor(key), null);
    } catch {
      const reason = "SZAMLAZZ_PDF_STORE_FAILED";
      await markFailed(input.store, row.id, reason);
      outcomes.push({ ...base, kind: "FAILED", reason });
      continue;
    }
    outcomes.push({ ...base, kind: "STORED", bytes: bytes.length });
  }
  return outcomes;
}

/** A hiba okát a sorra írja; ha ez sem megy, a futás a kimenetben jelenti. */
async function markFailed(
  store: Pick<ExternalPdfStore, "setPdf">,
  id: string,
  reason: string,
): Promise<void> {
  try {
    await store.setPdf(id, null, reason);
  } catch {
    // a kimenet és a kilépési kód így is FAILED-et mond
  }
}

class PdfFetchError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function fetchPdf(
  input: { agentKey: string; client: SzamlazzAgentPdfClient },
  invoiceNumber: string,
): Promise<Buffer> {
  const response = await input.client.downloadInvoicePdf(
    buildSzamlazzAgentPdfXml({ agentKey: input.agentKey, invoiceNumber }),
  );
  if (!response.successful)
    throw new PdfFetchError(
      `SZAMLAZZ_PDF_REJECTED${response.errorCode ? `_${response.errorCode}` : ""}`,
    );
  if (!response.pdf?.length) throw new PdfFetchError("SZAMLAZZ_PDF_EMPTY");
  // egy hibaoldal vagy egy csonka válasz nem kerülhet a könyvelő elé
  if (response.pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new PdfFetchError("SZAMLAZZ_PDF_NOT_PDF");
  return response.pdf;
}

function reasonOf(error: unknown): string {
  if (error instanceof PdfFetchError) return error.code;
  if (error instanceof SzamlazzAgentHttpError)
    return `SZAMLAZZ_PDF_HTTP_${error.status}`;
  return "SZAMLAZZ_PDF_FAILED";
}

/** Egy hónap (ÉÉÉÉ-HH) első napja és a következő hónap első napja, UTC. */
export function monthRange(month: string): { gte: Date; lt: Date } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error(`a hónap alakja ÉÉÉÉ-HH, nem: ${month}`);
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return {
    gte: new Date(Date.UTC(year, index, 1)),
    lt: new Date(Date.UTC(year, index + 1, 1)),
  };
}

export const prismaExternalPdfStore: ExternalPdfStore = {
  async candidates(month, options) {
    return prisma.externalBillingDocument.findMany({
      where: {
        source: "SZAMLAZZ",
        pdfStorageKey: null,
        documentNumber: { not: "" },
        ...(month ? { issueDate: monthRange(month) } : {}),
        // a `not` a NULL-t is kizárná, ezért a hiba nélküli sor külön ág
        ...(options?.retryUnknown
          ? {}
          : {
              OR: [
                { pdfMissingReason: null },
                { pdfMissingReason: { not: UNKNOWN_NUMBER_REASON } },
              ],
            }),
      },
      select: { id: true, documentNumber: true, issueDate: true },
      orderBy: [{ issueDate: "asc" }, { documentNumber: "asc" }],
    });
  },
  async setPdf(id, pdfStorageKey, pdfMissingReason) {
    await prisma.externalBillingDocument.update({
      where: { id },
      data: { pdfStorageKey, pdfMissingReason },
    });
  },
};
