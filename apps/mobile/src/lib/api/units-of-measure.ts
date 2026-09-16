import { apiRequest } from "./client";

/**
 * A MÉRTÉKEGYSÉG-TÖRZSADAT, OLVASÁSRA.
 *
 * A telefon csak OLVASSA a listát: a karbantartás a webes Beállítások alatt
 * van, `SETTINGS_MANAGE` jog alatt. A szerelő használja, nem írja -- ha bárki
 * felvihetne egységet a terepen, a lista három nap alatt ötféle „óra"
 * változatot tartalmazna.
 *
 * AZ ÚT `units-of-measure`, NEM `units`: ebben a rendszerben a „unit" szó a
 * SZERVEZETI EGYSÉGET (helyszínt) jelenti, azt választja a `UnitPicker`.
 */
const BASE = "/units-of-measure";

export interface UnitOfMeasureRow {
  id: string;
  /** A rövid jel, ahogy a képernyőn áll: `W`, `kW`, `l/h`. */
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface UnitOfMeasureListResponse {
  items: UnitOfMeasureRow[];
}

/**
 * A TELJESÍTMÉNY-EGYSÉGEK, CSAK AZ AKTÍVAK.
 *
 * A kivezetett egység a VÁLASZTÓBÓL esik ki, a már rögzített értékek mellett
 * viszont olvasható marad -- azt az eszköz válasza hozza magával
 * (`performanceUnit`), nem ez a lista.
 */
export function listPerformanceUnits() {
  return apiRequest<UnitOfMeasureListResponse>(`${BASE}?kind=PERFORMANCE`);
}
