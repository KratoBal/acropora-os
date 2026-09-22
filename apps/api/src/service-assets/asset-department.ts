/**
 * Elfogadható-e a megadott ALEGYSÉG ehhez az eszközhöz.
 *
 * Külön függvény, nem a szolgáltatás törzsében, mert a döntés adatbázis nélkül
 * is eldönthető: a betöltött sorokból következik. Így egységteszt tudja mérni,
 * és a hívás megléte is őrizhető.
 *
 * A SZABÁLY UGYANAZ, MINT A MUNKALAPNÁL, és ez szándékos: ugyanaz a tábla adja
 * a munkalapszám első tagját és a partner „Alegységek" listáját, tehát két
 * külön szabály ugyanarra a fára olyan különbség lenne, amit senki nem tart
 * észben. Bármelyik CSOMÓPONT megengedett, nem csak levél: így egy új
 * alcsomópont felvétele nem árvítja el az alatta lógó eszközöket, mert nem
 * mozdul semmi.
 */
export type AssetDepartmentRefusal =
  "CUSTOMER_OWNER" | "NOT_FOUND" | "OTHER_PARTNER" | "INACTIVE";

export function assetDepartmentRefusal(input: {
  ownerType: "CUSTOMER" | "SUPPLIER";
  /** A szerviz partner tükör vevő-sora. Vevő tulajdonosnál `null`. */
  mirrorCustomerId: string | null;
  department: { customerId: string; isActive: boolean } | null;
  /** Küldött-e a hívó alegységet. A `null` törlés, az `undefined` érintetlen. */
  requested: boolean;
}): AssetDepartmentRefusal | null {
  /*
    A CUSTOMER_OWNER ÁG `requested`-TŐL FÜGGETLENÜL FUT, 2026-09-22 ÓTA -- ÉS
    EZ A HELY VÁLTOZOTT, NEM CSAK A FELTÉTEL.

    Balázs, 2026-09-22 19:13:19 UTC (Discord, Acropora OS szál, message_id
    1552035084578586696), szó szerint: „nem lesz" -- nem lesz olyan eszköz a
    rendszerben, ami a vevőé, nem a miénk vagy a partneré.

    A `20260922210000_department_required` migráció óta az `Asset.departmentId`
    `NOT NULL`, és a repository vevő-tulajdonosnál MINDIG `null`-t ír ebbe a
    mezőbe -- létrehozáskor is, tulajdonos-váltáskor is --, FÜGGETLENÜL attól,
    küldött-e a hívó `departmentId`-t. Egy vevő-tulajdonú eszköz létrehozása
    vagy arra váltása tehát MA MÁR AKKOR IS a NOT NULL megkötésbe ütközne, ha a
    hívó sosem említi a mezőt -- és enélkül a hiba nyers, megnevezetlen
    adatbázis-hibaként érné el a felhasználót, nem ezzel a tiszta üzenettel.

    Ezért ez az ág a `requested` ellenőrzés ELŐTT fut: a séma fizikailag nem
    tudja ábrázolni a vevő-tulajdonú eszközt, tehát maga a KÍSÉRLET utasítandó
    el -- nem csak az, ha valaki emellett explicit `departmentId`-t is küld.

    Acrobot döntése, msg 22200, 2026-09-22 23:09:19: nem új szabály, hanem egy
    már előállt lehetetlenség olvashatóvá tétele. Balázs a VILÁGRÓL állított
    valamit ("nem lesz"), nem a rendszernek adott tiltó parancsot -- a kettő
    a séma szigorítása óta esik egybe, nem korábban.
  */
  if (input.ownerType === "CUSTOMER") return "CUSTOMER_OWNER";
  if (!input.requested) return null;
  /*
    Vevő tulajdonosnál a finomítás a CÍM, nem az alegység. A két fogalom külön
    mező, és a felületen is külön címke -- pont ezért készült ez az egész.
  */
  if (!input.department) return "NOT_FOUND";
  // A tükör-soron keresztül kötjük össze: az alegység a partner tükör vevőjéhez
  // tartozik, nem magához a szállítóhoz. Ha a partnernek nincs tükre, akkor
  // alegysége sincs, és a `null !== customerId` maga utasítja el.
  if (input.department.customerId !== input.mirrorCustomerId)
    return "OTHER_PARTNER";
  if (!input.department.isActive) return "INACTIVE";
  return null;
}

/**
 * KELL-E ALEGYSÉG EZEN A KÉRÉSEN -- FÜGGETLENÜL ATTÓL, HOGY A MEGADOTT ÉRTÉK
 * ÉRVÉNYES-E.
 *
 * SZÁNDÉKOSAN KÜLÖN FÜGGVÉNY, NEM AZ `assetDepartmentRefusal` BŐVÍTÉSE. A
 * kettő MÁS bekötést igényel: ez csak a JELENLÉTET nézi (a hívó DTO nyers
 * `departmentId` mezőjét), a másik a MEGADOTT érték érvényességét egy
 * lekérdezett `department` sor ellen -- és az a lekérdezés MA NEM ÁLL be a
 * create/update útvonalon (66334aed kártya, holt validáció, KÜLÖN döntés).
 * Ha ez a két kérdés egy függvénybe kerülne, a bekötése (a hívó oldalon a
 * `validateReferences` -> `repository.validationContext` láncon át) A
 * DEPARTMENT-LEKÉRDEZÉST IS AUTOMATIKUSAN AKTIVÁLNÁ -- szélesebb változást,
 * mint amit ez a döntés fed.
 *
 * Balázs döntése (message_id 1552018256280162385, 2026-09-22, szó szerint:
 * "1 legyen kotelezo") és a `20260922210000_department_required` migráció
 * (NOT NULL) miatt: SUPPLIER-tulajdonosnál a `departmentId` LÉTREHOZÁSKOR
 * mindig kell, MÓDOSÍTÁSKOR pedig nem törölhető -- de a mező ELHAGYÁSA
 * módosításkor ÉRINTETLENÜL hagyja a meglévő értéket, ami NEM törlés.
 */
export function assetDepartmentPresenceRefusal(input: {
  ownerType: "CUSTOMER" | "SUPPLIER";
  operation: "create" | "update";
  /** A hívó által küldött NYERS érték. `undefined` = a mező nincs a
   * kérésben (create: hiányzik; update: érintetlen). `null` = explicit
   * törlés. */
  departmentId: string | null | undefined;
}): boolean {
  if (input.ownerType !== "SUPPLIER") return false;
  if (input.operation === "create") return !input.departmentId;
  return input.departmentId === null;
}

export const ASSET_DEPARTMENT_PRESENCE_REFUSAL_MESSAGE =
  "Az eszköz alegysége kötelező szerviz partner tulajdonosnál -- a mező " +
  "nem hagyható el létrehozáskor, és meglévő eszközön nem törölhető.";

export const ASSET_DEPARTMENT_REFUSAL_MESSAGES: Record<
  AssetDepartmentRefusal,
  string
> = {
  CUSTOMER_OWNER:
    "Az eszköz alegysége kötelező, vevő tulajdonában lévő eszköznek viszont " +
    "nem lehet alegysége -- nála a cím a pontosítás. Emiatt vevő tulajdonába " +
    "eszköz nem hozható létre, és meglévő eszköz nem váltható vevő tulajdonába.",
  NOT_FOUND: "A kiválasztott alegység nem található.",
  OTHER_PARTNER: "A kiválasztott alegység nem ehhez a partnerhez tartozik.",
  INACTIVE: "A kiválasztott alegység már nem aktív.",
};
