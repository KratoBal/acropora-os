import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  GOOGLE_PDF_MAX_BYTES,
  GoogleReadonlyClient,
  GoogleReadonlyError,
} from "../integrations/google/google-readonly.client.js";
import {
  guardedFetch,
  readCapped,
  type PdfFetch,
} from "../knowledge-base/extraction/pdf-full-text.js";
import { driveReadonlyCredentials } from "../missing-invoices/collection/invoice-collection.config.js";
import { supplierInvoiceMailCredentials } from "../purchasing/expected-arrivals/supplier-invoice-mail.config.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  createDocumentStore,
  documentStoreEnabled,
} from "../service-assets/document-store/document-store.provider.js";
import { invoiceNumberKey } from "./external-billing-one-row.js";
import {
  CMFX_SENDER,
  cmfxMailAuthenticated,
  cmfxMailQuery,
  authVerdictLine,
  fillExternalPdfsFromMail,
  mailAuthenticatedFor,
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
 * A LEVÉL NÉLKÜLI SZÁMLÁK (Balázs 2026-10-21: „a 2026/ kezdetű számlákat a cmfx állítja ki, csak nem mindig
 * mennek ki emailben”): `--dir <mappa>` a levelek helyett egy mappa PDF-jeit olvassa. A fájlnév a cmfx
 * levél-mellékletének alakja (`E-2026-00082-0.pdf`, `E-ACRW-2026-00518-0.pdf`); ilyen nevet a flotta
 * cmfx-letöltője (agents/nautilus/scripts/cmfx-belepes-proba.mjs --mentes) ad. A mappát a futtató
 * ember teszi oda, tehát a fájl eredete az övé: a levél-hitelesítés itt nem értelmezhető, a szám, az
 * adószámunk és a fizetendő végösszeg ellenőrzése viszont ugyanúgy fut, és ugyanúgy tárol.
 *
 *   node dist/billing/external-invoice-mail-pdf.cli.js --month ÉÉÉÉ-HH --dir /tmp/cmfx-pdf [--apply]
 *
 * EGY MEGNEVEZETT SAJÁT LEVÉL (785dfea6, acrobot 59000: Luca havi „nyomtatandó csomag" levelei a cmfx-PDF-eket
 * mellékletként viszik): `--mail-id <gmail-azonosító>` a hónap cmfx-levelei helyett az info@ EGY levelét olvassa. Csak
 * akkor hiteles, ha a feladó @acropora.hu ÉS a Gmail legfelső ítélete szerint `dkim=pass` és `dmarc=pass` erre a
 * domainre (`mailAuthenticatedFor`); különben minden PDF-je NOT_AUTHENTICATED, és nem tárolódik. A melléklet neve a
 * csomagban `E-` nélküli (`2026-00002-1048133.pdf`): az olvasó elé teszi, hogy a cmfx-név szabálya olvassa. Utána
 * ugyanaz a szám-, adószám- és végösszeg-próba fut, mint a levélnél és a mappánál.
 *
 *   node dist/billing/external-invoice-mail-pdf.cli.js --month ÉÉÉÉ-HH --mail-id 19c20725a72c042a [--apply]
 *
 * EGY MEGNEVEZETT DRIVE-MAPPA (785dfea6, acrobot 59127, 59129): a flotta gépén álló PDF-ekhez az éles képben nincs út, a Drive-hoz
 * viszont van. `--drive-folder <mappa-azonosító>` a `--dir` párja: a mappa (nem kukázott) PDF-jeit a meglévő, csak olvasó Drive-kulccsal
 * (GOOGLE_DRIVE_*, ugyanaz, amivel a bejövő számla-begyűjtő a saját mappáját olvassa) tölti le, almappába nem megy. A mappát a
 * futtató nevezi meg, tehát az eredet az övé, mint a `--dir`-nél; az `E-` előtagot a csomag-nevekre ráteszi, mint a `--mail-id`.
 * A szám-, adószám- és végösszeg-próba ugyanaz. A túl nagy fájl kimarad, és a kimenet megnevezi.
 *
 *   node dist/billing/external-invoice-mail-pdf.cli.js --month ÉÉÉÉ-HH --drive-folder 1AbC...xyz [--apply]
 *
 * Soronként: STORED / WOULD_STORE / NO_MAIL / NOT_PDF / NUMBER_NOT_IN_PDF / STORE_FAILED, utána a
 * levélben talált, de nem jelölt számok, okkal (már van PDF-je; másik hónap sora; NINCS SZÁMLA-SORA:
 * a feed nem hozta a számlát, a PDF megvan).
 *
 * Kilépés: 0 rendben (szárazon: nincs mit tárolni); 1 száraz futás, VAN mit tárolni; 2 rossz hónap,
 * hiányzó levél- vagy Drive-kulcs vagy `--apply` dokumentumtár nélkül; 3 legalább egy számla PDF-je megvolt, de
 * nem tárolódott (NOT_PDF, NUMBER_NOT_IN_PDF, NOT_OUR_INVOICE: a saját adószámunk nincs benne,
 * AMOUNT_MISMATCH: a fizetendő végösszeg nem a feed-soré,
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
    ownInvoicesByNumber?: (
      numbers: readonly string[],
    ) => Promise<OwnInvoiceRow[]>;
    unasLinks?: (numbers: readonly string[]) => Promise<UnasInvoiceLink[]>;
    fetchPdf?: PdfFetch;
    sleep?: (ms: number) => Promise<void>;
    documents?: () => Pick<DocumentStore, "put"> | null;
    store?: {
      setPdf(id: string, key: string, reason: null): Promise<boolean | void>;
    };
    textOf?: (bytes: Uint8Array) => Promise<string[]>;
    /** The Gmail reader, for a spec; unset, the info@ key builds it. */
    google?: Pick<GoogleReadonlyClient, "gmailMessageIds" | "gmailPdfMessage">;
    /** The Drive reader, for a spec; unset, the GOOGLE_DRIVE_* key builds it. */
    drive?: Pick<GoogleReadonlyClient, "driveFolderPdfs" | "driveFile">;
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
  const dirAt = argv.indexOf("--dir");
  const dir = dirAt >= 0 ? (argv[dirAt + 1] ?? "") : null;
  // `--dir --apply`: the flag after --dir is not a folder (barracuda #1786)
  if (dir !== null && (!dir || dir.startsWith("--"))) {
    io.err("A --dir után a mappa kell.\n");
    return 2;
  }

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
  const unasLink = argv.includes("--unas-link");
  if (unasLink && dir !== null) {
    io.err("A --unas-link és a --dir közül egyszerre csak az egyik.\n");
    return 2;
  }
  const mailIdAt = argv.indexOf("--mail-id");
  const mailId = mailIdAt >= 0 ? (argv[mailIdAt + 1] ?? "") : null;
  if (mailId !== null && !GMAIL_ID.test(mailId)) {
    io.err(
      "A --mail-id után a levél Gmail-azonosítója kell (hexadecimális).\n",
    );
    return 2;
  }
  if (mailId !== null && (unasLink || dir !== null)) {
    io.err(
      "A --mail-id, a --unas-link és a --dir közül egyszerre csak az egyik.\n",
    );
    return 2;
  }
  const driveAt = argv.indexOf("--drive-folder");
  const driveFolder = driveAt >= 0 ? (argv[driveAt + 1] ?? "") : null;
  // `--drive-folder --apply`: a flag after it is not a folder, even one long enough to pass the id's shape (barracuda #2810)
  if (
    driveFolder !== null &&
    (driveFolder.startsWith("--") || !DRIVE_FOLDER_ID.test(driveFolder))
  ) {
    io.err("A --drive-folder után a Drive-mappa azonosítója kell.\n");
    return 2;
  }
  if (driveFolder !== null && (mailId !== null || unasLink || dir !== null)) {
    io.err(
      "A --drive-folder, a --mail-id, a --unas-link és a --dir közül egyszerre csak az egyik.\n",
    );
    return 2;
  }
  let mail =
    deps.mail ??
    (dir
      ? () => readPdfDir(dir)
      : unasLink
        ? async (m: string) =>
            readUnasLinkPdfs(
              await (deps.unasLinks ?? prismaUnasLinks)(
                (await (deps.candidates ?? mailPdfCandidates)(m)).map(
                  (row) => row.documentNumber,
                ),
              ),
              deps.fetchPdf ?? guardedFetch(),
              io.out,
              deps.sleep,
            )
        : undefined);
  if (!mail && driveFolder !== null) {
    const credentials = deps.drive
      ? null
      : driveReadonlyCredentials(environment);
    if (!deps.drive && !credentials) {
      io.err(
        "A Drive csak olvasó kulcsa nincs beállítva (GOOGLE_DRIVE_*): a mappát nem lehet olvasni.\n",
      );
      return 2;
    }
    const drive =
      deps.drive ??
      new GoogleReadonlyClient({
        credentials: credentials!,
        requestGapMs: CLI_REQUEST_GAP_MS,
        rateLimitDelaysMs: CLI_RATE_LIMIT_DELAYS_MS,
      });
    mail = () => readDriveFolder(drive, driveFolder, io.out);
  }
  if (!mail) {
    const credentials = deps.google
      ? null
      : supplierInvoiceMailCredentials(environment);
    if (!deps.google && !credentials) {
      io.err(
        "Az info@ levélkulcsa nincs beállítva (GMAIL_SUPPLIER_INVOICE_*): a leveleket nem lehet olvasni.\n",
      );
      return 2;
    }
    const user =
      environment.INVOICE_COLLECTION_INFO_USER?.trim() || "info@acropora.hu";
    const google =
      deps.google ??
      new GoogleReadonlyClient({
        credentials: credentials!,
        requestGapMs: CLI_REQUEST_GAP_MS,
        rateLimitDelaysMs: CLI_RATE_LIMIT_DELAYS_MS,
      });
    mail =
      mailId !== null
        ? () => readOwnMail(google, user, mailId, io.out)
        : (m) => readCmfxMail(google, user, m);
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
    dir
      ? `Fájl a ${dir} mappából (${month}): ${pdfs.length} PDF; PDF nélküli feed-sor: ${candidates.length}\n`
      : driveFolder !== null
        ? `Fájl a ${driveFolder} Drive-mappából (${month}): ${pdfs.length} PDF; PDF nélküli feed-sor: ${candidates.length}\n`
        : unasLink
          ? `Link az UNAS-rendelésekből (${month}): ${pdfs.length} PDF; PDF nélküli feed-sor: ${candidates.length}\n`
          : mailId !== null
            ? `A ${mailId} levél (${month}): ${pdfs.length} PDF, ${pdfs.some((p) => p.authenticated) ? "hiteles acropora.hu feladó" : "NEM hiteles acropora.hu feladó"}; PDF nélküli feed-sor: ${candidates.length}\n`
            : `Levél a ${CMFX_SENDER} címről (${month}): ${pdfs.length} PDF; PDF nélküli feed-sor: ${candidates.length}\n`,
  );
  // the folder's files with their size and fingerprint: the person reviewing the dry run compares them with the
  // downloader's lines, through the copies between the fleet and the production container (barracuda #1786)
  if (dir || driveFolder !== null || unasLink || mailId !== null)
    for (const pdf of pdfs)
      io.out(
        `FAJL ${pdf.fileName} ${pdf.buffer.length} bájt sha256:${createHash("sha256").update(pdf.buffer).digest("hex").slice(0, 16)}\n`,
      );
  for (const outcome of report.outcomes)
    io.out(
      `${outcome.kind.padEnd(17)} ${outcome.documentNumber}${"bytes" in outcome ? ` (${outcome.bytes} bájt)` : ""}${outcome.kind === "AMOUNT_MISMATCH" ? ` (a sor: ${outcome.expected}, a PDF: ${outcome.found ?? "nincs fizetendő-sor"})` : ""}\n`,
    );

  const rows = await (deps.rowsByNumber ?? prismaRowsByNumber)(
    report.notCandidates,
  );
  const byNumber = new Map(rows.map((row) => [row.documentNumber.trim(), row]));
  /*
    A SAJÁT SZÁMLA NEM HIÁNY (785dfea6, acrobot 58556, 58560): a levél nélküli külső sor mellett az OS saját `Invoice` táblájában
    is állhat a szám (a webshop ACRW-számlái az UNAS rendelés-szinkronból, source UNAS). A NAV-ellenőrzés ezt meglévőnek veszi,
    a kitöltő pedig csak a külső sorra ír; eddig ez NINCS_SZAMLA_SOR volt, ami hiánynak hangzott (2026-07: 12 levél, mind ilyen).
    A kulcs ugyanaz, mint a NAV-ellenőrzésé (szóköz ki, nagybetű).
  */
  const withoutRow = report.notCandidates.filter((n) => !byNumber.has(n));
  const own = new Map(
    (
      await (deps.ownInvoicesByNumber ?? prismaOwnInvoicesByNumber)(withoutRow)
    ).map((row) => [invoiceNumberKey(row.invoiceNumber), row]),
  );
  for (const number of report.notCandidates) {
    const row = byNumber.get(number);
    const ownRow = own.get(invoiceNumberKey(number));
    const state = row
      ? row.hasPdf
        ? "MAR_VAN_PDF"
        : `MASIK_HONAP ${row.issueDate.toISOString().slice(0, 7)}`
      : ownRow
        ? `SAJAT_SZAMLA ${ownRow.source}`
        : "NINCS_SZAMLA_SOR";
    io.out(`${state.padEnd(17)} ${number}\n`);
  }
  if (report.unauthenticatedFiles)
    io.out(
      `Hitelesítetlen levél PDF-je (${mailId !== null ? "nem acropora.hu-aláírású" : "nem cmfx-aláírású"}, nem tárolódik): ${report.unauthenticatedFiles}\n`,
    );
  if (report.unrecognizedFiles)
    io.out(`Nem cmfx alakú melléklet-név: ${report.unrecognizedFiles}\n`);

  const count = (kind: string) =>
    report.outcomes.filter((o) => o.kind === kind).length;
  const failed =
    count("NOT_PDF") +
    count("NUMBER_NOT_IN_PDF") +
    count("NOT_OUR_INVOICE") +
    count("AMOUNT_MISMATCH") +
    count("STORE_FAILED") +
    count("NOT_AUTHENTICATED");
  io.out(
    `Összesen: ${apply ? `tárolva ${count("STORED")}, közben már volt ${count("ALREADY_HAD")}` : `tárolná ${count("WOULD_STORE")}`}, levél nélkül ${count("NO_MAIL")}, ` +
      `hibás ${failed}, saját (OS) számla levele ${withoutRow.filter((n) => own.has(invoiceNumberKey(n))).length}, ` +
      `számla-sor nélküli levél ${withoutRow.filter((n) => !own.has(invoiceNumberKey(n))).length}\n`,
  );
  if (!apply) {
    io.out("Ez a futás nem írt. A tároláshoz: --apply\n");
    return count("WOULD_STORE") ? 1 : failed ? 3 : 0;
  }
  return failed ? 3 : 0;
}

/**
 * Egy mappa PDF-jei a levél-út alakjában. A futtató ember tette oda (`--dir`): az eredetet ő igazolja,
 * ezért `authenticated`; a szám, az adószám és az összeg ellenőrzése ettől még lefut.
 */
/**
 * A WEBSHOP-SZÁMLA PDF-JE AZ UNAS-RENDELÉS CMFX-LINKJÉRŐL (785dfea6, acrobot 58359). A levél nélküli ACRW-számlák egy részéhez
 * az UNAS rendelés-szinkron eltárolta a számla linkjét (`Invoice.externalUrl`, source UNAS; élesen 132 ACRW-2026 sor, mind
 * `https://www.cmfx.hu`). A cmfx felülete a régebbieket nem adja ki, ez a link igen, ha PDF-et ad.
 *
 * CSAK A CMFX: `https://www.cmfx.hu`, más host, más séma vagy egy máshová vivő átirányítás nem kérődik le. A letöltés a
 * tudásbázis védett letöltőjén megy (`guardedFetch`: a kapcsolódás a nyilvános címre megy, DNS-újrakötés nincs), méretkorláttal.
 * Két letöltés között 2 mp (Balázs, 2026-11-20 13:21 UTC: lassan). A LINK NEM KERÜL A KIMENETBE (token lehet benne): soronként
 * a szám, a HTTP-állapot, a tartalomtípus és a méret. A PDF utána ugyanazokon az ellenőrzéseken megy át, mint a levélé (szám,
 * adószám, fizetendő végösszeg); az eredete a cmfx https-hostja, ezért hitelesnek számít, mint a `--dir` mappáé.
 */
export const CMFX_LINK_HOST = "www.cmfx.hu";
export const UNAS_LINK_GAP_MS = 2_000;
const UNAS_LINK_MAX_REDIRECTS = 3;

export interface UnasInvoiceLink {
  number: string;
  url: string;
}

const cmfxLink = (value: string): URL | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname.toLowerCase() === CMFX_LINK_HOST &&
      !url.username &&
      !url.password &&
      (url.port === "" || url.port === "443")
      ? url
      : null;
  } catch {
    return null;
  }
};

