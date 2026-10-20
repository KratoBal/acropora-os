import { szamlazzDocumentTotals } from "@acropora/types";

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
  /** `null`: a pénztár kézi tétele (hétfői lista M3), termék nélkül. */
  productId: string | null;
  variantId: string | null;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  /** A pénztár termékének ÁFA-kulcsa; a pénztár hiányzó kulccsal nem ad át. */
  vatRatePercent: string;
  /**
   * A tétel bruttó végösszege, a sor- és a kosár-kedvezménnyel együtt, egész
   * forintra kerekítve (`posInvoiceLineGross`).
   */
  lineGross: number;
}

/**
 * EGY SOR BRUTTÓJA A SZÁMLA KEREKÍTÉSÉVEL (barracuda, #1642). A Számlázz.hu a
 * forintos számlát tételenként kerekíti egész forintra (`szamlazzDocumentTotals`,
 * fél-felfelé, a nullától el); ugyanez a függvény kerekít itt is, így a pénztár
 * által kiírt összeg a kerekített sorok összege, és egyezik a számla
 * végösszegével. A hat tizedes csak a lebegőpontos zajt vágja le (0,1 + 0,2).
 */
export function posInvoiceLineGross(
  line: { quantity: number; unitGross: number; discountPercent: number },
  cartDiscountPercent: number,
): number {
  const exact =
    line.unitGross *
    line.quantity *
    (1 - line.discountPercent / 100) *
    (1 - cartDiscountPercent / 100);
  return Number(
    szamlazzDocumentTotals(
      [{ netAmount: "0", vatAmount: "0", grossAmount: exact.toFixed(6) }],
      "HUF",
    ).grossAmount,
  );
}

/** A Számlázás végösszege: a kerekített sorok összege. */
export function posInvoiceTotal(lines: PosInvoiceHandoffLine[]): number {
  return lines.reduce((sum, line) => sum + line.lineGross, 0);
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
    /** A pénztár kézi tétele: a kulcsai csak a kosáré, a számlán nincs termék. */
    manual?: boolean;
  }>,
  cartDiscountPercent: number,
): PosInvoiceHandoffLine[] {
  return cart.map((line) => ({
    productId: line.manual ? null : line.productId,
    variantId: line.manual ? null : line.variantId,
    sku: line.sku,
    productName: line.productName,
    unit: line.unit,
    quantity: line.quantity,
    vatRatePercent: line.vatRate ?? "",
    lineGross: posInvoiceLineGross(line, cartDiscountPercent),
  }));
}

/**
 * A TÁR GETTERT KAP, nem Storage-et (kártya ff52b935, a #1729 mintája): ahol a
 * böngésző a webhely-adatot tiltja, maga a `window.sessionStorage` olvasása
 * dob (SecurityError), és argumentumként kiértékelve ez a `try` ELŐTT történne
 * meg. Az olvasás ilyenkor `null`, a törlés néma, az írás `null` (a hívó
 * kimondja, hogy az átadás nem megy).
 */
export function writePosInvoiceHandoff(
  getStorage: () => Pick<Storage, "setItem">,
  lines: PosInvoiceHandoffLine[],
  key: string = crypto.randomUUID(),
): string | null {
  try {
    getStorage().setItem(STORAGE_PREFIX + key, JSON.stringify(lines));
    return key;
  } catch {
    return null;
  }
}

/**
 * A kulcshoz tartozó kosár, vagy `null`, ha nincs (lejárt munkamenet, másik
 * fül) vagy olvashatatlan. Az olvasás nem törli (egy újratöltés ugyanazt
 * adja vissza); a törlés az első mentésé (`clearPosInvoiceHandoff`).
 */
export function clearPosInvoiceHandoff(
  getStorage: () => Pick<Storage, "removeItem">,
  key: string,
): void {
  try {
    getStorage().removeItem(STORAGE_PREFIX + key);
  } catch {
    // a tár nem érhető el: nincs mit törölni
  }
}

export function readPosInvoiceHandoff(
  getStorage: () => Pick<Storage, "getItem">,
  key: string,
): PosInvoiceHandoffLine[] | null {
  try {
    const raw = getStorage().getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
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
        // a kézi tételnek nincs terméke: a számlán is szabad sor marad
        productLabel: line.productId ? `${line.sku} · termék` : null,
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
