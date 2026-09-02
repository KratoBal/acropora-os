/**
 * A Medusa admin API vékony kliense, csak ahhoz, amit a vetítés használ:
 * keresés külső azonosítóra, termék létrehozása és módosítása, illetve a
 * készlet-vetítés négy művelete (készlethely a csatorna felől, a termék
 * változatai a készlet-lánccal, készletszint létrehozása és beállítása, a
 * változat rendelhetősége).
 *
 * A HITELESÍTÉS ALAKJA MÉRT, NEM TALÁLT: a titkos API kulcsot a Medusa
 * kifejezetten HTTP Basic fejlécben várja (`Authorization: Basic <kulcs>`), és
 * ha valaki Bearer-ként küldi, saját 401-es üzenetben mondja meg, hogy ez rossz
 * (`authenticate-middleware.js`). Ezért Basic megy, és ezért nem Bearer.
 *
 * A KULCSOT A HÍVÓ ADJA, a kliens sehonnan nem olvassa: se környezetből, se
 * alapértelmezésből. Egy alapértelmezett kulcs itt csendben rossz környezetbe
 * írna, egy környezeti olvasás pedig visszahozná azt, amit a hitelesítő adat
 * szolgáltatója épp kivált. A CÍM viszont a környezetből jön, mert az nem titok.
 */

/**
 * Egy termék-sor ABBAN AZ ALAKBAN, AHOGY A KERESÉS KÉRI - se többet, se
 * kevesebbet.
 *
 * A `findByExternalId` `fields` paramétere pontosan hármat kér:
 * `id,deleted_at,external_id`. A Medusa a nem kért mezőt nem hibával, hanem
 * `undefined` értékkel adja vissza, tehát egy tágabb típus itt CSENDES ígéret:
 * egy későbbi olvasó jogosan hinné, hogy hozzáfér a címhez, és `undefined`-ot
 * kapna - fordítási hiba nélkül, futás közben.
 *
 * Ezért a keresés eredménye ezt a szűk alakot viseli, a `MedusaProductRow`
 * pedig azoké a válaszoké marad, amelyek a TELJES terméket hozzák vissza
 * (`create`, `update`, `probe` - ott nincs `fields` szűkítés). Ha a keresés
 * egyszer több mezőt kér, ez a típus és a `fields` sor EGYÜTT változik.
 */
export interface MedusaProductLookupRow {
  id: string;
  /** `null`, ha a termék él; időbélyeg, ha puhán törölték. */
  deleted_at: string | null;
  external_id?: string | null;
}

/** A teljes termék-válasz, `fields` szűkítés nélküli hívásokból. */
export interface MedusaProductRow extends MedusaProductLookupRow {
  title?: string;
}

export interface MedusaProductInput {
  title: string;
  description?: string | null;
  external_id: string;
  handle?: string;
  /**
   * A publikációs állapot. A telepített 2.19.0 validátora szerint a
   * létrehozásnál `draft` az alapértelmezés, tehát a mező elhagyása NEM
   * semleges: draftot jelent.
   */
  status?: "draft" | "proposed" | "published" | "rejected";
  /**
   * A storefront csatorna-kapcsolatok, és a mező CSERE, nem hozzáadás.
   *
   * Mérve a telepített 2.19.0 termék-frissítő folyamatából: ha a mező
   * hiányzik a törzsből, a meglévő linkeket nem bántja; ha ott van, a
   * meglévőket TÖRLI és a kapott listát hozza létre. Ebből következik, hogy
   * ugyanannak a listának az újraküldése nem hoz létre duplikátumot, és hogy
   * az ÜRES lista a lekötés.
   */
  sales_channels?: { id: string }[];
  options: { title: string; values: string[] }[];
  variants: {
    title: string;
    sku: string;
    options: Record<string, string>;
    /**
     * A Medusa termék-létrehozó végpontja MEGKÖVETELI ezt a mezőt: nélküle
     * `Invalid request: Field 'variants, 0, prices' is required` jön, HTTP
     * 400-zal (mérve a stage-en, 2026-08-25).
     *
     * A típusa szándékosan az ÜRES TÖMB, nem egy ár-lista. Az Acropora
     * OS-ben nincs önálló eladási ár, csak a webshop árának tükre, és az
     * árazás ebből a körből KI VAN VÉVE. Az üres tömb kielégíti a cél oldali
     * követelményt anélkül, hogy olyat állítanánk, amink nincs.
     *
     * Ha az ár egyszer bekerül a hatókörbe, ez a típus pirosra vált, és ez a
     * szándék: az ár alakját akkor MÉRNI kell a Medusán, nem kitalálni.
     */
    prices: [];
  }[];
}

export interface MedusaSalesChannelRow {
  id: string;
  name: string;
}