/**
 * THE CMFX LINK IS A VAADIN 6 APP, NOT A FILE (785dfea6; acrobot 58716, 58755, 58758, 58769, measured from the fleet): the link
 * answers 200 text/html (2635 bytes, "FxPrint", a JSESSIONID cookie), and the app makes the PDF on its first UIDL request,
 * then opens it from /jx/tmp/. The same steps without a browser, measured to work on ACRW-2026/00008 (66 995 bytes):
 *   1. the link's own answer gives the session cookie (the GET already made);
 *   2. POST <app>/UIDL?repaintAll=1&... with the body "init\u001d", the first request a Vaadin 6 client sends;
 *   3. the .pdf address is read from the PARSED answer (after "for(;;);"): its JSON escapes the slashes, so a text search
 *      for "/jx/tmp" found nothing;
 *   4. GET that address with the cookie.
 * Every step stays on the cmfx https host through the guarded fetch; an address elsewhere is not requested. The parameters
 * are the measured names with a 1280x720 screen in Budapest's zone; the token stays in the link and is never printed.
 */
const VAADIN_INIT_BODY = "init\u001d";
const VAADIN_MAX_ANSWER = 1_000_000;

/** The session cookies a response set, as one Cookie header (the guarded fetch joins Set-Cookie lines with ", "). */
export function cookieHeaderFrom(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=\s*[A-Za-z0-9_.-]+=)/)
    .map((part) => part.split(";")[0]!.trim())
    .filter((pair) => /^[A-Za-z0-9_.-]+=/.test(pair))
    .join("; ");
}

