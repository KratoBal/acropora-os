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
  if (!input.requested) return null;
  /*
    Vevő tulajdonosnál a finomítás a CÍM, nem az alegység. A két fogalom külön
    mező, és a felületen is külön címke -- pont ezért készült ez az egész.

    === EZ AZ ÁG 2026-09-22 ÓTA ELÉRHETETLEN, ÉS SZÁNDÉKOSAN MARAD ITT ===

    Balázs, 2026-09-22 19:13:19 UTC (Discord, Acropora OS szál, message_id
    1552035084578586696). A kérdés az volt, lesz-e valaha olyan eszköz a
    rendszerben, ami a vevőé, nem a miénk vagy a partneré. A válasza szó
    szerint: „nem lesz".

    Mérve ugyanazon a napon, éles adatbázison: 124 eszközből MIND a 124 visel
    `supplierId`-t, vevői tulajdonosú NULLA. Az ág tehát ma nulla soron fut, és
    a döntés szerint később sem fog.

    AMIÉRT MÉGIS ITT ÁLL: a törlése KÜLÖN döntés, nem ennek a változásnak a
    része. A fenti mondat egy korábbi, szó szerint leírt döntés; azt nem
    töröljük azzal az indokkal, hogy útban van egy másiknak.

    ÉS AMIÉRT A DÁTUMOZOTT IDÉZET KELL IDE: enélkül a következő olvasó két
    dolog közül választ, és mind a kettő rossz. Vagy törli indok nélkül, vagy
    ÉLŐ ágnak nézi és épít rá. Egy dátumozott idézet mind a kettőt kizárja.
  */
  if (input.ownerType === "CUSTOMER") return "CUSTOMER_OWNER";
  if (!input.department) return "NOT_FOUND";
  // A tükör-soron keresztül kötjük össze: az alegység a partner tükör vevőjéhez
  // tartozik, nem magához a szállítóhoz. Ha a partnernek nincs tükre, akkor
  // alegysége sincs, és a `null !== customerId` maga utasítja el.
  if (input.department.customerId !== input.mirrorCustomerId)
    return "OTHER_PARTNER";
  if (!input.department.isActive) return "INACTIVE";
  return null;
}

export const ASSET_DEPARTMENT_REFUSAL_MESSAGES: Record<
  AssetDepartmentRefusal,
  string
> = {
  CUSTOMER_OWNER:
    "Alegység csak szerviz partner eszközéhez rendelhető. Vevő eszközénél a cím a pontosítás.",
  NOT_FOUND: "A kiválasztott alegység nem található.",
  OTHER_PARTNER: "A kiválasztott alegység nem ehhez a partnerhez tartozik.",
  INACTIVE: "A kiválasztott alegység már nem aktív.",
};
