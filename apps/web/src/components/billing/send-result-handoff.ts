/**
 * A KIÁLLÍTÁS UTÁNI KIKÜLDÉS EREDMÉNYE ÁTÉLI AZ ÚTVÁLTÁST (kártya 7976970f,
 * barracuda #1659). Az új számla az `/uj` útról a `/{id}/szerkesztes` útra
 * vált, ahol a szerkesztő újra felépül: a régi példány állapota (`sent`) ott
 * elveszik. A kimenetet ezért a böngésző munkamenet-tára viszi át, egyszer
 * olvasható, és csak a következő felépülő szerkesztő veszi fel.
 */
export type EditorSendResult =
  { ok: true; to: string } | { ok: false; error: string };

const STORAGE_PREFIX = "billing-send-result.";

export function writeSendResultHandoff(
  storage: Pick<Storage, "setItem">,
  documentId: string,
  result: EditorSendResult,
): void {
  try {
    storage.setItem(STORAGE_PREFIX + documentId, JSON.stringify(result));
  } catch {
    // A tár nem érhető el (privát ablak, tele): az eredmény ilyenkor a
    // részleteknél olvasható, a kiállítás ettől nem sérül.
  }
}

/** Kiolvassa és törli: egy átadást egyszer lehet felhasználni. */
export function takeSendResultHandoff(
  storage: Pick<Storage, "getItem" | "removeItem">,
  documentId: string,
): EditorSendResult | null {
  try {
    const raw = storage.getItem(STORAGE_PREFIX + documentId);
    if (raw === null) return null;
    storage.removeItem(STORAGE_PREFIX + documentId);
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.ok === true && typeof record.to === "string")
      return { ok: true, to: record.to };
    if (record.ok === false && typeof record.error === "string")
      return { ok: false, error: record.error };
    return null;
  } catch {
    return null;
  }
}
