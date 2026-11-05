import { createHash } from "node:crypto";

import {
  buildSzamlazzQueryXml,
  parseSzamlazzQueryResponse,
} from "./billing-szamlazz-query.js";
import { projectExternalInvoice } from "./external-szamlazz-invoice.js";
import type { SzamlazzAgentQueryClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
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
        detail: "a Számlázz.hu-ban nincs ilyen szám",
      });
      continue;
    }
    if (found.outcome === "ERROR") {
      lines.push({
        number,
        outcome: "ERROR",
        detail: `hibakód ${found.errorCode ?? "?"}`,
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
