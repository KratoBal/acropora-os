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

/**
 * A tár GETTERT kap, nem Storage-et: ahol a böngésző a webhely-adatot tiltja,
 * maga a `window.sessionStorage` olvasása dob (SecurityError), és argumentumként
 * kiértékelve ez a `try` ELŐTT történne meg (barracuda, #1729).
 */
type StorageGetter<K extends keyof Storage> = () => Pick<Storage, K>;

export function writeSendResultHandoff(
  getStorage: StorageGetter<"setItem">,
  documentId: string,
  result: EditorSendResult,
): void {
  try {
    getStorage().setItem(STORAGE_PREFIX + documentId, JSON.stringify(result));
  } catch {
    // A tár nem érhető el (privát ablak, tele): az eredmény ilyenkor a
    // részleteknél olvasható, a kiállítás ettől nem sérül.
  }
}

/** Kiolvassa és törli: egy átadást egyszer lehet felhasználni. */
export function takeSendResultHandoff(
  getStorage: StorageGetter<"getItem" | "removeItem">,
  documentId: string,
): EditorSendResult | null {
  try {
    const storage = getStorage();
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
