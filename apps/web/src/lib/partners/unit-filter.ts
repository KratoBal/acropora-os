/**
 * AZ ALEGYSÉG-SZŰRŐ A CÍMSORBAN, HALMAZKÉNT.
 *
 * A szerver 2026-08-31 óta több alegységet is elfogad (`departmentIds`), és a
 * részfáik unióját adja vissza. A választó ezért HALMAZ, nem egy érték: Balázs
 * kimondta, hogy egy emberhez több csomópont is rendelhető, és egy egy-értékű
 * választót később nem bővíteni kell, hanem újraírni.
 *
 * MIÉRT A CÍMSORBAN ÉL, ÉS NEM KOMPONENS-ÁLLAPOTBAN: a lista minden más szűrője
 * is ott van (`status`, `kind`, `ownerId`), tehát egy megosztott hivatkozás
 * ugyanazt a listát nyitja meg. Egy állapotban tartott szűrő ezt csendben
 * elrontaná: a link ugyanaz maradna, a tartalom más.
 *
 * VESSZŐVEL, NEM ISMÉTELT PARAMÉTERREL. A szerver mind a kettőt elfogadja; a
 * vesszős alak rövidebb címet ad, és a `URLSearchParams` egyetlen `set` hívással
 * kezeli -- az ismételt alaknál törölni és újra hozzáfűzni kellene, ami egy
 * elfelejtett `delete` esetén némán duplázna.
 *
 * AZ ÜRES HALMAZ TÖRLI A PARAMÉTERT, nem üres értéket ír. A szerver az üres
 * értéket ma `undefined`-ként kezeli, tehát a kettő ma egyet jelent -- de ez az ő
 * döntése, nem a miénk, és egy üres paraméter azt sugallná, hogy szűrünk.
 */
export const UNIT_FILTER_PARAM = "departmentIds";

/** A címsorból halmaz. Üres és ismétlődő értékek kiesnek, a sorrend nem számít. */
export function readUnitFilter(params: URLSearchParams): string[] {
  const raw = params
    .getAll(UNIT_FILTER_PARAM)
    .flatMap((value) => value.split(","));
  return [...new Set(raw.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Halmaz a címsorba, a többi paraméter érintetlenül hagyásával.
 *
 * A lapozást SZÁNDÉKOSAN visszaállítja az elsőre: egy szűkített lista harmadik
 * oldala üres lehet, és a felhasználó egy üres képernyőt látna anélkül, hogy
 * bármi megmondaná, miért.
 */
export function writeUnitFilter(
  params: URLSearchParams,
  unitIds: readonly string[],
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  const unique = [...new Set(unitIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) next.delete(UNIT_FILTER_PARAM);
  else next.set(UNIT_FILTER_PARAM, unique.join(","));
  next.set("page", "1");
  return next;
}

/** Egy azonosító be- vagy kikapcsolása, a többi választás megtartásával. */
export function toggleUnitFilter(
  selected: readonly string[],
  unitId: string,
): string[] {
  return selected.includes(unitId)
    ? selected.filter((id) => id !== unitId)
    : [...selected, unitId];
}