export interface MedusaLookupResult {
  rows: MedusaProductLookupRow[];
  /** Igaz, ha a válasz kimerítette a limitet, tehát lehet több is. */
  truncated: boolean;
}

/**
 * Tág, de véges. A helyes állapot nulla vagy egy találat; ennél több már
 * rendellenes, és ötven bőven elég ahhoz, hogy a rendellenesség ALAKJA is
 * látszódjon, mielőtt megállunk.
 */
/**
 * Egy Medusa kategoria, a mezonevek a `@medusajs/types` 2.19.0 szerint
 * (`BaseProductCategory`) - ugyanaz a verzio, amit az acropora-commerce
 * `package.json` rogzit. A neveket MERTUK, nem talaltuk ki: a megjeleno nev
 * `name` es nem `title`, a szulo `parent_category_id`.
 */
export interface MedusaCategoryRow {
  id: string;
  name: string;
  external_id: string | null;
  parent_category_id: string | null;
}

/**
 * A letrehozo torzs, az `AdminCreateProductCategory` szerint. Csak azok a
 * mezok allnak itt, amiket a betoltes tenylegesen kuld: ami nincs kiirva, azt
 * a Medusa alapertelmezese donti el, es azt nem akarjuk latszolag birtokolni.
 *
 * Az `external_id` A SZERZODESBEN BENNE VAN iraskor. Amit ez NEM mond: hogy a
 * telepitett peldany el is tarolja. Az elso eles futas donti el, es azert
 * kuldjuk ki mindenkeppen, mert egy elutasitas HANGOS hiba lesz - a nema
 * valtozat az lenne, ha ki sem kuldenenk.
 */
export interface MedusaCategoryInput {
  name: string;
  external_id: string;
  parent_category_id?: string | null;
}

/**
 * AZ AKTIV JELOLOT SZANDEKOSAN NEM KULDJUK.
 *
 * A szerzodes ismeri (`is_active`), de a teszt peldany STORE oldala csak aktiv
 * kategoriakat ad vissza, tehat onnan a mezo viselkedese nem merheto. Ha nem
 * kuldunk semmit, a Medusa alapertelmezese dont: ha az aktiv, jo; ha nem, a
 * kategoria nem latszik, es AZ HANGOS. Egy rosszul eltalalt mezonev viszont
 * csendben elhasalna. Amikor az elso eles futas megvolt, ez a jegyzet elavul,
 * es akkor kell atirni, nem elotte.
 *
 * === A HANDLE, ES AMIERT A CIM-SZABALY NEM DISZ ===
 *
 * A `handle`-t sem kuldjuk. A Medusa ilyenkor a NEVBOL szarmaztatja
 * (`productCategory.handle ??= kebabCase(productCategory.name)`), es a
 * `handle` oszlopon EGYEDI index all (`IDX_category_handle_unique`).
 *
 * EBBOL KOVETKEZIK, hogy a `categoryTitle` szabalya nem megjelenesi kerdes: ha
 * ket kategoria azonos NEVET kapna, azonos handle-t is kapna, es a masodik
 * letrehozas az egyedi indexen hasalna el -- a betoltes KOZEPEN, amikor mar
 * allnak kategoriak.
 *
 * MERVE 2026-09-02, a 219 soros fan, a Medusa sajat `kebabCase` fuggvenyevel:
 * 169 kulonbozo NEV, de a `{nev} - {szulo}` szaballyal 219 kulonbozo cim ES
 * 219 kulonbozo handle. Nulla utkozes.
 *
 * HA A CIM-SZABALY VALTOZIK (Balazs meg nem dontott rola), EZT UJRA KELL MERNI.
 * Nem elég, hogy a cimek kulonbozok: a `kebabCase` ket kulonbozo cimet is
 * osszevonhat.
 */

export interface MedusaCategoryListResult {
  rows: MedusaCategoryRow[];
  /** Igaz, ha a valasz kimeritette a limitet, tehat lehet tobb is. */
  truncated: boolean;
}

/**
 * A kategoria-lista felso hatara.
 *
 * A mai fa 219 kategoria, tehat az otszaz bo ketszeres tartalek. A limit
 * megis KI VAN IRVA es a kimeritese KULON jelezve, mert egy csonkolt lista
 * itt nem hianyt okozna, hanem DUPLIKATUMOT: a terv azt olvasna ki, hogy a
 * kategoria meg nincs a Medusaban, es letrehozna masodszor is. Ezert a
 * betoltes megall, ha a lista kimeriti a limitet - a csonkolt halmazon hozott
 * dontes itt draagabb, mint egy elmaradt futas.
 */
export const CATEGORY_LIST_LIMIT = 500;

