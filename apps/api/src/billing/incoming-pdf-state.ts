import { collectedPdfIds } from "./incoming-collected-pdf.js";

/**
 * EGY BEJÖVŐ SZÁMLA PDF-JE: EGY SZABÁLY, AMIT MINDEN FELÜLET ÉS ELLENŐRZÉS HASZNÁL (kártya
 * 229fb4bb, T3.2; Balázs 2026-11-03). Eddig minden hívó maga rakta össze a három forrást
 * (a feed saját dokumentuma, a soron csatolt PDF, a begyűjtött PDF), és nem mindenki ugyanazt:
 * a lista, az adatlap, a csatolás és a hozzárendelés kapuja, a letöltés és a könyvelői csomag
 * mind másolta a kifejezést, az ellenőrző lap (`purchaseReview`) pedig a begyűjtöttet és a
 * csatoltat fixen `false`-nak vette, tehát a listán „van PDF” sort PDF nélkülinek mutatott.
 *
 * KÉT KÉRDÉS, KÉT FÜGGVÉNY, MERT NEM UGYANAZ A VÁLASZ:
 *   - `incomingHasPdf`: VAN-E PDF (a lista, az adatlap, a csatolás kapuja). Igaz, ha a sor
 *     tárolt `hasPdf` jele igaz, VAGY van rá csatolt, VAGY begyűjtött PDF. A feed saját
 *     dokumentuma önmagában NEM számít: az lehet XML, a tárolt jel mondja meg, hogy PDF-e.
 *   - `incomingPdfIds`: MELYEK A PDF-JELÖLTEK, a használat sorrendjében (a letöltés és a
 *     csomag). A feed saját dokumentuma előre, aztán a soron csatolt, aztán a begyűjtött;
 *     a csomag-építő és a letöltés a tartalom alapján (%PDF-) dönti el, melyik valódi.
 *
 * Az `incoming-pdf-state.spec.ts` őrző-tesztje azt is méri, hogy a `collectedPdfIds` hívása
 * csak a megengedett fájlokban áll (ez a kifejezés összerakásának építőeleme): egy új hívó nem
 * rakhat össze saját, harmadik változatot.
 */
export interface IncomingPdfRow {
  id: string;
  hasPdf?: boolean;
  documentNumber: string;
  supplierTaxNumber: string | null;
  sourceDocumentId: string | null;
}

export interface IncomingPdfSources {
  /** A sorokhoz csatolt PDF-ek soronként (`attachedPdfIds`). */
  attached: ReadonlyMap<string, readonly string[]>;
  /** A begyűjtött PDF-ek indexe (`loadCollectedPdfIndex`). */
  collected: ReadonlyMap<string, readonly string[]>;
}

export function incomingPdfIds(
  row: IncomingPdfRow,
  sources: IncomingPdfSources,
): string[] {
  return [
    ...new Set([
      ...(row.sourceDocumentId ? [row.sourceDocumentId] : []),
      ...(sources.attached.get(row.id) ?? []),
      ...collectedPdfIds(row, sources.collected),
    ]),
  ];
}

export function incomingHasPdf(
  row: IncomingPdfRow,
  sources: IncomingPdfSources,
): boolean {
  return (
    row.hasPdf === true ||
    (sources.attached.get(row.id)?.length ?? 0) > 0 ||
    collectedPdfIds(row, sources.collected).length > 0
  );
}