/** Every string in a parsed Vaadin answer that names a .pdf, in document order. */
export function pdfAddressesIn(answer: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.replace(/^for\(;;\);/, ""));
  } catch {
    return [];
  }
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (/\.pdf(?:$|[?#])/i.test(node)) found.push(node);
    } else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object")
      Object.values(node).forEach(walk);
  };
  walk(parsed);
  return found;
}

/** Steps 2-4 above for one link already answered with the app's page; the PDF bytes, or why not. */
export async function vaadinPdf(
  page: URL,
  cookie: string,
  fetchPdf: PdfFetch,
  now: Date = new Date(),
): Promise<{ pdf: Uint8Array } | { reason: string }> {
  if (!cookie) return { reason: "a lap nem adott sütit" };
  const uidl = new URL("UIDL", new URL("./", page));
  const offset = now.getTimezoneOffset();
  for (const [name, value] of Object.entries({
    repaintAll: "1",
    sh: "720",
    sw: "1280",
    cw: "1280",
    ch: "720",
    vw: "1280",
    vh: "720",
    fr: "",
    tzo: String(offset),
    rtzo: "-60",
    dstd: "60",
    dston: String(offset === -120),
    curdate: String(now.getTime()),
    wsver: "6.8.13",
  }))
    uidl.searchParams.set(name, value);
  const answer = await fetchPdf(uidl.toString(), {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "text/plain;charset=utf-8",
      Origin: `https://${CMFX_LINK_HOST}`,
      Referer: page.toString(),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    body: VAADIN_INIT_BODY,
  });
  if (answer.status !== 200) return { reason: `UIDL HTTP ${answer.status}` };
  const text = await readCapped(answer, VAADIN_MAX_ANSWER);
  if (!text) return { reason: "a UIDL-válasz túl nagy" };
  const addresses = pdfAddressesIn(Buffer.from(text).toString("utf8"));
  const target = addresses
    .map((value) => {
      try {
        return cmfxLink(new URL(value, new URL("./", page)).toString());
      } catch {
        return null;
      }
    })
    .find((url): url is URL => url !== null);
  if (!target)
    return {
      reason: addresses.length
        ? "a PDF-cím nem cmfx https-cím, nem kértem le"
        : "nincs .pdf-cím a UIDL-válaszban",
    };
  const pdf = await fetchPdf(target.toString(), {
    method: "GET",
    headers: { Cookie: cookie, Accept: "application/pdf" },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (pdf.status !== 200) return { reason: `PDF HTTP ${pdf.status}` };
  const bytes = await readCapped(pdf, GOOGLE_PDF_MAX_BYTES);
  if (!bytes) return { reason: "a PDF túl nagy" };
  return Buffer.from(bytes).subarray(0, 5).toString("latin1") === "%PDF-"
    ? { pdf: bytes }
    : { reason: "a PDF-cím válasza nem PDF" };
}

export async function readUnasLinkPdfs(
  links: readonly UnasInvoiceLink[],
  fetchPdf: PdfFetch,
  report: (line: string) => void,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<MailPdf[]> {
  const pdfs: MailPdf[] = [];
  let first = true;
  for (const link of links) {
    let url = cmfxLink(link.url);
    if (!url) {
      report(`LINK ${link.number} nem cmfx https-cím, nem kértem le\n`);
      continue;
    }
    if (!first) await sleep(UNAS_LINK_GAP_MS);
    first = false;
    let response: Response | null = null;
    try {
      for (let hop = 0; ; hop++) {
        response = await fetchPdf(url.toString(), {
          method: "GET",
          headers: { Accept: "application/pdf" },
          redirect: "manual",
          signal: AbortSignal.timeout(30_000),
        });
        const location = response.headers.get("location");
        if (response.status < 300 || response.status >= 400 || !location) break;
        const next = cmfxLink(new URL(location, url).toString());
        if (!next || hop >= UNAS_LINK_MAX_REDIRECTS) {
          report(
            `LINK ${link.number} átirányítás nem cmfx-címre vagy túl sok, nem követtem\n`,
          );
          response = null;
          break;
        }
        url = next;
      }
    } catch (error) {
      // only the error's name and code: a message may carry the requested URL, and with it the token (barracuda, #2787)
      const failure = error as { name?: unknown; code?: unknown } | null;
      const name =
        typeof failure?.name === "string" ? failure.name : "ismeretlen";
      const code =
        typeof failure?.code === "string" &&
        /^[A-Z0-9_]{1,40}$/.test(failure.code)
          ? ` ${failure.code}`
          : "";
      report(`LINK ${link.number} hiba: ${name}${code}\n`);
      continue;
    }
    if (!response) continue;
    const type = response.headers.get("content-type") ?? "-";
    if (response.status !== 200) {
      report(`LINK ${link.number} HTTP ${response.status} ${type}\n`);
      continue;
    }
    const bytes = await readCapped(response, GOOGLE_PDF_MAX_BYTES);
    if (!bytes) {
      report(`LINK ${link.number} HTTP 200 ${type} túl nagy\n`);
      continue;
    }
    let buffer = Buffer.from(bytes);
    const isPdf = buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    report(
      `LINK ${link.number} HTTP 200 ${type} ${buffer.length} bájt ${isPdf ? "PDF" : "nem PDF"}\n`,
    );
    // the Vaadin app's page: the PDF behind it, through the same guarded fetch (see `vaadinPdf`)
    if (!isPdf && /text\/html/i.test(type)) {
      let outcome: { pdf: Uint8Array } | { reason: string };
      try {
        outcome = await vaadinPdf(
          url,
          cookieHeaderFrom(response.headers.get("set-cookie")),
          fetchPdf,
        );
      } catch (error) {
        const failure = error as { name?: unknown } | null;
        outcome = {
          reason: `hiba: ${typeof failure?.name === "string" ? failure.name : "ismeretlen"}`,
        };
      }
      if ("pdf" in outcome) {
        buffer = Buffer.from(outcome.pdf);
        report(`LINK ${link.number} Vaadin: PDF ${buffer.length} bájt\n`);
      } else report(`LINK ${link.number} Vaadin: ${outcome.reason}\n`);
    }
    pdfs.push({
      messageId: `unas:${link.number}`,
      // the cmfx letter's attachment name, so `numberFromCmfxFileName` reads the number back
      fileName: `E-${link.number.replace(/\//g, "-")}-0.pdf`,
      buffer,
      authenticated: true,
    });
  }
  return pdfs;
}

/** The cmfx links the UNAS order sync stored for these invoice numbers (oldest order first; one link per number). */
async function prismaUnasLinks(
  numbers: readonly string[],
): Promise<UnasInvoiceLink[]> {
  if (!numbers.length) return [];
  const rows = await prisma.invoice.findMany({
    where: {
      source: "UNAS",
      invoiceNumber: { in: [...numbers] },
      externalUrl: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { invoiceNumber: true, externalUrl: true },
  });
  const byNumber = new Map<string, string>();
  for (const row of rows)
    if (
      row.invoiceNumber &&
      row.externalUrl &&
      !byNumber.has(row.invoiceNumber)
    )
      byNumber.set(row.invoiceNumber, row.externalUrl);
  return [...byNumber].map(([number, url]) => ({ number, url }));
}

export async function readPdfDir(dir: string): Promise<MailPdf[]> {
  const names = (await readdir(dir))
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort();
  return Promise.all(
    names.map(async (fileName) => ({
      messageId: `dir:${fileName}`,
      fileName,
      buffer: await readFile(join(dir, fileName)),
      authenticated: true,
    })),
  );
}

export interface NumberRow {
  documentNumber: string;
  issueDate: Date;
  hasPdf: boolean;
}

/** Az OS saját kimenő számlája (`Invoice`, OUTBOUND) ezzel a számmal, és honnan jött (UNAS, OS, ...). */
export interface OwnInvoiceRow {
  invoiceNumber: string;
  source: string;
}

export async function prismaOwnInvoicesByNumber(
  numbers: readonly string[],
): Promise<OwnInvoiceRow[]> {
  if (!numbers.length) return [];
  const keys = [...new Set(numbers.map(invoiceNumberKey))];
  return prisma.$queryRaw<OwnInvoiceRow[]>`
    SELECT DISTINCT ON (upper(regexp_replace("invoiceNumber", '[[:space:]]', '', 'g')))
      "invoiceNumber", "source"::text AS "source"
    FROM "Invoice"
    WHERE "direction" = 'OUTBOUND'
      AND upper(regexp_replace("invoiceNumber", '[[:space:]]', '', 'g')) = ANY(${keys})`;
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
export const REQUEST_GAP_MS = 250;

/**
 * A KÉZI, HÓNAPONKÉNTI FUTÁS LASSABB, ÉS TOVÁBB VÁR A RATE LIMIT UTÁN (785dfea6, acrobot 58342 és 58354: a 2026-03 --apply
 * kétszer GOOGLE_RATE_LIMITED-del állt meg, a száraz futás után közvetlenül; Balázs 2026-11-20 13:21 UTC: a kiolvasás
 * lassan menjen). A kliens alapja (1, 2, 4 mp) a napi ütemezett futásé, ott a következő nap folytatja; egy kézi visszatöltés
 * viszont hónapnyi levelet olvas egyben, és egy megszakadt futás újra elölről kezdi. Ezért itt: két kérés között 1 mp
 * és a rate limit után 10, 30, 60, 120 és 300 mp várakozás, mielőtt a
 * hiba továbbmegy (a Google `Retry-After`-je, ha hosszabb, ennél is nyer, a kliens felső határáig).
 */
export const CLI_RATE_LIMIT_DELAYS_MS: readonly number[] = [
  10_000, 30_000, 60_000, 120_000, 300_000,
];
/** Két Gmail-kérés között a kézi futásban: négyszer a napi futásé. */
export const CLI_REQUEST_GAP_MS = 1_000;

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

/** A Gmail üzenet-azonosítója: hexadecimális (a `gcal.sh` és az API is így adja). */
const GMAIL_ID = /^[0-9a-f]{8,32}$/;

/** A saját domain, aminek a levelét a `--mail-id` elfogadja. */
export const OWN_MAIL_DOMAIN = "acropora.hu";

/**
 * EGY megnevezett levél PDF-jei, a levél ítéletével: hiteles, ha a feladó @acropora.hu és a Gmail legfelső fejléce
 * erre a domainre DKIM- és DMARC-pass. A melléklet nevét `E-` előtaggal adja tovább, ha nincs rajta (a csomag
 * levelében `2026-00002-1048133.pdf` alakú), hogy a cmfx-név szabálya olvassa; a szám a PDF szövegében úgyis
 * próbát áll. Exportálva, hogy a teszt hamis Gmail-klienssel mérje a hitelesítés bekötését.
 */
export async function readOwnMail(
  google: Pick<GoogleReadonlyClient, "gmailPdfMessage">,
  user: string,
  messageId: string,
  report: (line: string) => void = () => undefined,
): Promise<MailPdf[]> {
  const message = await google.gmailPdfMessage(user, messageId);
  report(
    `${authVerdictLine(message.authenticationResults ?? [], message.sender)}\n`,
  );
  const authenticated =
    message.sender?.split("@")[1] === OWN_MAIL_DOMAIN &&
    mailAuthenticatedFor(message.authenticationResults ?? [], OWN_MAIL_DOMAIN);
  return message.pdfs.map((pdf) => ({
    messageId,
    fileName: /^E-/i.test(pdf.fileName) ? pdf.fileName : `E-${pdf.fileName}`,
    buffer: pdf.buffer,
    authenticated,
  }));
}

/** A Drive-mappa azonosítója: ugyanaz az alak, amit a Drive-kliens elfogad (`driveFolderPdfs`). */
const DRIVE_FOLDER_ID = /^[A-Za-z0-9_-]{10,128}$/;

/**
 * Egy megnevezett Drive-mappa PDF-jei a levél-út alakjában, név szerint rendezve. A mappát a futtató nevezi meg (`--drive-folder`),
 * az eredetet ő igazolja, mint a `--dir`-nél, ezért `authenticated`; a szám, az adószám és az összeg ellenőrzése ettől még lefut.
 * A név `E-` előtagot kap, ha nincs rajta (Luca csomag-nevei), és a vezérlőkarakter (C0, C1, sor- és bekezdés-elválasztó) kikerül
 * belőle: a név a kimenet egy sorába kerül. A túl nagy fájl kimarad (a listázás mérete szerint letöltés előtt, a letöltőé szerint
 * utána), és a sora megnevezi; minden más Drive-hiba megállítja a futást. Exportálva, hogy a teszt hamis
 * Drive-klienssel mérje.
 */
export async function readDriveFolder(
  drive: Pick<GoogleReadonlyClient, "driveFolderPdfs" | "driveFile">,
  folderId: string,
  report: (line: string) => void = () => undefined,
): Promise<MailPdf[]> {
  const files = (await drive.driveFolderPdfs(folderId)).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const pdfs: MailPdf[] = [];
  for (const file of files) {
    const name = file.name.replace(/[\p{Cc}\u2028\u2029]/gu, "?");
    // the listing gives the size: a too-large file is not downloaded into memory first (barracuda #2810)
    if (file.sizeBytes !== null && file.sizeBytes > GOOGLE_PDF_MAX_BYTES) {
      report(`DRIVE ${name} túl nagy, kihagyva\n`);
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = await drive.driveFile(file.id);
    } catch (error) {
      if (
        error instanceof GoogleReadonlyError &&
        error.code === "GOOGLE_FILE_TOO_LARGE"
      ) {
        report(`DRIVE ${name} túl nagy, kihagyva\n`);
        continue;
      }
      throw error;
    }
    pdfs.push({
      messageId: `drive:${file.id}`,
      fileName: /^E-/i.test(name) ? name : `E-${name}`,
      buffer,
      authenticated: true,
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
      // the Google error's measured facts (status, reason, Retry-After) go with it: without them a rate limit says nothing
      // about how long to wait (acrobot 58354)
      const detail =
        error instanceof GoogleReadonlyError && error.detail
          ? ` (${error.detail})`
          : "";
      process.stderr.write(`${String(error)}${detail}\n`);
      process.exitCode = 2;
    })
    .finally(() => void prisma.$disconnect());
}
