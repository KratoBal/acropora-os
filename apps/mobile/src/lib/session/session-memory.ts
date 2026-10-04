/**
 * A LISTÁK SZŰRÉSE A MUNKAMENET IDEJÉRE (Balázs, 2026-10-04 13:51 UTC, acrobot
 * 26167): ha a felhasználó szűr (fül, partner, keresés, Rám kiosztva / Csak az
 * enyém), megnyit egy lapot, és visszalép, a szűrés MARADJON MEG.
 *
 * MIÉRT NEM ELÉG A KÉPERNYŐ SAJÁT ÁLLAPOTA: egy sima visszalépésnél a lista
 * kint marad a veremben, és megtartja; de ha a lista ÚJRA felépül (az alsó
 * sáv `router.navigate`-je egy új példányt tol, vagy a rendszer kidobja a
 * képernyőt), a `useState` az alapértelmezésről indul. A szűrés tehát nem a
 * képernyőben, hanem a JS-futás memóriájában él: újraindítás után nincs meg,
 * és ez a kérés szerint így helyes.
 *
 * FELHASZNÁLÓNKÉNT: a kulcs a felhasználó azonosítóját is hordozza, tehát egy
 * másik bejelentkezés ugyanazon a telefonon az alapértelmezésről indul, és nem
 * örökli az előző ember szűrését.
 *
 * TISZTA MODUL (React nélkül), hogy a telefon tesztsora mérni tudja; a horog
 * (`useSessionState`) csak ezt hívja.
 */
const memory = new Map<string, unknown>();

/** A kulcs: felhasználó, lista, mező. Bejelentkezés nélkül egy közös vendég-tér. */
export function sessionKey(
  userId: string | undefined,
  list: string,
  field: string,
): string {
  return `${userId ?? "-"}:${list}:${field}`;
}

/** A megjegyzett érték, vagy az alapértelmezés, ha ebben a futásban még nem volt. */
export function sessionValue<T>(key: string, fallback: T): T {
  return memory.has(key) ? (memory.get(key) as T) : fallback;
}

export function rememberSessionValue<T>(key: string, value: T): void {
  memory.set(key, value);
}

/** Csak a tesztnek: tiszta lap. */
export function forgetSessionValues(): void {
  memory.clear();
}
