/**
 * AZ ÚJ HIBAJEGY ŰRLAPJÁNAK TISZTA RÉSZE.
 *
 * MIÉRT KÜLÖN MODUL: az appban nincs komponens-teszt eszköz, tehát ami a
 * képernyő törzsében marad, azt csak kézzel, telefonon lehet kipróbálni.
 */

export interface NewServiceJobForm {
  title: string;
  description: string;
}

/** Mi a baj az űrlappal, vagy `null`. */
export function newServiceJobProblem(form: NewServiceJobForm): string | null {
  if (form.title.trim() === "") return "Írd le egy mondatban, mi a hiba.";
  if (form.title.trim().length > 300)
    return "A cím legfeljebb 300 karakter lehet.";
  if (form.description.trim().length > 4000)
    return "A leírás legfeljebb 4000 karakter lehet.";
  return null;
}

/**
 * MIT MOND A KÉPERNYŐ ARRÓL, HOVA KERÜL A JEGY.
 *
 * A partnert és a helyszínt a SZERVER vezeti le az eszközből, tehát a szerelő
 * nem választ -- de látnia kell, mi fog történni. Egy üres mező három külön
 * dolgot jelenthet (nincs, nem látod, nem töltődött be), és a felület ezeket
 * egybemossa.
 *
 * === AMIT A SZERVER OLDALÁN LEMÉRTEM, ÉS AMI ÁTÍRTA EZT A MODULT ===
 *
 * 1. Az eszköznek MINDIG van tulajdonosa: a lista-sor összeállítása
 *    `ASSET_OWNER_MISSING` hibával dobna nélküle. Tehát a telefon soha nem
 *    állíthatja kijelentő módban, hogy „ennek a gépnek nincs partnere" -- ha
 *    a mező mégis hiányzik, az a MENTETT MÁSOLATRÓL mond valamit, nem a
 *    rendszerről. Ezért lett a mondatból [PARTNER_ISMERETLEN].
 *
 * 2. ALEGYSÉG CSAK SZÁLLÍTÓI ESZKÖZÖN LEHET (`assetDepartmentRefusal`:
 *    `CUSTOMER_OWNER`). Vevő gépénél a pontosítás a CÍM. A korábbi alak ezt
 *    nem tudta, és minden vevői gépre kiírta volna, hogy „nincs helyszín
 *    rögzítve" -- egy hiányt jelentve ott, ahol a fogalom nem is értelmes.
 *
 * 3. A jegy partnere `asset.customerId ?? asset.supplier.customerId`. Vevő
 *    gépénél tehát BIZTOS; szállítóinál a tükör-soron múlik, amit a telefon
 *    nem lát. A bizonytalanságot ezért kimondjuk, nem elfedjük.
 */
export interface PlacementNotice {
  /** Mi lesz a jegy partnere, ahogy a szerelő látja. */
  partner: string;
  /** Hol áll a gép: alegység, vagy annak hiányában a cím. */
  helyszin: string;
  /**
   * A KÖVETKEZMÉNY, ha a partner bizonytalan. `null`, ha nincs mit mondani --
   * egy figyelmeztetés, ami mindig ott áll, ugyanaz, mint ami sosem.
   */
  figyelmeztetes: string | null;
}

/**
 * A BEMENET CSAK AZT NEVEZI MEG, AMIT HASZNAL -- NEM A TELJES ESZKOZT.
 *
 * Eloszor a kliens `AssetDetail["owner"]` tipusat importaltam ide, es az elso
 * spec, ami ezt a fuggvenyt merte, BEHUZTA rajta at a halozati klienst -- azon
 * at a `@/config/env` alakot, amit a teszt-konfig SZANDEKOSAN nem old fel. A
 * merhetoseg tehat azon mult, milyen SZELES a bemeneti tipus.
 */
export function placementNotice(asset: {
  /**
   * A valaszban MINDIG megvan (lasd a fenti 1. merest). Azert megis
   * elhagyhato, mert a mentett masolat nyers `JSON.parse`-bol jon, ellenorzes
   * nelkul: egy regi sor hianyosan is visszajohet.
   */
  owner?: { displayName: string };
  ownerType?: "CUSTOMER" | "SUPPLIER";
  /** A partner alegysege. Vevo gepen SOHA nincs -- ott a cim a pontositas. */
  unit?: { name: string; path: string[] } | undefined;
  address?: { formatted: string } | undefined;
}): PlacementNotice {
  const nev = asset.owner?.displayName ?? null;
  const alegyseg = asset.unit?.path?.length
    ? asset.unit.path.join(" / ")
    : (asset.unit?.name ?? null);
  const helyszin =
    alegyseg ?? asset.address?.formatted ?? "Nincs megadva a rendszerben.";

  if (!nev)
    return {
      partner: "A mentett másolat nem mondja meg.",
      helyszin,
      figyelmeztetes: PARTNER_ISMERETLEN,
    };

  /**
   * SZALLITOI ESZKOZNEL NEM ALLITUNK BIZTOSAT. A jegy partnere ilyenkor a
   * szallito TUKOR-sora, ami csak szerviz-jelolt partnerre keletkezik; ha
   * hianyzik, a jegy partner nelkul szuletik. A telefon ezt nem latja elore,
   * tehat a mondat a BIZONYTALANSAGOT mondja ki, nem egy kitalalt biztosat.
   */
  if (asset.ownerType === "SUPPLIER")
    return {
      partner: nev,
      helyszin,
      figyelmeztetes: SZALLITO_BIZONYTALAN,
    };

  return { partner: nev, helyszin, figyelmeztetes: null };
}

/**
 * A MONDAT, AMIT A LÁTHATÓSÁG-MÉRÉS ÍRT.
 *
 * Nem az számít, hogy „nincs partner" -- az önmagában csak egy üres mező. Az
 * számít, hogy EMIATT a kollégák nem találják meg a jegyet: a lista-láthatóság
 * (`serviceJobVisibilityWhere`) két tengelyen áll, aki NYITOTTA, és akinek a
 * jegy PARTNERÉNÉL van beosztott helyszíne. Partner nélkül a második nem tud
 * illeszkedni, tehát a kolléga nem hibaüzenetet lát, hanem ÜRES LISTÁT.
 *
 * MIÉRT A MÁSOLATRÓL SZÓL, ÉS NEM A RENDSZERRŐL: a szerver minden eszközhöz
 * ad tulajdonost, tehát ez az ág csak hiányos mentett másolatnál áll elő. Egy
 * „nincs partnere" mondat itt olyat állítana a rendszerről, amit a telefon nem
 * mért meg.
 */
export const PARTNER_ISMERETLEN =
  "A készüléken tárolt másolat nem mondja meg, ki a gép partnere. Ha a jegy végül partner nélkül jön létre, az irodán és rajtad kívül a kollégáid nem látják a listájukban. Térerőnél nyisd meg egyszer az eszköz adatlapját.";

export const SZALLITO_BIZONYTALAN =
  "Ez egy partner saját gépe. Ha a partner nincs felvéve szervizesként, a jegy partner nélkül jön létre, és akkor az irodán és rajtad kívül a kollégáid nem látják.";
