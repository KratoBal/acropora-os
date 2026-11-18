/**
 * A VETÍTÉS TERVE (`GET health/medusa-redirect-plan`, task t-20261118-vetites-terv-get): mit változtatna a `medusa-redirect --apply` a bolt átirányítás-listáján. Az
 * API (a terv kiszámítása) és az OS felülete (a lap) közös alakja; a lap csak olvas.
 */
export interface MedusaRedirectRetargeted {
  /** Termék-szabály, amely a márkalapra megy, mert a terméknek nincs lapja. */
  brand: number;
  /** Termék-szabály, amely 410-et kap. */
  gone: number;
  /** Véglegesen megszűnt termék: sor a helyettesítőre vagy a kategóriára. */
  moved: number;
}

export interface MedusaRedirectPlanRow {
  source: string;
  destination: string;
  status: number;
}

export interface MedusaRedirectPlanChange {
  source: string;
  from: { destination: string; status: number };
  to: { destination: string; status: number };
}

export type MedusaRedirectPlanState = "in-sync" | "would-send" | "refused";

export interface MedusaRedirectPlanView {
  /**
   * `in-sync`: a bolt listája már ez, a vetítés nem küldene; `would-send`: eltérés van, az `--apply` a TELJES listát cserélné; `refused`: lánc van a
   * listában, a vetítés NEM küld (az ok a `refusedReason`).
   */
  state: MedusaRedirectPlanState;
  refusedReason: string | null;
  localCount: number;
  remoteCount: number;
  localHash: string;
  remoteHash: string;
  /** Csak az OS-ben van (a forrás kis-nagybetű nélkül): a bolt újként kapná. A példák az első húsz, a darabszám a TELJES. */
  added: { count: number; examples: MedusaRedirectPlanRow[] };
  /** Ugyanaz a forrás más céllal vagy státusszal. */
  changed: { count: number; examples: MedusaRedirectPlanChange[] };
  /** Csak a boltban van: a teljes csere miatt EL FOG TŰNNI. */
  removed: { count: number; examples: MedusaRedirectPlanRow[] };
  unchanged: number;
  retargeted: MedusaRedirectRetargeted;
}
