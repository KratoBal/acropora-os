import type { AssetPhaseConnection } from "./asset-fields";

/**
 * A BEKOTES FELIRATAI (Balazs, 2026-10-21, kanban 541e2716): "I fazis" vagy
 * "III fazis". Az ertek stabil kod, a felirat a felulet dolga -- ugyanaz a
 * ket felirat, mint a webes feluleten (`assetPhaseConnectionLabel` a
 * `packages/types`-ban).
 *
 * A MOBIL A KOZOS CSOMAGOT NEM IMPORTALHATJA (a pnpm workspace-en kivul all),
 * tehat ez kezzel karbantartott masolat; az egyezest a `asset-phase-connection.spec.ts`
 * forrasszoveg-olvasassal vedi.
 */
export const ASSET_PHASE_CONNECTION_LABELS: Record<
  AssetPhaseConnection,
  string
> = {
  PHASE_1: "I fázis",
  PHASE_3: "III fázis",
};

/** A valaszto sorrendje: eloszor az egy fazis. */
export const ASSET_PHASE_CONNECTION_ORDER: AssetPhaseConnection[] = [
  "PHASE_1",
  "PHASE_3",
];

export const ASSET_PHASE_CONNECTION_OPTIONS: {
  value: AssetPhaseConnection;
  label: string;
}[] = ASSET_PHASE_CONNECTION_ORDER.map((value) => ({
  value,
  label: ASSET_PHASE_CONNECTION_LABELS[value],
}));
