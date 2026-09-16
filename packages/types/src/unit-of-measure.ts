/**
 * A KARBANTARTOTT MÉRTÉKEGYSÉG-LISTA KÖZÖS ALAKJA.
 *
 * A fajta azt mondja meg, MIT MÉR az egység -- nem azt, hol választható. A
 * részletes indoklás a séma `UnitOfMeasureKind` fejlécén és a
 * `docs/DECISIONS.md`-ben áll; itt azért ismételjük a MONDATOT, mert a webes és
 * a mobil oldal ezt a fájlt olvassa, a sémát nem.
 */
export const UNIT_OF_MEASURE_KINDS = [
  "QUANTITY",
  "MEASUREMENT",
  "PERFORMANCE",
] as const;

export type UnitOfMeasureKind = (typeof UNIT_OF_MEASURE_KINDS)[number];

/** A fajták magyar neve, egy helyen: a menü és a szűrő ugyanazt mondja. */
export const unitOfMeasureKindLabel: Record<UnitOfMeasureKind, string> = {
  QUANTITY: "Mennyiség",
  MEASUREMENT: "Mérés",
  PERFORMANCE: "Teljesítmény",
};

export interface UnitOfMeasure {
  id: string;
  /** A rövid jel, ahogy a felületen áll: `db`, `óra`, `W`, `mg/l`. */
  code: string;
  /** A teljes név, ami a listában segít választani: „watt", „liter per óra". */
  name: string;
  kind: UnitOfMeasureKind;
  /**
   * A kivezetett egység NEM tűnik el: a választóból esik ki, a MEGLÉVŐ értékek
   * mellett viszont olvasható marad. Ezért jön vissza a listában is, ha a hívó
   * kifejezetten kéri.
   */
  isActive: boolean;
  sortOrder: number;
}

export interface UnitOfMeasureListResponse {
  items: UnitOfMeasure[];
}
