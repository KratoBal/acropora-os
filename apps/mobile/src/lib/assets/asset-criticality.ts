import type { AssetCriticality } from "./asset-fields";

/**
 * A KRITIKUSSÁG SZAVAI, EGY HELYEN.
 *
 * === MIÉRT KELLETT KIEMELNI ===
 *
 * Ugyanez a négy felirat eddig KÉT képernyő törzsében állt külön-külön (az
 * eszköz felvitelénél és a szerkesztésénél), és most egy harmadik hely is kérte
 * (az ütközés-feloldó). A harmadik másolat az a pont, ahol a duplikáció
 * elkezdi a saját életét: elég egyszer átfogalmazni az egyiket, és a szerelő
 * ugyanarra az értékre két nevet lát, két képernyőn.
 *
 * Az állapot szavai (`asset-status.ts`) ugyanezért állnak már külön.
 *
 * === A SORREND KÜLÖN ÁLL A LEKÉPEZÉSTŐL ===
 *
 * A `Record` a NYELV: melyik érték hogy hívják. A tömb a MEGJELENÍTÉS: milyen
 * sorrendben kínáljuk. A kettő nem ugyanaz a döntés, és ha egy tömb lenne
 * mindkettő, egy sorrend-változtatás átírná a keresés alapját is.
 */
export const ASSET_CRITICALITY_LABELS: Record<AssetCriticality, string> = {
  LOW: "Alacsony",
  NORMAL: "Normál",
  HIGH: "Magas",
  CRITICAL: "Kritikus",
};

/** A választó sorrendje: növekvő súly, ahogy a szerelő végiggondolja. */
export const ASSET_CRITICALITY_ORDER: AssetCriticality[] = [
  "LOW",
  "NORMAL",
  "HIGH",
  "CRITICAL",
];

export const ASSET_CRITICALITY_OPTIONS: {
  value: AssetCriticality;
  label: string;
}[] = ASSET_CRITICALITY_ORDER.map((value) => ({
  value,
  label: ASSET_CRITICALITY_LABELS[value],
}));
