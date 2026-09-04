import { webshopSellableFromUnas } from "./unas-product-sync.repository.js";
import { unasRawRows } from "./unas-raw-list.js";

export interface SellableBackfillRow {
  id: string;
  webshopSellable: boolean;
  rawPayload: Record<string, unknown>;
}

export interface SellableBackfillSummary {
  inspected: number;
  updated: number;
  remainedFalse: number;
}

/**
 * MIND A KET DONTO MEZO UGYANABBOL A FORRASBOL JON: A TAROLT NYERS VALASZBOL.
 *
 * Az elso valtozat a statuszt a `ChannelListing` tablabol vette, az `Inquire`
 * jelzot pedig a nyers valaszbol -- KET kulonbozo tabla KET kulonbozo
 * pillanatabol. A szinkron viszont mindkettot ugyanabbol az API-valaszbol veszi,
 * es ez a parancs epp azt hivatott potolni, amit a szinkron nem irt be.
 *
 * ES A `ChannelListing.externalStatus` MEZOT KET IRO TOLTI: az API-szinkron a
 * `baseStatus` fuggvennyel, a kezi XLSX-import viszont a munkafuzet "Statusz"
 * oszlopabol. Ket kulonbozo ut ugyanabba a mezobe.
 *
 * A KOCKAZAT ALAKJA, ES EZ A NEMA FAJTA: ha egy termeknek nincs UNAS-csatornas
 * sora, a statusz `null`, a szabaly HAMIS-t ad, a parancs SIMAN lefut, es kisebb
 * `updated` szamot ir ki. Ez pontosan ugy nez ki, mint egy sikeres futas egy
 * mar-helyes allapoton -- kozben a ma IGAZ sorokat is hamisra irna at.
 *
 * A ChannelListing sor a helyen marad: nem toroljuk, csak nem ONNAN dontunk.
 */
function baseStatusFromPayload(
  rawPayload: Record<string, unknown>,
): string | null {
  const statuses = rawPayload.Statuses;
  if (!statuses || typeof statuses !== "object") return null;
  /**
   * EGYETLEN GYEREK ESETEN NEM LISTA, HANEM OBJEKTUM -- a szabaly az
   * `unasRawRows`-ban all, mert ugyanez a csapda minden tarolt nyers valaszbol
   * olvasott beagyazott listara vonatkozik, nem csak a statuszra.
   */
  for (const row of unasRawRows((statuses as Record<string, unknown>).Status)) {
    if (String(row.Type) !== "base") continue;
    return row.Value === undefined || row.Value === null
      ? null
      : String(row.Value);
  }
  return null;
}

/** A már eltárolt UNAS nyers érték ugyanazt a flag-alakot követi, mint a kliens. */
function inquiryOnly(rawPayload: Record<string, unknown>): boolean {
  const value = rawPayload.Inquire;
  return value === true || value === 1 || value === "1";
}

/** A szabály egyetlen forrása a szinkronban is használt függvény. */
export function decideSellableBackfill(rows: readonly SellableBackfillRow[]) {
  return rows.map((row) => ({
    id: row.id,
    webshopSellable: webshopSellableFromUnas({
      externalStatus: baseStatusFromPayload(row.rawPayload),
      inquireOnly: inquiryOnly(row.rawPayload),
    }),
  }));
}

export function summarizeSellableBackfill(
  rows: readonly SellableBackfillRow[],
): SellableBackfillSummary {
  const decisions = decideSellableBackfill(rows);
  return {
    inspected: rows.length,
    updated: decisions.filter(
      (decision, index) =>
        decision.webshopSellable !== rows[index]!.webshopSellable,
    ).length,
    remainedFalse: decisions.filter((decision) => !decision.webshopSellable)
      .length,
  };
}
