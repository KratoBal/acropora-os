import type {
  MedusaAdminClient,
  MedusaUrlRedirect,
} from "./medusa-admin.client.js";
import {
  redirectChainOf,
  redirectRetargetedOf,
  redirectRowsOf,
  urlRedirectsHash,
  type RedirectRetargeted,
  type RedirectSource,
} from "./medusa-redirect-projection.js";

/** Egy fajta különbségből legfeljebb ennyi példa jön a válaszban (a darabszám a TELJES). */
export const PLAN_EXAMPLES_LIMIT = 20;

export interface RedirectPlanRow {
  source: string;
  destination: string;
  status: number;
}

export interface RedirectPlanChange {
  source: string;
  from: { destination: string; status: number };
  to: { destination: string; status: number };
}

export interface MedusaRedirectPlanView {
  /**
   * `in-sync`: a bolt listája már ez, a vetítés nem küldene; `would-send`: eltérés van, az `--apply` a TELJES listát cserélné; `refused`: lánc van
   * a listában, a vetítés NEM küld (az ok a `refusedReason`).
   */
  state: "in-sync" | "would-send" | "refused";
  refusedReason: string | null;
  localCount: number;
  remoteCount: number;
  localHash: string;
  remoteHash: string;
  /** Csak az OS-ben van (a forrás kis-nagybetű nélkül): a bolt újként kapná. */
  added: { count: number; examples: RedirectPlanRow[] };
  /** Ugyanaz a forrás más céllal vagy státusszal. */
  changed: { count: number; examples: RedirectPlanChange[] };
  /** Csak a boltban van: a teljes csere miatt EL FOG TŰNNI. */
  removed: { count: number; examples: RedirectPlanRow[] };
  unchanged: number;
  retargeted: RedirectRetargeted;
}

const key = (row: MedusaUrlRedirect) => row.source_path.toLowerCase();
const plain = (row: MedusaUrlRedirect): RedirectPlanRow => ({
  source: row.source_path,
  destination: row.destination_path,
  status: row.status,
});
const bySource = (a: { source: string }, b: { source: string }) =>
  a.source < b.source ? -1 : a.source > b.source ? 1 : 0;

/**
 * A VETÍTÉS TERVE, OLVASVA (task t-20261118-vetites-terv-get; acrobot 55559). Ugyanazt a sort és ugyanazt a lánc-szabályt használja, mint a
 * `projectUrlRedirects` (közös segédfüggvények), de SEMMIT nem küld: csak a bolt listáját olvassa (`fetchUrlRedirects`), és megmondja, mit
 * változtatna az `--apply`. A Coolify egyszeri feladat kimenete nem látszik, ez a terv igen.
 */
export async function redirectPlan(
  client: Pick<MedusaAdminClient, "fetchUrlRedirects">,
  source: RedirectSource,
): Promise<MedusaRedirectPlanView> {
  const active = await source.activeRedirects();
  const rows = redirectRowsOf(active);
  const chain = redirectChainOf(rows);
  const shop = await client.fetchUrlRedirects();
  const localHash = urlRedirectsHash(rows);

  const remote = new Map(shop.redirects.map((row) => [key(row), row]));
  const added: RedirectPlanRow[] = [];
  const changed: RedirectPlanChange[] = [];
  let unchanged = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(key(row));
    const existing = remote.get(key(row));
    if (!existing) added.push(plain(row));
    else if (
      existing.destination_path !== row.destination_path ||
      existing.status !== row.status
    )
      changed.push({
        source: row.source_path,
        from: {
          destination: existing.destination_path,
          status: existing.status,
        },
        to: { destination: row.destination_path, status: row.status },
      });
    else unchanged += 1;
  }
  const removed = shop.redirects
    .filter((row) => !seen.has(key(row)))
    .map(plain);

  return {
    state: chain
      ? "refused"
      : shop.hash === localHash
        ? "in-sync"
        : "would-send",
    refusedReason: chain
      ? `chain: ${chain.source_path} -> ${chain.destination_path}, which is itself a source`
      : null,
    localCount: rows.length,
    remoteCount: shop.count,
    localHash,
    remoteHash: shop.hash,
    added: {
      count: added.length,
      examples: added.sort(bySource).slice(0, PLAN_EXAMPLES_LIMIT),
    },
    changed: {
      count: changed.length,
      examples: changed.sort(bySource).slice(0, PLAN_EXAMPLES_LIMIT),
    },
    removed: {
      count: removed.length,
      examples: removed.sort(bySource).slice(0, PLAN_EXAMPLES_LIMIT),
    },
    unchanged,
    retargeted: redirectRetargetedOf(active),
  };
}
