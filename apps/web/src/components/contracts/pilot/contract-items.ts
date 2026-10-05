/**
 * EGY SZERZŐDÉSES TÉTEL TÖRÖLHETŐ-E (kártya c014db6f, Ág Luca bejelentése,
 * 2026-10-05). Tiszta függvények, hogy a szabály a képernyő nélkül is mérhető
 * legyen.
 *
 * A SZERVER A TÖRLÉST MÁR TUDJA: a `contracts.repository.ts` `update()`-je a
 * listából kimaradó tételt törli, a megmaradóké az azonosítóját megtartja. A
 * megrendelőlap-tétel viszont `onDelete: Restrict`-tel mutat a szerződéses
 * tételre, tehát egy olyan tétel törlése, amiből BÁRMILYEN megrendelőlap
 * készült (a visszavont is: a sora megmarad), 409-et ad. Ezt a felület előre
 * megmondja, ahelyett hogy a mentés hibára futna.
 */
export function contractItemsWithOrders(
  orders: readonly { items: readonly { contractItem: { id: string } }[] }[],
): Set<string> {
  return new Set(
    orders.flatMap((order) => order.items.map((item) => item.contractItem.id)),
  );
}

/**
 * MIÉRT NEM TÖRÖLHETŐ, vagy `null`, ha törölhető. A `locked` `null`, amíg a
 * megrendelőlapok nem töltődtek be: akkor nem tudjuk, ezért nem engedjük.
 */
export function contractItemRemovalBlocker(
  itemId: string,
  locked: ReadonlySet<string> | null,
): string | null {
  if (locked === null) return "A megrendelőlapok betöltése folyamatban.";
  return locked.has(itemId)
    ? "Ehhez a tételhez már készült megrendelőlap, ezért nem törölhető."
    : null;
}

/** A szerver tétel-szabálya (`contracts/dto.ts` `ContractItemDto`), előre. */
const DECIMAL = /^\d+(?:\.\d+)?$/;

/**
 * KITÖLTÖTT-E A TÉTEL ÚGY, AHOGY A SZERVER ELFOGADJA. Ugyanaz a szabály az új
 * szerződés űrlapján és az adatlap szerkesztésekor (kártya c014db6f): enélkül
 * egy hibás mező az API angol üzenetével térne vissza.
 */
export function isValidContractItem(item: {
  description: string;
  unitNet: string;
  quantity: string;
  vatRatePercent: string;
  occasionsPerYear: string | number;
}): boolean {
  const occasions = Number(item.occasionsPerYear);
  return (
    item.description.trim() !== "" &&
    DECIMAL.test(item.unitNet) &&
    DECIMAL.test(item.quantity) &&
    DECIMAL.test(item.vatRatePercent) &&
    Number.isInteger(occasions) &&
    occasions >= 1 &&
    occasions <= 366
  );
}

/** Az új, még el nem mentett tétel ideiglenes azonosítója az adatlapon. */
export const NEW_ITEM_PREFIX = "new-";
export const isUnsavedItem = (id: string) => id.startsWith(NEW_ITEM_PREFIX);