export const EXTERNAL_ID_LOOKUP_LIMIT = 50;

/**
 * A csatornához tartozó készlethelyek lekérdezésének felső határa.
 *
 * A helyes állapot PONTOSAN EGY, és a hívó fail-closed. A limit mégis tág,
 * mert a „több" eset megállás, és a megálláshoz látni akarjuk, HÁNY hely van
 * és melyek - egy szűk limit itt azt sugallná, hogy kevesebb van, mint
 * amennyi valójában.
 */
export const STOCK_LOCATION_LOOKUP_LIMIT = 50;

/**
 * Egy termék változatainak felső határa.
 *
 * A vetített termékeknek ma egy változatuk van, tehát ötven bőven elég - DE a
 * kimerített limitet akkor is jelezzük, ugyanúgy, ahogy a termék-keresésnél. A
 * lista nem rendez alapértelmezésben, tehát egy csonkolt válasz nem „az első
 * ötvenet" adja vissza, hanem TETSZŐLEGES ötvenet: a „pontosan egy egyezés"
 * ellenőrzés ilyenkor egy részhalmazon futna, és a hiányzó egyezésből azt
 * olvasnánk ki, hogy nincs ilyen cikkszámú változat.
 */
export const VARIANT_LOOKUP_LIMIT = 50;

/**
 * Az ár-beállítási szabályok felső határa.
 *
 * A tábla természeténél fogva kicsi: pénznemenként és régiónként egy sor. A
 * limit mégis ki van írva, mert a hívó a HUF sort KERESI benne, és egy néma
 * csonkolás azt adná vissza, hogy nincs ilyen - vagyis megállást okozna ott,
 * ahol minden rendben van.
 */
export const PRICE_PREFERENCE_LOOKUP_LIMIT = 100;

/**
 * A változat mezői, a készlet-lánccal EGYÜTT.
 *
 * A `inventory_items.inventory.location_levels` út a telepített 2.19.0
 * forrásában használt alak (a kosár és a rendelés folyamatai pontosan ezt
 * kérik le), tehát nem találgatás. AMIT VISZONT NEM TUDUNK INNEN MÉRNI: hogy
 * az admin HTTP réteg `fields` paramétere ugyanezt a kiterjesztést átengedi-e.
 * Ezért a hívó a HIÁNYZÓ mezőt NEM üres listaként olvassa, hanem megáll rajta:
 * az üres lista azt állítaná, hogy nincs kapcsolat, holott csak nem kérdeztünk
 * jól.
 */
/**
 * Amit az ár-lekérdezés kér, és semmi többet.
 *
 * A `*prices` alak a reláció összes skalár mezőjét hozza (`id`,
 * `currency_code`, `amount`) - mérve a telepített 2.19.0 admin
 * `query-config.js` alapértelmezéseiből, ahol ugyanez az alak szerepel.
 */
export const VARIANT_PRICE_FIELDS = ["id", "sku", "deleted_at", "*prices"].join(
  ",",
);

export const VARIANT_INVENTORY_FIELDS = [
  "id",
  "sku",
  "deleted_at",
  "allow_backorder",
  "manage_inventory",
  "inventory_items.inventory.id",
  "inventory_items.inventory.location_levels.location_id",
  "inventory_items.inventory.location_levels.stocked_quantity",
  "inventory_items.inventory.location_levels.reserved_quantity",
].join(",");

