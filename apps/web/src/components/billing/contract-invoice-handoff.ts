import {
  emptyLine,
  trimDecimal,
  type EditorLine,
} from "./billing-editor-state";

/**
 * A BESZERZÉSI SZERZŐDÉS ÁTADÁSA A SZÁMLÁZÁSNAK (hétfői lista M4): a szerződés
 * „Számla” gombja az Új számla oldalra visz, kitöltve a vevővel, a szerződés
 * számával (hivatkozásként) és a tételekkel. Kiállítani onnan lehet, az M1
 * megerősítő ablakával.
 *
 * Ugyanaz a minta, mint a pénztáré (`pos-invoice-handoff.ts`): a csomag a
 * böngésző munkamenet-tárában utazik, az URL csak a kulcsát viszi. Azért nem
 * a szerződés azonosítóját, mert a számlázó nem feltétlenül láthatja a
 * szerződéseket (`partners.manage`), a gombot megnyomó viszont már látta.
 */
export const CONTRACT_INVOICE_HANDOFF_PARAM = "szerzodes";

const STORAGE_PREFIX = "contract-invoice-handoff.";

export interface ContractInvoiceHandoff {
  /**
   * A szerződés: a számla forrása lesz (`CONTRACT`), így a szerződés tudja,
   * hogy készült belőle számla, és nem áll vissza karbantartásira.
   */
  contractId: string;
  /** A szerződés vevője (`Customer.id`). */
  customerId: string;
  /** A szerződés száma: a számla hivatkozása lesz. */
  contractNumber: string;
  lines: Array<{
    description: string;
    quantity: string;
    /** A mennyiségi egység jele (`UnitOfMeasure.code`). */
    unit: string;
    unitNet: string;
    vatRatePercent: string;
  }>;
}

export function writeContractInvoiceHandoff(
  storage: Pick<Storage, "setItem">,
  handoff: ContractInvoiceHandoff,
  key: string = crypto.randomUUID(),
): string {
  storage.setItem(STORAGE_PREFIX + key, JSON.stringify(handoff));
  return key;
}

/** A kulcs csomagja, vagy `null`, ha nincs vagy olvashatatlan. Nem töröl. */
export function readContractInvoiceHandoff(
  storage: Pick<Storage, "getItem">,
  key: string,
): ContractInvoiceHandoff | null {
  const raw = storage.getItem(STORAGE_PREFIX + key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ContractInvoiceHandoff>;
    return typeof parsed.contractId === "string" &&
      typeof parsed.customerId === "string" &&
      typeof parsed.contractNumber === "string" &&
      Array.isArray(parsed.lines)
      ? (parsed as ContractInvoiceHandoff)
      : null;
  } catch {
    return null;
  }
}

/** Az első mentés törli: egy visszalépés ne nyisson második vázlatot. */
export function clearContractInvoiceHandoff(
  storage: Pick<Storage, "removeItem">,
  key: string,
): void {
  storage.removeItem(STORAGE_PREFIX + key);
}

/**
 * A számla sorai. A szerződés nettó egységárat tárol, a sor tehát nettóval
 * nyílik (a pénztár bruttót ad át); termék nincs mögötte, szabad sor marad.
 */
export function editorLinesFromContractHandoff(
  handoff: ContractInvoiceHandoff,
): EditorLine[] {
  return handoff.lines.map((line) =>
    emptyLine({
      description: line.description,
      quantity: trimDecimal(line.quantity),
      unit: line.unit,
      unitNet: trimDecimal(line.unitNet),
      vatRatePercent: trimDecimal(line.vatRatePercent),
    }),
  );
}
