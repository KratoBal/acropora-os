import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { GoogleReadonlyClient } from "../integrations/google/google-readonly.client.js";
import { supplierInvoiceMailCredentials } from "../purchasing/expected-arrivals/supplier-invoice-mail.config.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  createDocumentStore,
  documentStoreEnabled,
} from "../service-assets/document-store/document-store.provider.js";
import {
  CMFX_SENDER,
  cmfxMailAuthenticated,
  cmfxMailQuery,
  fillExternalPdfsFromMail,
  mailPdfCandidates,
  type MailPdf,
  type MailPdfCandidate,
} from "./external-invoice-mail-pdf.js";
import {
  monthRange,
  prismaExternalPdfStore,
} from "./external-invoice-pdf-fill.js";

/**
 * A CMFX-BEN KIÁLLÍTOTT KIMENŐ SZÁMLÁK PDF-JE AZ INFO@ LEVELEIBŐL (kártya 07ec8219):
 *
 *   pnpm --filter @acropora/api external-invoice-mail-pdf:fill --month ÉÉÉÉ-HH [--apply]
 *
 * Az éles képben (pnpm deploy --prod, nincs fordító, nincs .env): a konténerben, `-w /app`:
 *
 *   node dist/billing/external-invoice-mail-pdf.cli.js --month ÉÉÉÉ-HH [--apply]
 *
 * Mindig egy megnevezett hónapra fut. `--apply` nélkül CSAK OLVAS: a Gmailből (info@, csak olvasó
 * kulcs) a `ertesito@cmfx.hu` leveleit és PDF-mellékleteit, az adatbázisból a hónap PDF nélküli
 * feed-sorait, és kiírja, mit tárolna. `--apply`: a PDF a dokumentumtárba, a sor `pdfStorageKey`-je
 * rá mutat. A Gmailben és a cmfx-ben semmit nem változtat.
 *
 * Soronként: STORED / WOULD_STORE / NO_MAIL / NOT_PDF / NUMBER_NOT_IN_PDF / STORE_FAILED, utána a
 * levélben talált, de nem jelölt számok, okkal (már van PDF-je; másik hónap sora; NINCS SZÁMLA-SORA:
 * a feed nem hozta a számlát, a PDF megvan).
 *
 * Kilépés: 0 rendben (szárazon: nincs mit tárolni); 1 száraz futás, VAN mit tárolni; 2 rossz hónap,
 * hiányzó levélkulcs vagy `--apply` dokumentumtár nélkül; 3 legalább egy számla PDF-je megvolt, de
 * nem tárolódott (NOT_PDF, NUMBER_NOT_IN_PDF, NOT_OUR_INVOICE: a saját adószámunk nincs benne,
 * STORE_FAILED), vagy csak hitelesítetlen levélben jött
 * (NOT_AUTHENTICATED: a Gmail legfelső ítélete nem igazolja a cmfx DKIM-aláírását és DMARC-ját).
 */