export interface MedusaAdminClient {
  /**
   * Keresés külső azonosítóra, a TÖRÖLTEKKEL együtt.
   *
   * A `with_deleted` nem finomság: a törlés puha, a törölt soron rajta marad a
   * külső azonosító, és az alapértelmezett szűrő kizárja a törölteket. Enélkül
   * egy törölt termék azonosítója láthatatlan, a vetítés pedig létrehozna egy
   * másodikat ugyanazzal az azonosítóval - és ezt a Medusa nem akadályozza meg,
   * mert az `external_id` mezőn nincs egyedi index.
   *
   * A hívó a VISSZAKAPOTT SOROKAT számolja, nem a válasz darabszám-mezőjét: az
   * admin lista két ága közül az egyik BECSLÉST tesz ugyanabba a mezőbe.
   *
   * A `truncated` azért van, mert a lista NEM RENDEZ alapértelmezésben. Egy
   * szűk limit tehát nem "az első kettőt" adná vissza, hanem TETSZŐLEGES
   * kettőt, és a döntés egy csonkolt halmazon születne: három találatból (két
   * élő, egy törölt) visszajöhetne egy élő és egy törölt, amiből a hívó azt
   * olvasná ki, hogy pontosan egy élő van. Ezért a limit tág, és ha a válasz
   * kimeríti, azt KÜLÖN jelezzük - a néma csonkolás ugyanaz a hiba másképp.
   */
  findByExternalId(externalId: string): Promise<MedusaLookupResult>;
  /**
   * A LEGKEVESEBB, ami még bizonyít valamit: egyetlen olvasó kérés, `limit=1`,
   * írás nulla. Nem a tartalma számít, hanem hogy jön-e válasz és milyen: ha
   * jön, a hálózat áll és a hitelesítés eldőlt.
   */
  /**
   * MINDEN kategoria, egyben.
   *
   * Szandekosan NEM szur `external_id`-ra. A szures letezeset nem mertuk meg
   * az admin oldalon, es egy nem tamogatott szuroparametert a Medusa
   * figyelmen kivul HAGYHAT - akkor a valasz teljes listanak latszana, es a
   * hivo egy szurtnek hitt halmazon dontene. A parositas ezert memoriaban
   * tortenik, 219 sornal az olcso.
   */
  listProductCategories(): Promise<MedusaCategoryListResult>;
  /** Egy kategoria letrehozasa. A valaszban jon a Medusa-azonosito. */
  createProductCategory(input: MedusaCategoryInput): Promise<MedusaCategoryRow>;
  probe(): Promise<void>;
  /**
   * Egy sales channel, azonosító szerint.
   *
   * A NEVET is visszaadja, és a hívó KIÍRJA, nem állítja: egy rossz, de
   * létező azonosító így a jelentésben látszik meg. Egy név-egyezés
   * ellenőrzése azért nincs, mert annak a bukása egy JOGOS átnevezés lenne,
   * és egy ellenőrzés, ami jogos változásra pirosodik, előbb-utóbb
   * kikapcsolódik - onnantól pedig a helye üresen marad, miközben mindenki
   * azt hiszi, hogy őrzi valami.
   */
  findSalesChannel(id: string): Promise<MedusaSalesChannelRow | null>;
  create(input: MedusaProductInput): Promise<MedusaProductRow>;
  update(
    id: string,
    input: Omit<MedusaProductInput, "options" | "variants">,
  ): Promise<MedusaProductRow>;
  /**
   * A csatornához tartozó készlethelyek - MINDEN FUTÁSKOR, azonosító
   * beégetése nélkül.
   *
   * A `sales_channel_id` NEVESÍTETT szűrő az admin stock-location
   * validátorában (mérve a telepített 2.19.0 forrásából), tehát ez nem
   * találgatás. A hívó fail-closed: ha nem PONTOSAN EGY hely jön vissza, a
   * futás megáll és nem ír semmit. A nulla azt jelenti, hogy rossz csatornát
   * néztünk; a több pedig üzleti döntés, amit nem a kód hoz meg.
   */
  listStockLocationsForSalesChannel(
    salesChannelId: string,
  ): Promise<MedusaStockLocationRow[]>;
  /**
   * Egy termék változatai, a készlet-lánccal együtt, EGY kérésben.
   *
   * A lánc (`inventory_items.inventory.location_levels`) azért utazik együtt a
   * változattal, mert az AZONOSSÁGOT a Medusa saját kapcsolata hordozza, nem
   * egy átnevezhető mező. A cikkszámra szűrő `GET /admin/inventory-items?sku=`
   * út létezik, de a cikkszám az inventory itemen MÁSOLAT: a brief 6. pontja
   * kifejezetten tiltja az átnevezhető mezőt azonosságként.
   */
  listProductVariants(productId: string): Promise<MedusaVariantLookupResult>;
  /** Új készletszint egy helyen. A szint hiánya nem hiba, hanem első futás. */
  createInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    stockedQuantity: number,
  ): Promise<void>;
  /**
   * Meglévő készletszint ABSZOLÚT beállítása.
   *
   * Nem delta: a telepített 2.19.0 `updateInventoryLevels` a kapott értéket
   * BEÁLLÍTJA. Ebből következik az idempotencia - és ebből következik az is,
   * hogy az idempotencia nem a mi kódunk érdeme, hanem a cél oldal
   * tulajdonsága.
   *
   * A HIÁNYZÓ SZINTET NEM HOZZA LÉTRE: az `ensureInventoryLevels` ilyenkor
   * `Item ... is not stocked at location ...` hibát dob (mérve). Ezért van
   * külön létrehozó hívás, és ezért nézzük meg előbb, van-e szint.
   */
  updateInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    stockedQuantity: number,
  ): Promise<void>;
  /** A változat rendelhetőségének beállítása. Lásd `PROJECTED_ALLOW_BACKORDER`. */
  updateVariantBackorder(
    productId: string,
    variantId: string,
    allowBackorder: boolean,
  ): Promise<void>;
  /**
   * Egy termék változatai az ÁRAIKKAL, az ár AZONOSÍTÓJÁVAL együtt.
   *
   * KÜLÖN HÍVÁS a `listProductVariants` mellett, és nem annak bővítése. A
   * készlet-lekérdezés `fields` listája mérve ki van írva, és a két kör MÁS
   * mezőket kér: egy közös, tágabb lista mindkét hívást megdrágítaná, és
   * elmosná, melyik kör mire támaszkodik.
   *
   * AZ `id` MEZŐ A LÉNYEG, nem az összeg. A Medusa ár-frissítése TELJES CSERE:
   * az `id` nélkül küldött sor minden futáson TÖRÖL egy régit és LÉTREHOZ egy
   * újat, miközben a darabszám változatlan marad. Az azonosság tehát csak úgy
   * tartható, ha visszaolvassuk a meglévő sor azonosítóját.
   */
  listVariantPrices(productId: string): Promise<MedusaVariantPriceLookupResult>;
  /**
   * A bolt ár-értelmezési beállításai.
   *
   * AZÉRT OLVASSUK, MERT A HELYESSÉGÜNK EZEN ÁLL. Az Acropora OS BRUTTÓ árat
   * tárol, és az összeget változatlanul küldjük. Ez akkor és csak akkor
   * helyes, ha a bolt a forint árat adóval növeltnek veszi. Ez nem a mi
   * kódunkban lakik, tehát nem is feltételezhetjük: egy átállított
   * `is_tax_inclusive` a mi árunkat NÉMÁN nettóvá minősítené, és a vevő
   * többet fizetne.
   */
  listPricePreferences(): Promise<MedusaPricePreferenceRow[]>;
  /**
   * A változat árainak beállítása, ABSZOLÚT alakban.
   *
   * A lista a price set TELJES kívánt tartalma, nem hozzáfűzés: amit nem
   * küldünk, azt a Medusa TÖRLI (`updatePriceSets_`, `pricesToDelete`). Ezért
   * a hívónak minden megtartandó sort bele kell tennie, a saját `id`
   * értékével.
   */
  setVariantPrices(
    productId: string,
    variantId: string,
    prices: MedusaPriceInput[],
  ): Promise<void>;
}

