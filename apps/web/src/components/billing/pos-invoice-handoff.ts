import {
  emptyLine,
  withGrossInput,
  type EditorLine,
} from "./billing-editor-state";

/**
 * A PÉNZTÁR ÁTADÁSA A SZÁMLÁZÁSNAK (kártya cdc2771b, Balázs 2026-10-08): a
 * pénztár "Számlázás" gombja nem rögzít eladást, hanem az Új számla oldalra
 * visz a kosár tételsoraival; ott már csak a vevőt kell kiválasztani. Eladás
 * azért nem készül, mert a kiállított számla maga mozgatja a készletet (a
 * csomagtermék összetevőit is), és a kettő együtt kétszer vonna le.
 *
 * A kosár a böngésző munkamenet-tárában utazik, az URL csak a kulcsát viszi.
 */
export const POS_INVOICE_HANDOFF_PARAM = "pos";

const STORAGE_PREFIX = "pos-invoice-handoff.";

export interface PosInvoiceHandoffLine {
  productId: string;
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  /** A pénztár termékének ÁFA-kulcsa; a pénztár hiányzó kulccsal nem ad át. */
  vatRatePercent: string;
  /** A tétel bruttó végösszege, a sor- és a kosár-kedvezménnyel együtt. */
  lineGross: number;
}

/**
 * A pénztár kosarából a számla tételsorai. A kedvezmények beleszámolnak a
 * bruttóba (a pénztár végösszegével azonosan), ezért a számlasoron nem áll
 * külön kedvezmény.
 */
export function posInvoiceHandoffLines(
  cart: ReadonlyArray<{
    productId: string;
    variantId: string;
    sku: string;
    productName: string;
    unit: string;
    quantity: number;
    unitGross: number;
    discountPercent: number;
    vatRate: string | null;
  }>,
  cartDiscountPercent: number,
): PosInvoiceHandoffLine[] {
  return cart.map((line) => ({
    productId: line.productId,
    variantId: line.variantId,
    sku: line.sku,
    productName: line.productName,
    unit: line.unit,
    quantity: line.quantity,
    vatRatePercent: line.vatRate ?? "",
    lineGross:
      Math.round(
        line.unitGross *
          line.quantity *
          (1 - line.discountPercent / 100) *
          (1 - cartDiscountPercent / 100) *
          100,
      ) / 100,
  }));
}

export function writePosInvoiceHandoff(
  storage: Pick<Storage, "setItem">,
  lines: PosInvoiceHandoffLine[],
  key: string = crypto.randomUUID(),
): string {
  storage.setItem(STORAGE_PREFIX + key, JSON.stringify(lines));
  return key;
}

/**
 * A kulcshoz tartozó kosár, vagy `null`, ha nincs (lejárt munkamenet, másik
 * fül) vagy olvashatatlan. Nem törli: egy újratöltés ugyanazt adja vissza.
 */
export function readPosInvoiceHandoff(
  storage: Pick<Storage, "getItem">,
  key: string,
): PosInvoiceHandoffLine[] | null {
  const raw = storage.getItem(STORAGE_PREFIX + key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PosInvoiceHandoffLine[]) : null;
  } catch {
    return null;
  }
}

/** A számla szerkesztőjének sorai. */
export function editorLinesFromPosHandoff(
  lines: PosInvoiceHandoffLine[],
  currency: string,
): EditorLine[] {
  return lines.map((line) =>
    withGrossInput(
      emptyLine({
        productId: line.productId,
        variantId: line.variantId,
        productLabel: `${line.sku} · termék`,
        description: line.productName,
        quantity: String(line.quantity),
        unit: line.unit,
        vatRatePercent: line.vatRatePercent,
      }),
      String(line.lineGross),
      currency,
    ),
  );
}