export async function main(
  argv: readonly string[],
  io: { out: (text: string) => void; err: (text: string) => void } = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  },
  deps: {
    candidates?: (month: string) => Promise<MailPdfCandidate[]>;
    mail?: (month: string) => Promise<MailPdf[]>;
    rowsByNumber?: (numbers: readonly string[]) => Promise<NumberRow[]>;
    documents?: () => Pick<DocumentStore, "put"> | null;
    store?: { setPdf(id: string, key: string, reason: null): Promise<void> };
    textOf?: (bytes: Uint8Array) => Promise<string[]>;
  } = {},
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const at = argv.indexOf("--month");
  const month = at >= 0 ? (argv[at + 1] ?? "") : "";
  try {
    monthRange(month);
  } catch {
    io.err("A hónap kötelező: --month ÉÉÉÉ-HH\n");
    return 2;
  }
  const apply = argv.includes("--apply");

  const documents = (
    deps.documents ??
    (() =>
      documentStoreEnabled(environment)
        ? createDocumentStore(environment)
        : null)
  )();
  if (apply && !documents) {
    io.err(
      "A dokumentumtár nincs beállítva (DOCUMENT_STORE_ROOT): a PDF-et nem lenne hová tenni.\n",
    );
    return 2;
  }
  let mail = deps.mail;
  if (!mail) {
    const credentials = supplierInvoiceMailCredentials(environment);
    if (!credentials) {
      io.err(
        "Az info@ levélkulcsa nincs beállítva (GMAIL_SUPPLIER_INVOICE_*): a leveleket nem lehet olvasni.\n",
      );
      return 2;
    }
    const user =
      environment.INVOICE_COLLECTION_INFO_USER?.trim() || "info@acropora.hu";
    const google = new GoogleReadonlyClient({
      credentials,
      requestGapMs: REQUEST_GAP_MS,
    });
    mail = (m) => readCmfxMail(google, user, m);
  }

  const candidates = await (deps.candidates ?? mailPdfCandidates)(month);
  const pdfs = await mail(month);
  const report = await fillExternalPdfsFromMail({
    candidates,
    pdfs,
    apply,
    textOf: deps.textOf ?? pdfTextLines,
    documents,
    store: deps.store ?? prismaExternalPdfStore,
  });

  io.out(
    `Levél a ${CMFX_SENDER} címről (${month}): ${pdfs.length} PDF; PDF nélküli feed-sor: ${candidates.length}\n`,
  );
  for (const outcome of report.outcomes)
    io.out(
      `${outcome.kind.padEnd(17)} ${outcome.documentNumber}${"bytes" in outcome ? ` (${outcome.bytes} bájt)` : ""}\n`,
    );

  const rows = await (deps.rowsByNumber ?? prismaRowsByNumber)(
    report.notCandidates,
  );
  const byNumber = new Map(rows.map((row) => [row.documentNumber.trim(), row]));
  for (const number of report.notCandidates) {
    const row = byNumber.get(number);
    const state = !row
      ? "NINCS_SZAMLA_SOR"
      : row.hasPdf
        ? "MAR_VAN_PDF"
        : `MASIK_HONAP ${row.issueDate.toISOString().slice(0, 7)}`;
    io.out(`${state.padEnd(17)} ${number}\n`);
  }
  if (report.unauthenticatedFiles)
    io.out(
      `Hitelesítetlen levél PDF-je (nem cmfx-aláírású, nem tárolódik): ${report.unauthenticatedFiles}\n`,
    );
  if (report.unrecognizedFiles)
    io.out(`Nem cmfx alakú melléklet-név: ${report.unrecognizedFiles}\n`);

  const count = (kind: string) =>
    report.outcomes.filter((o) => o.kind === kind).length;
  const failed =
    count("NOT_PDF") +
    count("NUMBER_NOT_IN_PDF") +
    count("NOT_OUR_INVOICE") +
    count("STORE_FAILED") +
    count("NOT_AUTHENTICATED");
  io.out(
    `Összesen: ${apply ? `tárolva ${count("STORED")}` : `tárolná ${count("WOULD_STORE")}`}, levél nélkül ${count("NO_MAIL")}, ` +
      `hibás ${failed}, számla-sor nélküli levél ${report.notCandidates.filter((n) => !byNumber.has(n)).length}\n`,
  );
  if (!apply) {
    io.out("Ez a futás nem írt. A tároláshoz: --apply\n");
    return count("WOULD_STORE") ? 1 : failed ? 3 : 0;
  }
  return failed ? 3 : 0;
}

export interface NumberRow {
  documentNumber: string;
  issueDate: Date;
  hasPdf: boolean;
}

async function prismaRowsByNumber(
  numbers: readonly string[],
): Promise<NumberRow[]> {
  if (!numbers.length) return [];
  const rows = await prisma.externalBillingDocument.findMany({
    where: { documentNumber: { in: [...numbers] } },
    select: { documentNumber: true, issueDate: true, pdfStorageKey: true },
  });
  return rows.map((row) => ({
    documentNumber: row.documentNumber,
    issueDate: row.issueDate,
    hasPdf: row.pdfStorageKey !== null,
  }));
}

/**
 * Két Gmail-kérés között legalább ennyi: ugyanaz, mint a bejövő számla-begyűjtésé
 * (`INVOICE_COLLECTION_REQUEST_GAP_MS`), mert ugyanazt az info@ kvótát használja (éles 2026-10-01: a
 * szünet nélküli letöltés 188 fájl után GOOGLE_RATE_LIMITED). Itt nem importálva: a begyűjtő
 * szolgáltatás a teljes beszerzési modult húzná be egy parancssori futásba.
 */
const REQUEST_GAP_MS = 250;

/**
 * A hónap cmfx-levelei és PDF-mellékletei, mindegyik a levél hitelesítési ítéletével. Exportálva, hogy
 * a teszt hamis Gmail-klienssel mérje: a hitelesítés bekötése nem maradhat bizonyítatlan (#1777).
 */
export async function readCmfxMail(
  google: Pick<GoogleReadonlyClient, "gmailMessageIds" | "gmailPdfMessage">,
  user: string,
  month: string,
): Promise<MailPdf[]> {
  const pdfs: MailPdf[] = [];
  for (const id of await google.gmailMessageIds(user, cmfxMailQuery(month))) {
    const message = await google.gmailPdfMessage(user, id);
    // a keresés a feladóra szűr; a fejléc a második őr, egy továbbított levél ne számítson
    if (message.sender?.toLowerCase() !== CMFX_SENDER) continue;
    for (const pdf of message.pdfs)
      pdfs.push({
        messageId: id,
        fileName: pdf.fileName,
        buffer: pdf.buffer,
        authenticated: cmfxMailAuthenticated(
          message.authenticationResults ?? [],
        ),
      });
  }
  return pdfs;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 2;
    })
    .finally(() => void prisma.$disconnect());
}
