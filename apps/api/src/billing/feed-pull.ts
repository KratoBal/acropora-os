import { createHash } from "node:crypto";

import {
  buildSzamlazzQueryXml,
  parseSzamlazzQueryResponse,
} from "./billing-szamlazz-query.js";
import { projectExternalInvoice } from "./external-szamlazz-invoice.js";
import { buildSzamlazzAgentPdfXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import type {
  SzamlazzAgentPdfClient,
  SzamlazzAgentQueryClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { FeedStoreOutcome } from "../missing-invoices/szamlazz-feeds.repository.js";

/**
 * A FEEDBŐL HIÁNYZÓ KIMENŐ SZÁMLA BEHÚZÁSA A SZÁMLÁZZ.HU-BÓL (aeddb2c3; Balázs éles próba-futása 2026-11-05: az
 * ACRW-2026/00469 a GLS-lapon párosítva, a kifizetett-jelölésnek "nincs a Számlázz.hu feedben"; a feed a push
 * bekötése előtti számlákat nem hozta).
 *
 * HONNAN INDUL: élesen a Napi jelölés lapjáról, a "nincs a Számlázz.hu feedben" sor gombjával (száraz előnézet,
 * utána megerősítés; `POST /billing/paid-marks/feed-pull`, BILLING_ISSUE jog). A flottának nincs éles shellje, és
 * Balázsnak se legyen rendszeres kézi parancs (acrobot 43506). A `billing:feed-pull` parancs a fejlesztésé és a
 * teszté.
 *
 * PONTOS SZÁMLASZÁMOT kér: a Számlázz.hu Agent `xmlszamlaxml` lekérdezése a számra keres, nem a közlemény
 * kitöltésére (a `2026/000436` alakból a hívó dönti el, hogy `ACRW-2026/00436`-ot kérdez-e).
 *
 * SZÁRAZ alapból: lekérdez (a Számlázz.hu-n ez csak olvasás), a választ a feed vetítésével olvassa
 * (`projectExternalInvoice`, ugyanaz a `szamla` dokumentum, mint a push), és kiírja, mi kerülne a feedbe. Adatbázisba
 * nem ír. `--apply`: a válasz SZAMLAKI feed-üzenetként tárolódik, és ugyanaz a vetítés fut rá, mint egy push-ra
 * (`intoBilling`); ugyanaz a válasz másodszor SEEN, tehát idempotens. A napi kifizetett-jelölés próba-futása ezt nem
 * hívja: kifelé csak ez a parancs kérdez, kézzel indítva.
 *
 * A KIÍRÁS ÉS A HIBA-SZÖVEG nem tartalmazza a válasz XML-jét (vevő, tételek): csak a számot, a fajtát, az összegeket
 * és a kifizetések állapotát.
 *
 * A LEKÉRDEZŐ MODUL SZABÁLYA ALÓLI EGYETLEN KIVÉTEL (acrobot 43506): a `billing-szamlazz-query.ts` a teljes válasz-XML-t
 * nem őrzi és nem naplózza (acrobot 2026-10-28). Itt a válasz a FEED-ÜZENETEK közé kerül, mert pontosan azt tárolja,
 * amit a Számlázz.hu push-a ugyanerre a számlára tárolt volna, és a feed vetítése (`projectOutgoing`) tárolt üzenetből
 * dolgozik. A kivétel csak ez a tárolás; kiírás és napló a teljes XML nélkül marad.
 */
export interface FeedPullDeps {
  agentKey(): Promise<string>;
  client: SzamlazzAgentQueryClient;
  /** a diagnosztikához: a PDF-lekérés (más Agent-művelet, amelyik élesben működik); hiányában kimarad */
  pdf?: SzamlazzAgentPdfClient;
  /** a diagnosztikához: egy, az OS által a Számlázz.hu-ban kiállított számlaszám (kontroll); hiányában kimarad */
  ownIssuedNumber?(): Promise<string | null>;
  store(input: {
    externalId: string;
    sha256: string;
    body: string;
  }): Promise<FeedStoreOutcome>;
  project(
    externalId: string,
    sha256: string,
    body: string,
  ): Promise<"PROJECTED" | "OLDER" | "MISSING" | "UNREADABLE">;
}

export type FeedPullLine =
  | { number: string; outcome: "NOT_FOUND" | "ERROR"; detail: string }
  | { number: string; outcome: "UNREADABLE" | "OTHER_NUMBER"; detail: string }
  | {
      number: string;
      outcome: "WOULD_STORE" | "STORED";
      detail: string;
      stored?: FeedStoreOutcome;
      projected?: string;
    };

/** The Számlázz.hu's own error wording for the detail column: one line, cut, no control characters. */
function answerText(message: string | null): string {
  const text = (message ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  return text ? `: ${text}` : " (üzenet nélkül)";
}

export async function pullFromSzamlazz(
  numbers: readonly string[],
  apply: boolean,
  deps: FeedPullDeps,
): Promise<FeedPullLine[]> {
  const agentKey = await deps.agentKey();
  const lines: FeedPullLine[] = [];
  for (const number of numbers) {
    let body: string;
    try {
      body = await deps.client.queryDocument(
        buildSzamlazzQueryXml({
          agentKey,
          key: { by: "invoiceNumber", value: number },
        }),
      );
    } catch (error) {
      lines.push({
        number,
        outcome: "ERROR",
        detail: `a lekérdezés nem futott le (${error instanceof Error ? error.name : "UNKNOWN"})`,
      });
      continue;
    }
    let found;
    try {
      found = parseSzamlazzQueryResponse(body);
    } catch (error) {
      lines.push({
        number,
        outcome: "UNREADABLE",
        detail: `a válasz nem olvasható (${error instanceof Error ? error.message : "UNKNOWN"})`,
      });
      continue;
    }
    if (found.outcome === "NOT_FOUND") {
      lines.push({
        number,
        outcome: "NOT_FOUND",
        detail: `a Számlázz.hu 7-es hibakóddal felelt${answerText(found.errorMessage)}`,
      });
      continue;
    }
    if (found.outcome === "ERROR") {
      lines.push({
        number,
        outcome: "ERROR",
        detail: `a Számlázz.hu hibát jelzett (hibakód ${found.errorCode ?? "?"})${answerText(found.errorMessage)}`,
      });
      continue;
    }
    // a kérdezett és a kapott szám egyezik-e: egy másik számla nem kerülhet a kérdezett helyére
    if (found.invoiceNumber !== number) {
      lines.push({
        number,
        outcome: "OTHER_NUMBER",
        detail: `a válasz egy másik számla: ${found.invoiceNumber}`,
      });
      continue;
    }
    let projection;
    try {
      projection = projectExternalInvoice(body);
    } catch (error) {
      lines.push({
        number,
        outcome: "UNREADABLE",
        detail: `a feed vetítése nem olvassa (${error instanceof Error ? error.message : "UNKNOWN"})`,
      });
      continue;
    }
    const detail =
      `${projection.kindCode}${projection.cancelled ? ", sztornózott" : ""}, ` +
      `bruttó ${projection.grossAmount} ${projection.currency}, fizetve ${projection.paidAmount}, ` +
      `kifizetések ${projection.paymentsKnown ? `ismertek (${projection.payments.length})` : "elem nélkül"}`;
    if (!apply) {
      lines.push({ number, outcome: "WOULD_STORE", detail });
      continue;
    }
    const sha256 = createHash("sha256").update(body).digest("hex");
    const stored = await deps.store({
      externalId: projection.externalId,
      sha256,
      body,
    });
    const projected = await deps.project(projection.externalId, sha256, body);
    lines.push({ number, outcome: "STORED", detail, stored, projected });
  }
  return lines;
}

/**
 * A KONTROLL BUKÁSÁNAK DIAGNOSZTIKÁJA (acrobot 57902, élő eredmény 2026-11-20: a Számlázz.hu a feedben lévő 2026/00090-re és az
 * ACRW-2026/00571-re is 7-es hibakóddal felelt, "Hiányzó adat: számla xml (ismeretlen számlaszám, rendelésszám vagy külső
 * azonosító)"). A 7-es válasz két dolgot jelenthet: a kérés alakja nem ért célba, vagy a számot a kulcs nem látja. A három kérdés
 * a kettőt választja szét, mindegyik CSAK OLVAS:
 *   1. ugyanaz a szám, a kérésben kiírt `<pdf>false</pdf>` elemmel: az elem hiánya volt-e a baj;
 *   2. ugyanaz a szám a PDF-lekéréssel (`action-szamla_agent_pdf`), ami élesben működik: ha az megtalálja, az XML-lekérdezés
 *      alakja a hibás; ha az sem, a szám nem látszik ennek a kulcsnak;
 *   3. egy, az OS által kiállított számlaszám XML-lekérdezése: ha ezt megtalálja, a lekérdezés alakja jó, és a feed számai
 *      nem ehhez a kulcshoz tartoznak (másik fiók vagy kiállítási út).
 * A kimenet soronként egy mondat, a válasz XML-je nélkül (hibakód és a Számlázz.hu hibaüzenete).
 */
export async function diagnoseQueryFailure(
  number: string,
  deps: FeedPullDeps,
): Promise<string[]> {
  const lines: string[] = [];
  const agentKey = await deps.agentKey();
  const describeQuery = async (label: string, xml: string) => {
    try {
      const body = await deps.client.queryDocument(xml);
      const result = parseSzamlazzQueryResponse(body);
      lines.push(
        `${label}: ${
          result.outcome === "FOUND"
            ? `megvan (${result.invoiceNumber})`
            : result.outcome === "NOT_FOUND"
              ? `7-es hibakód${answerText(result.errorMessage)}`
              : `hibakód ${result.errorCode ?? "?"}${answerText(result.errorMessage)}`
        }`,
      );
    } catch (error) {
      lines.push(
        `${label}: nem olvasható válasz (${error instanceof Error ? error.name : "UNKNOWN"})`,
      );
    }
  };
  const describePdf = async (label: string, invoiceNumber: string) => {
    if (!deps.pdf) return;
    try {
      const response = await deps.pdf.downloadInvoicePdf(
        buildSzamlazzAgentPdfXml({ agentKey, invoiceNumber }),
      );
      lines.push(
        `${label}: ${
          response.successful
            ? `megvan (PDF ${response.pdf?.length ?? 0} bájt)`
            : `hibakód ${response.errorCode ?? "?"}${answerText(response.errorMessage ?? null)}`
        }`,
      );
    } catch (error) {
      lines.push(
        `${label}: nem futott le (${error instanceof Error ? error.name : "UNKNOWN"})`,
      );
    }
  };
  await describeQuery(
    `${number}, XML-lekérdezés kiírt <pdf>false</pdf> elemmel`,
    buildSzamlazzQueryXml({
      agentKey,
      key: { by: "invoiceNumber", value: number },
      pdfFlag: false,
    }),
  );
  await describePdf(`${number}, PDF-lekérés`, number);
  const own = deps.ownIssuedNumber ? await deps.ownIssuedNumber() : null;
  if (own) {
    await describeQuery(
      `az OS által kiállított ${own}, XML-lekérdezés`,
      buildSzamlazzQueryXml({
        agentKey,
        key: { by: "invoiceNumber", value: own },
      }),
    );
    await describePdf(`az OS által kiállított ${own}, PDF-lekérés`, own);
  } else lines.push("OS által kiállított számlaszám: nincs ilyen sor");
  return lines;
}

export function feedPullReport(
  lines: readonly FeedPullLine[],
  apply: boolean,
): string {
  const rows = lines.map((line) => {
    const tail =
      line.outcome === "STORED"
        ? ` (üzenet: ${line.stored}, vetítés: ${line.projected})`
        : "";
    return `  ${line.number}\t${line.outcome}\t${line.detail}${tail}`;
  });
  return `${apply ? "BEHÚZÁS" : "SZÁRAZ (nem ír)"}: ${lines.length} szám\n${rows.join("\n")}\n`;
}