/** Egy ár-sor, ahogy az admin válasz hozza. */
export interface MedusaPriceRow {
  id: string;
  currency_code: string;
  amount: number;
}

/** Egy változat az áraival. */
export interface MedusaVariantPriceRow {
  id: string;
  sku: string | null;
  deleted_at: string | null;
  /**
   * A `?` szándékos, ugyanazzal az indokkal, mint a készlet-láncnál: a
   * HIÁNYZÓ mező nem ugyanaz, mint az üres lista. Az üres lista azt állítaná,
   * hogy nincs ára, a hiány viszont azt jelentené, hogy nem kérdeztünk jól.
   */
  prices?: MedusaPriceRow[];
}

export interface MedusaVariantPriceLookupResult {
  rows: MedusaVariantPriceRow[];
  truncated: boolean;
}

/** Egy ár-beállítási szabály, pénznemre vagy régióra. */
export interface MedusaPricePreferenceRow {
  id: string;
  attribute: string;
  value: string | null;
  is_tax_inclusive: boolean;
}

/**
 * Amit egy ár-sorból küldünk.
 *
 * Az `id` OPCIONÁLIS, és a hiánya JELENTÉSSEL BÍR: azt kéri, hogy a Medusa
 * hozzon létre új sort. Meglévő sornál KÖTELEZŐ kitölteni, különben a régi
 * törlődik és új születik a helyére.
 */
export interface MedusaPriceInput {
  id?: string;
  currency_code: string;
  amount: number;
}

/**
 * Egy készlethely, ahogy az admin lista visszaadja.
 *
 * A NEVET is kérjük, és a jelentés kiírja. A készlethely azonosítója sehol
 * nincs beégetve: minden futás az ÉRTÉKESÍTÉSI CSATORNA felől kérdezi vissza -
 * lásd `listStockLocationsForSalesChannel`.
 */
export interface MedusaStockLocationRow {
  id: string;
  name: string;
}

/** Egy készletszint, `(inventory_item_id, location_id)` páronként. */
export interface MedusaInventoryLevelRow {
  location_id: string;
  stocked_quantity: number;
  reserved_quantity?: number;
}

/**
 * Egy változat, a hozzá tartozó inventory item LÁNCÁVAL együtt.
 *
 * A `inventory_items` és a beágyazott `location_levels` mező **hiányozhat**, és
 * a hiány NEM ugyanaz, mint az üres lista. Ezért `?` és nem alapértelmezett
 * üres tömb: az üres lista azt ÁLLÍTANÁ, hogy nincs kapcsolat, holott csak nem
 * kérdeztünk jól. A hívó a kettőt külön kezeli, és a hiányra megáll.
 */
