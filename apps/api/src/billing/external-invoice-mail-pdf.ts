import { prisma } from "@acropora/database";

import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import { monthRange } from "./external-invoice-pdf-fill.js";

/**
 * A KIMENŐ SZÁMLA PDF-JE A VEVŐNEK KÜLDÖTT LEVÉLBŐL (kártya 07ec8219, Balázs 2026-10-21: „a számlák nem
 * a számlázz.hu-ban készülnek, hanem a cmfx-ben”, „majdnem az összes számlát elküldjük emailben is a
 * vevőnek, onnan is ki lehetne gyűjteni”).
 *
 * A webshop számláit a cmfx állítja ki; a Számlázz.hu feedje az adatukat hozza
 * (`ExternalBillingDocument`, SZAMLAZZ), a PDF-et nem, és a Számlázz.hu Agent API sem ismeri őket.
 * A cmfx a vevőnek küldött e-számla másolatát az info@ fiókba is elküldi (`ertesito@cmfx.hu`, tárgy
 * „E-számlát küldött: ...”), PDF-melléklettel, aminek a NEVE hordozza a számlaszámot:
 *
 *   E-ACRW-2026-00536-<hash>.pdf   ->   ACRW-2026/00536
 *
 * (acrobot mérése 2026-10-21: 30 nap alatt 37 ilyen levél, egy megnyitva: egy melléklet, valódi PDF.)
 *
 * A pótlás a #1658 tárolási útján: a PDF a dokumentumtárba (`external-invoice/<id>/cmfx.pdf`), a
 * sor `pdfStorageKey`-je rá mutat. Csak az a PDF tárolódik, amelynek a SZÖVEGÉBEN is ott áll a
 * fájlnévből olvasott számlaszám: egy elírt vagy félrecímkézett melléklet nem kerül rossz számlához.
 */
export const CMFX_PDF_DOCUMENT_ID = "cmfx.pdf";
export const CMFX_SENDER = "ertesito@cmfx.hu";

/**
 * A cmfx melléklet-nevéből a számlaszám; ha a név nem ilyen alakú, `null`. A záró hash-részben
 * betűnek is kell lennie: enélkül egy hash nélküli név (`E-ACRW-2026-00536.pdf`) `ACRW/2026`-ot adna.
 * Egy csupa számjegyből álló hash így kimarad, és a „nem cmfx alakú” számban látszik, nem rossz számként.
 */
