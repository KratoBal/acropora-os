/**
 * A KÉSZLET-ÖSSZEVETÉS TÉTELES ALAKJA, A DRÓTON.
 *
 * FIGYELEM, KÉT ÖSSZEVETÉS VAN, ÉS ENNEK A NEVE SZÁNDÉKOSAN MÁS.
 *
 * A `StockReconciliationReport` (integrations/unas-order-sync) egy ÖSSZEFOGLALÓ
 * riport az UNAS-rendelések oldaláról, és ma ez az, amit a felület mutat. Ez a
 * típus viszont a `inventory/reconciliation` modul TÉTELES kimenete: soronként
 * egy variáns és egy raktár, a főkönyvvel és az UNAS-szal összevetve -- és a
 * javító végpontok (`repair-local`, `republish-unas`) EHHEZ tartoznak, nem
 * amahhoz.
 *
 * MÉRVE 2026-09-01: a felületen „készlet-egyeztetés" néven a MÁSIK riport állt,
 * tehát aki ránézett, azt hihette, hogy már látja, amit valójában nem. Ez a
 * legrosszabb fajta névütközés: nem hibát okoz, hanem azt a hitet, hogy tudjuk.
 * Ezért hívjuk ezt `StockItem...`-nek, és ezért mondja meg a felület is, melyik
 * melyik.
 */
export type StockItemReconciliationStatus =
  | "OK"
  | "LOCAL_VS_LEDGER_MISMATCH"
  | "UNAS_VS_LOCAL_MISMATCH"
  | "MISSING_STOCK_ITEM"
  | "LEDGER_UNPROVABLE"
  | "NO_UNAS_LINK";

export interface StockItemReconciliationRow {
  variantId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string;
  /** Ha hamis, a főkönyvből nem vezethető le várt érték -- és akkor nincs is. */
  ledgerProvable: boolean;
  /** `null`, ha nem bizonyítható. SOHA nem tippelt érték. */
  ledgerExpectedOnHand: string | null;
  /** `null`, ha egyáltalán nincs StockItem sor. */
  localOnHand: string | null;
  unasOnHand: string | null;
  localVsLedgerDelta: string | null;
  unasVsLocalDelta: string | null;
  status: StockItemReconciliationStatus;
  /**
   * Szabad szövegű technikai részlet a vizsgálathoz. A szerver oldalán az áll
   * mellette, hogy SOHA nem tartalmaz vevő- vagy rendelés-adatot.
   */
  notes: string[];
}

export interface StockItemReconciliationPage {
  items: StockItemReconciliationRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface StockItemReconciliationSummary {
  checkedAt: string;
  checkedCount: number;
  byStatus: Record<StockItemReconciliationStatus, number>;
}