/** Változat-keresés eredménye, a csonkolás jelzésével EGYÜTT. */
export interface MedusaVariantLookupResult {
  rows: MedusaVariantRow[];
  /** Igaz, ha a válasz kimerítette a limitet, tehát lehet több változat is. */
  truncated: boolean;
}

export interface MedusaVariantRow {
  id: string;
  sku: string | null;
  /**
   * `null`, ha a változat él; időbélyeg, ha puhán törölték.
   *
   * A keresés `with_deleted` értékkel megy, tehát ez a mező MINDIG megérkezik,
   * és a hívónak SZÉT KELL VÁLASZTANIA az élőt az eltemetettől. A Medusa
   * cikkszám-indexe RÉSZLEGES (`deleted_at IS NULL`), tehát ugyanaz a cikkszám
   * egyszerre ülhet egy élő és egy eltemetett változaton - a kettőt egy
   * halmazban számolni téves „több egyezés" választ adna.
   */
  deleted_at: string | null;
  allow_backorder?: boolean;
  manage_inventory?: boolean;
  inventory_items?: {
    inventory?: {
      id: string;
      location_levels?: MedusaInventoryLevelRow[];
    };
  }[];
}

export interface MedusaAdminConfig {
  baseUrl: string;
  apiKey: string;
}

export class MedusaConfigurationError extends Error {}

/**
 * A Medusa NEM kétszázas válasza, a státusszal EGYÜTT.
 *
 * Eddig sima `Error` volt, az üzenetbe írt kóddal. Azért lett saját típusa,
 * mert a hívó oldalnak a SZÁM kell, nem a szöveg: a `401` és a `403` két külön
 * dolgot jelent, és egy üzenet-illesztés pontosan akkor romlana el, amikor a
 * legfontosabb lenne. Az üzenet formátuma változatlan, mert az a parancssori
 * kimeneten már látszik.
 */
/**
 * EGY MEDUSA-HIBA, AHOGY A JELENTÉSBE KERÜLHET: a STÁTUSZ igen, a TÖRZS nem.
 *
 * A `MedusaAdminHttpError` üzenete a válasz törzsének első 500 karakterét is
 * viszi, mert a hibakeresésnél az a hasznos. A megállás-szöveg viszont a
 * jelentésbe és a parancssori kimenetre kerül, és onnantól nem tudjuk, ki
 * olvassa. Mérve: azt NEM tudjuk, hogy a Medusa melyik hibaválasza mit
 * visszhangoz, és a brief szerint a titok plaintext értéke hibakimenetben sem
 * jelenhet meg. Egy mért eset (401) `{"message":"Unauthorized"}` volt, tehát
 * ártalmatlan - de ezt csak UTÓLAG lehetett megtudni, és épp ez a baj vele.
 *
 * Ezért minden megnevezett Medusa-hiba EZEN a függvényen megy át. Ha valaki
 * egy új helyen kapja el a hibát, ne kelljen újra végiggondolnia: a szabály
 * egy helyen áll.
 *
 * A NEM HTTP eredetű hibánál az üzenet MEGMARAD, és ez nem következetlenség:
 * az a szöveg a futtatókörnyezetből jön (időtúllépés, névfeloldás), nem a
 * Medusa válaszából, tehát nem visszhangozhat semmit, amit mi küldtünk.
 */
export function describeMedusaFailure(error: unknown): string {
  if (error instanceof MedusaAdminHttpError)
    return `a Medusa HTTP ${error.status} választ adott`;
  if (error instanceof Error) return error.message;
  return String(error);
}

export class MedusaAdminHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`MEDUSA_ADMIN_HTTP_${status}: ${body}`);
    this.name = "MedusaAdminHttpError";
  }
}

/**
 * A CÍM, és CSAK a cím.
 *
 * A cím nem titok: nincs tárolva, nem is kell tárolni, és a környezetből jön.
 * A kulcs viszont a hitelesítő adat szolgáltatójától érkezik, tárolóból vagy
 * tartalékból.
 *
 * Ez a két dolog korábban EGY függvényben állt, és abból egy mért hiba lett: a
 * hívó felülírta ugyan az `apiKey` mezőt a tárolt kulccsal, de a függvény
 * MEGKÖVETELTE a környezeti kulcsot, tehát annak az ÉRTÉKE sosem használódott
 * fel, a MEGLÉTE viszont feltétel volt. Ép tárolt kulcs mellett, környezeti
 * kulcs nélkül a próba emiatt „nincs beállítva" állapotot adott: hamis
 * állapotot, nem hibát.
 */
