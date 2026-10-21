import { prisma } from "@acropora/database";
import { ACROPORA_COMPANY } from "@acropora/types";

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
 * A cmfx melléklet-nevéből a számlaszám; ha a név nem ilyen alakú, `null`. A záró rész hexadecimális
 * hash (mérve: 7 jegyű, pl. `17ff96d`). NEM kell benne betű (acrobot, #1777): egy 7 jegyű hex kb. 3,7%
 * eséllyel csupa számjegy, és egy betűt kérő szabály havonta nagyjából minden 27. számlát csendben
 * kiejtene. Az ára: egy hash NÉLKÜLI név (`E-ACRW-2026-00536.pdf`) rossz számot ad (`ACRW/2026`), de az
 * nem néma: nincs ilyen jelölt, tehát „nincs számla-sora” sorként látszik, és a PDF-szöveg
 * szám-ellenőrzése miatt sehová nem tárolódik. A valódi őr az a szöveg-ellenőrzés, nem ez a minta.
 */
export function numberFromCmfxFileName(fileName: string): string | null {
  const match = /^E-(.+)-(\d+)-([0-9a-f]+)\.pdf$/i.exec(fileName.trim());
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
  /** A feed-sor bruttó végösszege, tizedes szövegként (`ExternalBillingDocument.grossAmount`). */
  grossAmount: string;
}

export interface MailPdf {
  messageId: string;
  fileName: string;
  buffer: Buffer;
  /** A levél eredete igazolt (`cmfxMailAuthenticated`); hamis feladójú levél PDF-je nem jelölt. */
  authenticated: boolean;
}

/**
 * A LEVÉL TÉNYLEG A CMFX-TŐL JÖTT-E (barracuda, #1777). A `From` a levélben ÁLLÍTOTT feladó: bárki
 * beírhatja, aki az info@-ra ír, és egy hamis PDF így egy valódi számla nevében a könyvelői csomagba
 * kerülne (a számlaszámok kitalálhatók). Az eredetet a fogadó szerver ítélete igazolja: a Gmail a
 * levél TETEJÉRE írja a saját `Authentication-Results: mx.google.com; ...` fejlécét. Csak a LEGFELSŐ
 * ilyen fejlécnek hiszünk, és csak ha az a Gmailé: a küldő is beírhat egy hamis fejlécet, de az a
 * Gmailé alatt áll.
 *
 * Elfogadott (barracuda és acrobot, #1777): UGYANABBAN a legfelső fejlécben `dkim=pass`, ahol az aláíró
 * domain (`header.d`, vagy a `header.i` domainje) PONTOSAN cmfx.hu, ÉS `dmarc=pass header.from=cmfx.hu`.
 * A DKIM a tartalomhoz köti az aláírást, a DMARC a DKIM-domaint a `From`-hoz: a kettő együtt a
 * legerősebb. Mérve 2026-10-21 (acrobot, öt októberi cmfx-levél): mind az ötnél a legfelső fejléc
 * `mx.google.com`, benne `dkim=pass header.i=@cmfx.hu` és `dmarc=pass header.from=cmfx.hu`. A
 * domain-egyezés pontos, nem végződés-alapú: egy evilcmfx.hu nem megy át, és aldomain sem.
 *
 * MIÉRT A LEGFELSŐ, ÉS NEM „AZ MX.GOOGLE.COM-OS”: a küldő a saját levelébe egy `mx.google.com; dkim=pass`
 * kezdetű sort is beírhat; ha a fejlécek közül azt keresnénk, ami mx.google.com-mal kezdődik, a hamis
 * sor is megfelelne. A Gmail sajátja mindig felül áll, tehát csak az első fejlécet nézzük, és annak
 * kell a Gmailének lennie. Ha valaha nem az áll felül, a levél NEM_HITELES lesz: látható, nem néma.
 */
export function cmfxMailAuthenticated(results: readonly string[]): boolean {
  const top = results[0]?.trim() ?? "";
  if (!/^mx\.google\.com\s*;/i.test(top)) return false;
  const parts = top.split(";").map((part) => part.trim().toLowerCase());
  // the domain ends where the token ends: no letter, digit, dot or hyphen may follow
  const end = String.raw`(?![a-z0-9.-])`;
  const dkim = parts.some(
    (part) =>
      /^dkim=pass\b/.test(part) &&
      new RegExp(
        String.raw`(?:^|\s)header\.(?:d=cmfx\.hu|i=[^\s@]*@cmfx\.hu)${end}`,
      ).test(part),
  );
  const dmarc = parts.some(
    (part) =>
      /^dmarc=pass\b/.test(part) &&
      new RegExp(String.raw`(?:^|\s)header\.from=cmfx\.hu${end}`).test(part),
  );
  return dkim && dmarc;
}

/**
 * A számlaszám a PDF szövegében, HATÁROLVA (barracuda, #1777): az ACRW-2026/00536 ne találjon rá az
 * ACRW-2026/005360-ra, és egy betű vagy számjegy se álljon előtte.
 */
export function textCarriesNumber(text: string, number: string): boolean {
  const escaped = number.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![0-9])`).test(text);
}

/**
 * A KIÁLLÍTÓ A MI CÉGÜNK (barracuda, #1777 v2): a DKIM a cmfx.hu-t igazolja, nem az Acroporát. A cmfx
 * számlázó szolgáltatás, MINDEN ügyfele levele cmfx.hu alá kerül, tehát egy másik cmfx-ügyfél is küldhet
 * ACRW-előtagú számlát az info@-ra. A saját adószámunk törzsszáma (határolva: előtte és utána nem áll
 * számjegy, így a `23916229-2-42` és a `HU23916229` is illik) a PDF-ben ezt a véletlen keveredést zárja
 * ki. Egy SZÁNDÉKOS hamisítót nem: a PDF szövegét ő írja.
 */
export function textCarriesOurTaxNumber(text: string): boolean {
  return new RegExp(
    `(?<![0-9])${ACROPORA_COMPANY.taxNumberBase}(?![0-9])`,
  ).test(text);
}

/**
 * A FIZETENDŐ VÉGÖSSZEG A FEED-SORÉ (barracuda és acrobot, #1777 utáni lépés). A számlaszámot és az
 * adószámunkat egy hamisító is beírhatja a PDF-be; a végösszeget nem tudja: az a Számlázz.hu/NAV oldali
 * adatból jön (`ExternalBillingDocument.grossAmount`), és csak a kiállító ismeri.
 *
 * A PDF alakja (acrobot mérése 2026-10-21, két valódi októberi cmfx-PDF): a `FIZETENDŐ BRUTTÓ
 * VÉGÖSSZEG:` felirat után áll az összeg, egész forintra, sima szóközös ezres tagolással, tizedes
 * nélkül; a `HUF` külön cellában. Ugyanez a szám az áfa-sorban is előfordulhat, ezért NEM elég, hogy a
 * szöveg valahol tartalmazza: a felirat UTÁNI első számcsoport számít (a sorba rendezett szövegben a
 * cellák között ` | ` áll). Egy nem egész feed-összeg (devizás számla) nem kerekítődik: nem egyezik.
 */
export function pdfPayableMatches(text: string, grossAmount: string): boolean {
  const gross = Number(grossAmount);
  if (!Number.isInteger(gross)) return false;
  const match =
    /FIZETENDŐ\s+BRUTTÓ\s+VÉGÖSSZEG:[\s|]*(\d(?:[\d ]*\d)?)(?![\d])/.exec(text);
  if (!match) return false;
  return Number(match[1]!.replace(/ /g, "")) === gross;
}

export type MailPdfOutcome =
  | { kind: "STORED" | "WOULD_STORE"; documentNumber: string; bytes: number }
  | { kind: "NO_MAIL"; documentNumber: string }
  | {
      kind:
        | "NOT_PDF"
        | "NUMBER_NOT_IN_PDF"
        | "NOT_OUR_INVOICE"
        | "AMOUNT_MISMATCH"
        | "STORE_FAILED"
        | "NOT_AUTHENTICATED";
      documentNumber: string;
    };

export interface MailPdfReport {
  outcomes: MailPdfOutcome[];
  /** Levélben talált számok, amelyek nem jelöltek (már van PDF-jük, vagy nem e hónapé, vagy nincs a feedben). */
  notCandidates: string[];
  /** Mellékletek, amelyeknek a neve nem a cmfx alakja. */
  unrecognizedFiles: number;
  /** PDF-ek hitelesítetlen levélből (`cmfxMailAuthenticated`): egyik sem tárolódik. */
  unauthenticatedFiles: number;
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
    // a hitelesítetlen levél PDF-je meg sem nyílik: ha csak ilyen jött, az a sor oka
    const trusted = pdfs.filter((pdf) => pdf.authenticated);
    if (!trusted.length) {
      outcomes.push({ kind: "NOT_AUTHENTICATED", documentNumber: number });
      continue;
    }
    let verdict:
      "NOT_PDF" | "NUMBER_NOT_IN_PDF" | "NOT_OUR_INVOICE" | "AMOUNT_MISMATCH" =
      "NOT_PDF";
    let chosen: MailPdf | null = null;
    for (const pdf of trusted) {
      if (pdf.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") continue;
      const text = await input.textOf(pdf.buffer).catch(() => [] as string[]);
      if (!textCarriesNumber(text.join("\n"), number)) {
        verdict = "NUMBER_NOT_IN_PDF";
        continue;
      }
      if (!textCarriesOurTaxNumber(text.join("\n"))) {
        verdict = "NOT_OUR_INVOICE";
        continue;
      }
      if (!pdfPayableMatches(text.join("\n"), row.grossAmount)) {
        verdict = "AMOUNT_MISMATCH";
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
  return {
    outcomes,
    notCandidates,
    unrecognizedFiles,
    unauthenticatedFiles: input.pdfs.filter((pdf) => !pdf.authenticated).length,
  };
}

/**
 * A hónap PDF nélküli feed-sorai. Az ok (`pdfMissingReason`) nem zár ki: egy Számlázz.hu-s 7-es
 * hibájú sor (a Számlázz.hu nem ismeri, mert a cmfx állította ki) épp az, amit a levél pótolhat.
 */
export async function mailPdfCandidates(
  month: string,
): Promise<MailPdfCandidate[]> {
  return prisma.externalBillingDocument
    .findMany({
      where: {
        source: "SZAMLAZZ",
        pdfStorageKey: null,
        documentNumber: { not: "" },
        issueDate: monthRange(month),
      },
      select: {
        id: true,
        documentNumber: true,
        issueDate: true,
        grossAmount: true,
      },
      orderBy: [{ issueDate: "asc" }, { documentNumber: "asc" }],
    })
    .then((rows) =>
      rows.map((row) => ({ ...row, grossAmount: row.grossAmount.toString() })),
    );
}