export function numberFromCmfxFileName(fileName: string): string | null {
  const match = /^E-(.+)-(\d+)-([^-]*[A-Za-z][^-]*)\.pdf$/i.exec(
    fileName.trim(),
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * A Gmail-keresés a hónap számláihoz: a feladó és a melléklet, a hónap elejétől a következő hónap
 * 10-éig (a levél a kiállítás után megy ki, egy hónap végi számla levele átcsúszhat).
 */
export function cmfxMailQuery(month: string): string {
  const { gte, lt } = monthRange(month);
  const until = new Date(lt.getTime() + 10 * 24 * 3600 * 1000);
  const day = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "/");
  return `from:${CMFX_SENDER} has:attachment after:${day(gte)} before:${day(until)}`;
}

export interface MailPdfCandidate {
  id: string;
  documentNumber: string;
  issueDate: Date;
}

export interface MailPdf {
  messageId: string;
  fileName: string;
  buffer: Buffer;
}

export type MailPdfOutcome =
  | { kind: "STORED" | "WOULD_STORE"; documentNumber: string; bytes: number }
  | { kind: "NO_MAIL"; documentNumber: string }
  | {
      kind: "NOT_PDF" | "NUMBER_NOT_IN_PDF" | "STORE_FAILED";
      documentNumber: string;
    };

export interface MailPdfReport {
  outcomes: MailPdfOutcome[];
  /** Levélben talált számok, amelyek nem jelöltek (már van PDF-jük, vagy nem e hónapé, vagy nincs a feedben). */
  notCandidates: string[];
  /** Mellékletek, amelyeknek a neve nem a cmfx alakja. */
  unrecognizedFiles: number;
}

/**
 * A HÓNAP JELÖLTJEI ÉS A LEVELEK PÁROSÍTÁSA. `apply` nélkül semmit nem ír. Egy számhoz több levél is
 * jöhet (újraküldés): az első, ellenőrzésen átmenő PDF nyer.
 */
export async function fillExternalPdfsFromMail(input: {
  candidates: readonly MailPdfCandidate[];
  pdfs: readonly MailPdf[];
  apply: boolean;
  /** A PDF szövege soronként (`pdfTextLines`); hibánál dobhat. */
  textOf: (bytes: Uint8Array) => Promise<string[]>;
  documents: Pick<DocumentStore, "put"> | null;
  store: {
    setPdf(id: string, pdfStorageKey: string, reason: null): Promise<void>;
  };
}): Promise<MailPdfReport> {
  const byNumber = new Map<string, MailPdf[]>();
  let unrecognizedFiles = 0;
  for (const pdf of input.pdfs) {
    const number = numberFromCmfxFileName(pdf.fileName);
    if (!number) {
      unrecognizedFiles++;
      continue;
    }
    byNumber.set(number, [...(byNumber.get(number) ?? []), pdf]);
  }
  const wanted = new Set(input.candidates.map((c) => c.documentNumber.trim()));
  const outcomes: MailPdfOutcome[] = [];
  for (const row of input.candidates) {
    const number = row.documentNumber.trim();
    const pdfs = byNumber.get(number);
    if (!pdfs?.length) {
      outcomes.push({ kind: "NO_MAIL", documentNumber: number });
      continue;
    }
    let verdict: "NOT_PDF" | "NUMBER_NOT_IN_PDF" = "NOT_PDF";
    let chosen: MailPdf | null = null;
    for (const pdf of pdfs) {
      if (pdf.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") continue;
      const text = await input.textOf(pdf.buffer).catch(() => [] as string[]);
      if (!text.join("\n").includes(number)) {
        verdict = "NUMBER_NOT_IN_PDF";
        continue;
      }
      chosen = pdf;
      break;
    }
    if (!chosen) {
      outcomes.push({ kind: verdict, documentNumber: number });
      continue;
    }
    if (!input.apply) {
      outcomes.push({
        kind: "WOULD_STORE",
        documentNumber: number,
        bytes: chosen.buffer.length,
      });
      continue;
    }
    const key = {
      owner: "external-invoice" as const,
      ownerId: row.id,
      documentId: CMFX_PDF_DOCUMENT_ID,
    };
    try {
      if (!input.documents) throw new Error("no document store");
      await input.documents.put(key, chosen.buffer);
      await input.store.setPdf(row.id, storageKeyFor(key), null);
      outcomes.push({
        kind: "STORED",
        documentNumber: number,
        bytes: chosen.buffer.length,
      });
    } catch {
      // egy tár- vagy adatbázis-hiba ennél a számlánál áll meg, nem a futásnál (a #1658 szabálya)
      outcomes.push({ kind: "STORE_FAILED", documentNumber: number });
    }
  }
  const notCandidates = [...byNumber.keys()]
    .filter((number) => !wanted.has(number))
    .sort();
  return { outcomes, notCandidates, unrecognizedFiles };
}

/**
 * A hónap PDF nélküli feed-sorai. Az ok (`pdfMissingReason`) nem zár ki: egy Számlázz.hu-s 7-es
 * hibájú sor (a Számlázz.hu nem ismeri, mert a cmfx állította ki) épp az, amit a levél pótolhat.
 */
export async function mailPdfCandidates(
  month: string,
): Promise<MailPdfCandidate[]> {
  return prisma.externalBillingDocument.findMany({
    where: {
      source: "SZAMLAZZ",
      pdfStorageKey: null,
      documentNumber: { not: "" },
      issueDate: monthRange(month),
    },
    select: { id: true, documentNumber: true, issueDate: true },
    orderBy: [{ issueDate: "asc" }, { documentNumber: "asc" }],
  });
}