export function medusaAdminBaseUrlFromEnv(
  env: Record<string, string | undefined>,
): string {
  const baseUrl = env.MEDUSA_ADMIN_URL;
  if (!baseUrl)
    throw new MedusaConfigurationError("MEDUSA_ADMIN_URL nincs beállítva.");
  return baseUrl.replace(/\/+$/, "");
}

/**
 * A KLIENS, ahogy futásidőben készül: a cím a környezetből, a kulcs a hívótól.
 *
 * Azért külön, exportált függvény, és nem egy névtelen alapértelmezés a
 * szolgáltatás konstruktorában, mert MÉRHETŐNEK kell lennie. Egy teszt, ami a
 * saját hamis gyárát adja át, pontosan ezt az utat NEM méri: zöld marad akkor
 * is, ha itt bárki visszacsempész egy környezeti kulcs-olvasást. Ez nem
 * feltevés, hanem mért tapasztalat: az első változatom így volt zöld két olyan
 * rontás mellett is, aminek pirosnak kellett volna lennie.
 */
export function medusaClientFromEnvironment(
  apiKey: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): MedusaAdminClient {
  return new HttpMedusaAdminClient(
    { baseUrl: medusaAdminBaseUrlFromEnv(env), apiKey },
    fetchImpl,
  );
}

export class HttpMedusaAdminClient implements MedusaAdminClient {
  /** A `fetch` azért paraméter, hogy a kérés ALAKJA mérhető legyen. */
  constructor(
    private readonly config: MedusaAdminConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    // A kulcs a Basic séma FELHASZNÁLÓNEVE, jelszó nélkül, ezért a záró
    // kettőspont - így írja le a Medusa saját olvasása is.
    const encoded = Buffer.from(`${this.config.apiKey}:`).toString("base64");
    return {
      authorization: `Basic ${encoded}`,
      "content-type": "application/json",
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      // A törzs hasznos: a Medusa a hibát magyarázza (például hiányzó opció).
      // A fejléceket NEM naplózzuk, mert azok viszik a kulcsot.
      const body = await response.text();
      throw new MedusaAdminHttpError(response.status, body.slice(0, 500));
    }
    return (await response.json()) as T;
  }

  async findByExternalId(externalId: string): Promise<MedusaLookupResult> {
    const params = new URLSearchParams({
      external_id: externalId,
      with_deleted: "true",
      fields: "id,deleted_at,external_id",
      limit: String(EXTERNAL_ID_LOOKUP_LIMIT),
    });
    const body = await this.request<{ products: MedusaProductLookupRow[] }>(
      `/admin/products?${params.toString()}`,
    );
    const rows = body.products ?? [];
    return { rows, truncated: rows.length >= EXTERNAL_ID_LOOKUP_LIMIT };
  }

  async findSalesChannel(id: string): Promise<MedusaSalesChannelRow | null> {
    try {
      const body = await this.request<{ sales_channel: MedusaSalesChannelRow }>(
        `/admin/sales-channels/${encodeURIComponent(id)}`,
      );
      return body.sales_channel ?? null;
    } catch (error) {
      /**
       * A NEM LÉTEZŐ azonosító nem kivétel, hanem válasz: `null`. Minden más
       * hiba tovább száll, mert az MÁS kérdés - egy hálózati hiba vagy egy
       * lejárt kulcs nem azt jelenti, hogy a csatorna nincs.
       */
      if (error instanceof MedusaAdminHttpError && error.status === 404)
        return null;
      throw error;
    }
  }

  async listProductCategories(): Promise<MedusaCategoryListResult> {
    const params = new URLSearchParams({
      fields: "id,name,external_id,parent_category_id",
      limit: String(CATEGORY_LIST_LIMIT),
    });
    const body = await this.request<{
      product_categories: MedusaCategoryRow[];
    }>(`/admin/product-categories?${params.toString()}`);
    const rows = body.product_categories ?? [];
    return { rows, truncated: rows.length >= CATEGORY_LIST_LIMIT };
  }

  async createProductCategory(
    input: MedusaCategoryInput,
  ): Promise<MedusaCategoryRow> {
    const body = await this.request<{ product_category: MedusaCategoryRow }>(
      "/admin/product-categories",
      { method: "POST", body: JSON.stringify(input) },
    );
    return body.product_category;
  }

  async probe(): Promise<void> {
    await this.request<{ products: MedusaProductRow[] }>(
      "/admin/products?limit=1",
    );
  }

  async create(input: MedusaProductInput): Promise<MedusaProductRow> {
    const body = await this.request<{ product: MedusaProductRow }>(
      "/admin/products",
      { method: "POST", body: JSON.stringify(input) },
    );
    return body.product;
  }

