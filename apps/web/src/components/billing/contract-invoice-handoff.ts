import {
  emptyLine,
  trimDecimal,
  type EditorLine,
} from "./billing-editor-state";
import type { ContractBilling } from "@acropora/types";

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
    /** A szerződés tétele: a számlasor erre mutat (feladat d510). Régi csomagban hiányozhat. */
    contractItemId?: string;
    description: string;
    quantity: string;
    /** A mennyiségi egység jele (`UnitOfMeasure.code`). */
    unit: string;
    unitNet: string;
    vatRatePercent: string;
  }>;
}

/**
 * A TÁR GETTERT KAP, nem Storage-et (kártya ff52b935, a #1729 mintája): ahol a
 * böngésző a webhely-adatot tiltja, maga a `window.sessionStorage` olvasása
 * dob (SecurityError), és argumentumként kiértékelve ez a `try` ELŐTT történne
 * meg. Az olvasás ilyenkor `null`, a törlés néma, az írás `null` (a hívó
 * kimondja, hogy az átadás nem megy).
 */
export function writeContractInvoiceHandoff(
  getStorage: () => Pick<Storage, "setItem">,
  handoff: ContractInvoiceHandoff,
  key: string = crypto.randomUUID(),
): string | null {
  try {
    getStorage().setItem(STORAGE_PREFIX + key, JSON.stringify(handoff));
    return key;
  } catch {
    return null;
  }
}

/** A kulcs csomagja, vagy `null`, ha nincs vagy olvashatatlan. Nem töröl. */
export function readContractInvoiceHandoff(
  getStorage: () => Pick<Storage, "getItem">,
  key: string,
): ContractInvoiceHandoff | null {
  try {
    const raw = getStorage().getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
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
  getStorage: () => Pick<Storage, "removeItem">,
  key: string,
): void {
  try {
    getStorage().removeItem(STORAGE_PREFIX + key);
  } catch {
    // a tár nem érhető el: nincs mit törölni
  }
}

/**
 * A „SZÁMLA” GOMB SORAI: CSAK A MARADÉK (feladat d510; Balázs: „a következő
 * számla csak a még nem számlázott részt engedje”). Tételenként a még nem
 * számlázott mennyiség, a teljesen számlázott tétel kimarad, és minden sor
 * visz a tételre mutató hivatkozást. `billing` nélkül (régebbi API) a teljes
 * mennyiség, ahogy eddig. A kiállítás a szerveren ugyanezt ellenőrzi.
 */
export function contractInvoiceHandoffLines(
  items: ReadonlyArray<{
    id: string;
    description: string;
    quantity: string;
    unitNet: string;
    vatRatePercent: string;
    unitOfMeasure?: { code: string } | null;
  }>,
  billing: ContractBilling | null | undefined,
): ContractInvoiceHandoff["lines"] {
  const remaining = new Map(
    (billing?.items ?? []).map((row) => [
      row.contractItemId,
      row.remainingQuantity,
    ]),
  );
  return items.flatMap((item) => {
    const quantity = billing ? remaining.get(item.id) : item.quantity;
    if (quantity === undefined || Number(quantity) <= 0) return [];
    return [
      {
        contractItemId: item.id,
        description: item.description,
        quantity,
        unit: item.unitOfMeasure?.code ?? "db",
        unitNet: item.unitNet,
        vatRatePercent: item.vatRatePercent,
      },
    ];
  });
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
      contractItemId: line.contractItemId ?? null,
      description: line.description,
      quantity: trimDecimal(line.quantity),
      unit: line.unit,
      unitNet: trimDecimal(line.unitNet),
      vatRatePercent: trimDecimal(line.vatRatePercent),
    }),
  );
}