  async update(
    id: string,
    input: Omit<MedusaProductInput, "options" | "variants">,
  ): Promise<MedusaProductRow> {
    const body = await this.request<{ product: MedusaProductRow }>(
      `/admin/products/${encodeURIComponent(id)}`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return body.product;
  }

  async listStockLocationsForSalesChannel(
    salesChannelId: string,
  ): Promise<MedusaStockLocationRow[]> {
    /**
     * A `fields` azért van kiírva, mert a `name` BENNE VAN ugyan az admin
     * stock-location alapmezőiben, de az alapértelmezés egy lista, ami
     * változhat - a szűkítés viszont egy hívásnyi adatot spórol, és
     * kimondja, mire van szükségünk.
     */
    const params = new URLSearchParams({
      sales_channel_id: salesChannelId,
      fields: "id,name",
      limit: String(STOCK_LOCATION_LOOKUP_LIMIT),
    });
    const body = await this.request<{
      stock_locations: MedusaStockLocationRow[];
    }>(`/admin/stock-locations?${params.toString()}`);
    return body.stock_locations ?? [];
  }

  async listProductVariants(
    productId: string,
  ): Promise<MedusaVariantLookupResult> {
    /**
     * A `with_deleted` NEM finomság, ugyanazzal az indokkal, mint a
     * termék-keresésnél: a törlés puha, és az alapértelmezett szűrő kizárja a
     * törölteket. Enélkül egy eltemetett változat cikkszáma láthatatlan, a
     * hívó pedig a „nincs ilyen" és az „el van temetve" esetet nem tudja
     * megkülönböztetni - holott a kettő MÁS teendő.
     */
    const params = new URLSearchParams({
      with_deleted: "true",
      fields: VARIANT_INVENTORY_FIELDS,
      limit: String(VARIANT_LOOKUP_LIMIT),
    });
    const body = await this.request<{ variants: MedusaVariantRow[] }>(
      `/admin/products/${encodeURIComponent(productId)}/variants?${params.toString()}`,
    );
    const rows = body.variants ?? [];
    return { rows, truncated: rows.length >= VARIANT_LOOKUP_LIMIT };
  }

  async createInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    stockedQuantity: number,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/inventory-items/${encodeURIComponent(inventoryItemId)}/location-levels`,
      {
        method: "POST",
        body: JSON.stringify({
          location_id: locationId,
          stocked_quantity: stockedQuantity,
        }),
      },
    );
  }

  async updateInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    stockedQuantity: number,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/inventory-items/${encodeURIComponent(inventoryItemId)}` +
        `/location-levels/${encodeURIComponent(locationId)}`,
      {
        method: "POST",
        body: JSON.stringify({ stocked_quantity: stockedQuantity }),
      },
    );
  }

  async updateVariantBackorder(
    productId: string,
    variantId: string,
    allowBackorder: boolean,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/products/${encodeURIComponent(productId)}` +
        `/variants/${encodeURIComponent(variantId)}`,
      {
        method: "POST",
        body: JSON.stringify({ allow_backorder: allowBackorder }),
      },
    );
  }

  async listVariantPrices(
    productId: string,
  ): Promise<MedusaVariantPriceLookupResult> {
    /**
     * A `with_deleted` itt is bent van, ugyanazzal az indokkal, mint a
     * készlet-lekérdezésnél: a cikkszám-index RÉSZLEGES, tehát ugyanaz a
     * cikkszám ülhet egy élő és egy eltemetett változaton is, és a hívónak
     * szét kell tudnia választani a kettőt.
     */
    const params = new URLSearchParams({
      with_deleted: "true",
      fields: VARIANT_PRICE_FIELDS,
      limit: String(VARIANT_LOOKUP_LIMIT),
    });
    const body = await this.request<{ variants: MedusaVariantPriceRow[] }>(
      `/admin/products/${encodeURIComponent(productId)}/variants?${params.toString()}`,
    );
    const rows = body.variants ?? [];
    return { rows, truncated: rows.length >= VARIANT_LOOKUP_LIMIT };
  }

  async listPricePreferences(): Promise<MedusaPricePreferenceRow[]> {
    const params = new URLSearchParams({
      limit: String(PRICE_PREFERENCE_LOOKUP_LIMIT),
    });
    const body = await this.request<{
      price_preferences: MedusaPricePreferenceRow[];
    }>(`/admin/price-preferences?${params.toString()}`);
    return body.price_preferences ?? [];
  }

  async setVariantPrices(
    productId: string,
    variantId: string,
    prices: MedusaPriceInput[],
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/products/${encodeURIComponent(productId)}` +
        `/variants/${encodeURIComponent(variantId)}`,
      { method: "POST", body: JSON.stringify({ prices }) },
    );
  }
}
