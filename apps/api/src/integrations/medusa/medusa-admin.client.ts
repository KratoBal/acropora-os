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
import type { WebshopStuckMail, WebshopStuckMailList } from "@acropora/types";
import type { KnowledgeProjection } from "../../products/knowledge/knowledge.policy.js";
import type { MedusaShippingFlags } from "./medusa-shipping-attributes.policy.js";

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

/**
 * A BOLT OLDALI SZALLITASI ZASZLO-REKORD.
 *
 * Az `id` LEHET `null`: a vegpont akkor is valaszol, ha meg nincs rekord, es
 * olyankor a csupa-hamis alapertelmezest adja vissza. A hivo ezt NEM
 * kulonboztetheti meg a "letezik, es minden hamis" allapottol -- es nem is
 * kell: mind a ketto ugyanazt jelenti, hogy nincs korlatozas.
 */
export interface MedusaShippingAttributeRow extends MedusaShippingFlags {
  id: string | null;
  product_id: string;
}

export interface MedusaProductInput {
  title: string;
  /**
   * A bolt szállítási profilja (kártya 2a7f2313): profil nélkül a termék nem
   * rendelhető meg. A 2.20.1 létrehozó validátora elfogadja.
   */
  shipping_profile_id?: string;
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
  /**
   * A termek kategoriai, azonosito szerint.
   *
   * A MEZO ELHAGYASA ES AZ URES TOMB NEM UGYANAZ, es ez nem elmeleti
   * kulonbseg. A `sales_channels`-rol a telepitett 2.19.0 forrasabol MERTUK,
   * hogy csere-szemantikaju: az ures lista a lekotes. A `categories`-rol
   * ugyanez NEM merheto ki ugyanonnan -- a termek-frissites csere-listaja
   * (`relations: ["options", "options.values", "tags"]`) NEM tartalmazza,
   * tehat mas uton kezelodik, es hogy melyiken, azt ez a lista nem mondja meg.
   *
   * AMIG EZ NINCS ELESBEN MEGMERVE, a hivo szabalya: ha nincs mit kuldeni, a
   * mezot EL KELL HAGYNI, nem ures tombot kuldeni. Ha csere-szemantikaju, az
   * ures tomb TOROLNE a termek besorolasat; ha nem az, a mezo elhagyasa
   * ugyanolyan helyes. A ket vilag kozul csak az egyikben szamit, es ott
   * SULYOSAN.
   */
  categories?: { id: string }[];
  /**
   * A TERMEK GYUJTEMENYE, AZAZ NALUNK A MARKAJA.
   *
   * Egy-egy kapcsolat: egy termek EGY gyujtemenyhez tartozhat. A mezo
   * ELHAGYASA es a `null` NEM ugyanaz -- a `null` LEVENNE a megleveot --, ezert
   * a hivo szabalya ugyanaz, mint a kategoriaknal es a metaadatnal: ha nincs
   * mit kuldeni, a mezo elmarad. A dontes maga a `medusa-brand.policy.ts`
   * modulban all, adatbazis nelkul merhetoen.
   */
  collection_id?: string;
  /**
   * SZABAD KULCS-ERTEK PAROK A TERMEKEN.
   *
   * MIERT KELL: a Medusanak NINCS sajat SEO-mezoje (merve a telepitett 2.19.0
   * tipusdefinicioján: a `CreateProductDTO` ismer `thumbnail`, `images`,
   * `handle` es `metadata` mezot, SEO-t nem). A UNAS `Robots` erteke -- az
   * egyetlen kezzel irt SEO-adat a katalogusban, ket termeken -- igy csak itt
   * mehet at.
   *
   * A MEZO ELHAGYASA ES AZ URES OBJEKTUM NEM UGYANAZ, ugyanugy, mint a
   * `handle`-nel: egy ures `metadata` felulirna, amit a bolt oldalan barki mas
   * oda tett. A hivo szabalya: ha nincs mit kuldeni, a mezot EL KELL HAGYNI.
   */
  /**
   * AZ ERTEK `unknown`, ES EZ MERT DONTES, NEM LAZASAG.
   *
   * A mezo tartalma nem csak a mienk: az osszefesules utan idegen kulcsok is
   * benne allnak, amiket valaki a Medusa feluleten adott hozza. Azok tipusa
   * NEM a mi dontesunk (lehet szam, logikai ertek, beagyazott objektum), es
   * szoveggé alakitani oket ANNYI, mint atirni valaki adatat. Amit nem mi
   * tettunk oda, azt valtozatlanul irjuk vissza.
   */
  metadata?: Record<string, unknown>;
  /**
   * A TERMÉK KÉPEI, A LISTA SORRENDJÉBEN.
   *
   * A SORREND MAGA AZ ADAT, ezért nincs rang-mező. Mérve a telepített 2.19.0
   * forrásából, MINDKÉT ágon:
   *
   *   create  a hiányzó `rank` a tömb INDEXE lesz (a normalizáló csak akkor
   *           hagyja békén, ha a hívó adott ilyet)
   *   update  a `rank` MINDIG felülíródik a tömb indexével (a repository
   *           `deepUpdate` metódusa feltétel nélkül képezi le)
   *
   * Rangot tehát sosem küldünk: nem is tudnánk. A HTTP admin validátor a
   * képobjektumban KIZÁRÓLAG `url`-t fogad, és minden más kulcsot CSENDBEN
   * eldob (a kép-szintű séma stripel, a felső szint strictel). Futtatva a
   * telepített validátoron: `{ url, rank }`, `{ url, alt }` és
   * `{ url, metadata }` mind ELFOGADVA, és a többlet eltűnik.
   *
   * EBBŐL KÖVETKEZIK, HOGY AZ ALT SZÖVEG EZEN AZ ÚTON NEM MEGY ÁT. Nem
   * mulasztás: nincs mező, ahova menne, és a próbálkozás nem hibázna, hanem
   * csendben veszne el.
   *
   * A MEZŐ ELHAGYÁSA ÉS AZ ÜRES TÖMB NEM UGYANAZ, ugyanúgy, mint a
   * kategóriáknál -- csak itt a különbség MÉRT: az `images` az update-ágon
   * CSERE-szemantikájú, tehát az üres tömb LETÖRÖLNÉ a termék meglévő képeit,
   * és a hívás sikerrel térne vissza.
   */
  images?: { url: string }[];
  /**
   * A FŐ KÉP URL-JE, KÜLÖN MEZŐBEN.
   *
   * Nem hivatkozás a fenti lista egyik elemére: a Medusán ez egy önálló,
   * szabad szöveges mező (`model.text().nullable()`).
   *
   * MINDEN FUTÁSNÁL EXPLICIT MEGY, és ez a lelet mondja meg, miért: a
   * create-ág normalizálója visszaesik az `images[0].url` értékére, ha a mező
   * hiányzik -- az UPDATE-ág viszont NEM. Ott a régi érték ragadna benne, és
   * egy megváltozott fő kép csendben nem érne át. A vetítés a második
   * futástól update-el, tehát a visszaesésre hagyatkozni annyi lenne, mint
   * csak az első futásra megírni a szabályt.
   */
  thumbnail?: string;
  options: { title: string; values: string[] }[];
  variants: {
    title: string;
    sku: string;
    options: Record<string, string>;
    /**
     * A VONALKOD, ES A HOSSZ DONTI EL A MEZOT: 13 szamjegy `ean`, 12 szamjegy
     * `upc`. Mind a ketto SEARCHABLE a cel oldalon (merve a telepitett 2.19.0
     * variant-modelljen), tehat a vevo altal beirt kod ezen mulik.
     *
     * Elhagyhato, es az elhagyas NEM ugyanaz, mint az ures ertek: amelyik
     * termeknek nincs ervenyes vonalkodja, annal a kulcs ki sem megy.
     */
    ean?: string;
    upc?: string;
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
  /**
   * AZERT KERJUK LE, MERT AZ ELLENORZES ENELKUL NEM TUD ELBUKNI. A betoltes
   * `is_active: true` erteket kuld, de hogy a Medusa el is TAROLTA-e, azt csak
   * a visszaolvasott ertek mondja meg -- es ha nem tarolta, 219 lathatatlan
   * kategoria all elo ugy, hogy minden mas szam helyes.
   */
  is_active: boolean;
  /**
   * A TAROLT WEBCIM. Azert kerjuk le, mert enelkul nem lehet megmondani, hogy
   * egy MAR ALLO kategoria handle-je elter-e a szabalyunktol -- es a frissites
   * pontosan ezen a kulonbsegen all.
   *
   * MERVE 2026-09-08 a teszt peldanyon: a 219 tarolt handle mind GEPIESEN
   * kepzett (kisbetusites plusz szokoz-csere, hetnel camelCase-vagas is), tehat
   * nincs kozottuk kezzel atirt. Ha egyszer lesz, az ITT fog latszani.
   */
  handle: string;
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
  /**
   * A WEBCIM, ES KOTELEZO -- UGYANABBOL AZ OKBOL, MINT AZ `is_active`.
   *
   * A Medusa a NEVBOL szarmaztat, ha nem kuldunk
   * (`productCategory.handle ??= kebabCase(name)`), es a kategoria-agon NEM
   * ellenorzi az ervenyesseget: az `isValidHandle` a TERMEK againban all.
   * Merve 2026-09-08 a telepitett 2.19.0 forrasabol, es a teszt peldanyon:
   * 219 kategoriabol 214 handle-je ervenytelen, csendben letrejove.
   *
   * Ezert nem elhagyhato mezo: az ertek DONTES (lasd
   * `medusa-category-handle.ts`), es a dontest ne lehessen veletlenul
   * kihagyni. Elhagyhatokent a hivо azt kapna, amit a Medusa talal ki.
   */
  handle: string;
  /**
   * KOTELEZO, ES EZ NEM SZIGOR: az ertek DONTES, es a dontest ne lehessen
   * veletlenul elhagyni. Az indok a tipus alatt all.
   */
  is_active: boolean;
}

/**
 * AMIT EGY MAR LETEZO kategorian atirhatunk.
 *
 * KET DOLOGBAN KULONBOZIK A `MedusaCategoryInput`-tol, es mindketto szandekos:
 *
 *   NINCS BENNE `external_id`, `parent_category_id` es `is_active`. Azok a
 *   LETREHOZASKOR dolnek el; egy frissitesnek nem dolga atrendezni a fat vagy
 *   ki-be kapcsolni egy kategoriat, es ha egyszer kellene, az kulon dontes.
 *
 *   UNIO, NEM `Partial`. Igy egy URES javitas FORDITASI HIBA, nem futasideju
 *   nulla-muvelet. Egy ures keres ugyanis sikerrel ternе vissza, es a
 *   jelentesben ugy latszana, mintha frissitettunk volna.
 *   (Merve 2026-09-22: `updateProductCategory(id, {})` -> TS2345.)
 */
export type MedusaCategoryPatch =
  { name: string; handle?: string } | { name?: string; handle: string };

/**
 * AZ AKTIV JELOLOT KI KELL KULDENI, ES EZ EGY MERESEN MULT.
 *
 * Az elso valtozat opcionalisan hagyta, es a betoltes nem is kuldte: az ervelés
 * az volt, hogy ha a Medusa alapertelmezese nem aktiv, az HANGOS hiba lesz, es
 * majd megmutatja az elso futas. Ez az ervelés MEGDOLT, mert az alapertelmezest
 * le lehet merni, es le is mertem a Medusa sajat modelljeben:
 *
 *     is_active: model.boolean().default(false)
 *
 * Vagyis a jelolo nelkul mind a 219 kategoria INAKTIVAN keletkezne. Az nem
 * "hangos hiba, amibol tanulunk", hanem egy futas, ami SIKERESNEK latszik es
 * semmit nem szallit -- raadasul epp azt a futast pazarolna el, amire kulon
 * engedelyt kell kerni.
 *
 * === AMIT VISZONT NEM TUDUNK, ES EZERT NEM SORONKENT DONTUNK ===
 *
 * A mi `Category` tablank nem hordoz lathatosagot (id, name, slug, parentId).
 * A UNAS export IGEN, es le is mertem: 219-bol 211 megjelenik az oldalon, 8 nem
 * (koztuk: Shop 'n the Shop, Édesvízi akvarisztika, Akváriumok, biOrb).
 *
 * Ezert a betoltes MINDEGYIKET aktivkent hozza letre, es ez tudatos: a cel a
 * TESZT peldany, ott a nyolc rejtett kategoria senkinek nem jelenik meg, es a
 * visszaallitasa nyolc sor. A forditott tevedes -- 219 lathatatlan kategoria --
 * az egesz futast ertektelenne tenne.
 *
 * EZ A DONTES ERVENYTELEN, MIHELYT ELES KIRAKAT KERUL A MEDUSA ELE. Akkor a
 * lathatosagot a sajat modellunkbe kell felvenni es soronkent szarmaztatni,
 * nem itt egy konstanssal eldonteni.
 *
 * === A HANDLE, ES AMIERT A CIM-SZABALY NEM DISZ ===
 *
 * A `handle`-t nem kuldjuk. A Medusa ilyenkor a NEVBOL szarmaztatja
 * (`productCategory.handle ??= kebabCase(productCategory.name)`), es a `handle`
 * oszlopon EGYEDI index all (`IDX_category_handle_unique`).
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
 * Nem eleg, hogy a cimek kulonbozok: a `kebabCase` ket kulonbozo cimet is
 * osszevonhat.
 */

export interface MedusaCategoryListResult {
  rows: MedusaCategoryRow[];
  /** Igaz, ha a valasz kimeritette a limitet, tehat lehet tobb is. */
  truncated: boolean;
}

/**
 * Egy gyujtemeny a Medusan. NALUNK EZ A MARKA.
 *
 * A `handle` azert kell, mert a marka-oldal cime ebbol lesz, es ez az egyetlen
 * termeszetes kulcs a cel oldalon. Az `external_id` a mi marka-azonositonk: ezen
 * mulik, hogy egy mar letezo gyujtemenyrol el tudjuk-e donteni, MI hoztuk-e
 * letre. A kettot egyutt kell lekerni, kulonben egy sajat kezzel letrehozott es
 * egy idegen gyujtemeny megkulonboztethetetlen.
 */
export interface MedusaCollectionRow {
  id: string;
  title: string;
  handle: string;
  external_id: string | null;
}

/**
 * Amit egy gyujtemeny letrehozasakor kuldunk.
 *
 * Merve a telepitett 2.19.0 `CreateCollection` validatorabol: `title` kotelezo,
 * a `handle`, az `external_id` es a `metadata` elhagyhato. NINCS `is_active`
 * mezoje -- ellentetben a kategoriaval, ahol az elhagyasa csendben inaktiv sort
 * hozott volna letre.
 *
 * A `handle` es az `external_id` NALUNK MEGIS KOTELEZO, es ez dontes: a handle
 * nelkul a Medusa a cimbol szarmaztatna egyet (tehat a marka-oldal cime nem a
 * mi `slug` mezonk lenne), a kulso azonosito nelkul pedig egy kesobbi futas nem
 * tudna megmondani, hogy ezt a gyujtemenyt MI hoztuk-e letre.
 */
export interface MedusaCollectionInput {
  title: string;
  handle: string;
  external_id: string;
}

export interface MedusaCollectionListResult {
  rows: MedusaCollectionRow[];
  /** Igaz, ha a valasz kimeritette a limitet, tehat lehet tobb is. */
  truncated: boolean;
}

/**
 * A gyujtemeny-lista felso hatara.
 *
 * A marka-szotarunk 48 ismert markat sorol, tehat az otszaz tizszeres tartalek.
 * A limit megis KELL, es a `truncated` jelzes vele egyutt: egy csonkolt lista
 * ugyanugy nez ki, mint egy teljes, es a terv ilyenkor olyan markakat akarna
 * letrehozni, amik mar leteznek.
 */
export const COLLECTION_LIST_LIMIT = 500;

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

/**
 * Egy lehivas felso hatara. A bolt napi rendelesszama ma egy szamjegyu, tehat
 * ez a hatar nem szoritas, hanem VEDELEM: ha valaha nagysagrenddel tobb jonne,
 * a `truncated` jelzes szol, ahelyett hogy egy korbe probalnank behuzni.
 */
const ORDER_LIST_LIMIT = 200;

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

/**
 * EGY MEDUSA-RENDELES ANNYI MEZOJE, AMENNYIT AZ ATVETEL HASZNAL.
 *
 * A mezonevek NEM a UNAS-oldali parjukbol masolodtak at, hanem a telepitett
 * `@medusajs/types` 2.19.0 csomag `BaseOrder` es `AdminOrder` tipusaibol.
 * Ugyanaz az ok, amiert a repo minden Medusa-entitashoz sajat, szuk sort ir:
 * a teljes valasz tobb szaz mezot hordoz, es amit nem hasznalunk, azt nem is
 * akarjuk a szerzodesunkbe venni.
 *
 * A `display_id` es a `custom_display_id` a szerzodesben OPCIONALIS, tehat itt
 * sem lehet kotelezo. Aki kotelezove teszi, az egy olyan allitast tesz a
 * tipusba, amit a kulso rendszer nem garantal.
 */
export interface MedusaOrderRow {
  id: string;
  display_id?: number;
  status: string;
  email: string | null;
  currency_code: string;
  total: number;
  created_at: string;
  updated_at: string;
  sales_channel_id: string | null;
}

/**
 * EGY SOR A WEBSHOP RENDELÉSLISTÁJÁBÓL (`GET /admin/order-overview`,
 * acropora-commerce #472, `order-query-projection.ts`). A pénz sima szám, a
 * dátum ISO-szöveg (JSON).
 */
export interface MedusaOrderOverviewRow {
  id: string;
  display_id: number;
  created_at: string;
  total: number;
  email: string;
  currency_code: string | null;
  customer_name: string | null;
  phone: string | null;
  business_status: {
    code: string | null;
    label: string | null;
    changed_at: string | null;
  };
  shipping_method: string | null;
  /** `type`: a GLS-pont fajtája (`parcel-shop` / `parcel-locker`), ha a webshop adja. */
  pickup_point: {
    id: string | null;
    name: string;
    type?: string | null;
  } | null;
  payment: {
    provider_id: string | null;
    status: string | null;
    amount: number | null;
    captured_amount: number | null;
    refunded_amount: number | null;
    /** A kártyás zárolás lejárata (murena, lejáró zárolás); régi webshopnál hiányzik. */
    hold_expires_at?: string | null;
  } | null;
  related_order: { id: string; role: "pickup" | "parent" } | null;
  customer_signals: {
    is_new_customer: boolean;
    unsuccessful_closed_order_count: number;
    has_other_open_order: boolean;
    purchased_without_registration: boolean;
  };
}

export interface MedusaOrderOverviewPage {
  orders: MedusaOrderOverviewRow[];
  count: number;
  offset: number;
  limit: number;
}

/** Egy cím a Medusa rendelésen (a kért mezőkkel). */
/**
 * A CSOMAGPONT A WEBSHOP LISTÁJÁBÓL (commerce #494, a pénztár pontjai). Csak a
 * mezők, amiket az OS használ: a két fuvarozó közös része, és GLS-nél a fajta
 * és a terhelés, Foxpostnál a pont típusa.
 */
export interface MedusaPickupPointRow {
  id: string;
  name: string;
  zip: string;
  city: string;
  address: string;
  /** GLS: `parcel-shop` / `parcel-locker`. */
  type?: string | null;
  /** Foxpost: „FOXPOST A-BOX”, „Packeta Z-Pont”... */
  variant?: string | null;
  /** GLS: `outOfOrder` nem választható. */
  locker_saturation?: string | null;
}

/** `GET /admin/order-shipping/:id/points` (commerce #494). */
export interface MedusaOrderPointSearch {
  carrier: "foxpost" | "gls";
  current_point_id: string | null;
  available: boolean;
  pickup_points?: MedusaPickupPointRow[];
  count?: number;
}

/** `POST /admin/order-shipping/:id/point` (commerce #494). */
export interface MedusaOrderPointChange {
  carrier: "foxpost" | "gls";
  changed: boolean;
  previous_point_id: string | null;
  point: Record<string, unknown> | null;
}

/**
 * `POST /admin/order-split/:id` (commerce, murena 26630): az ÚJ rendelés
 * (`order_id`, `display_id`) és a két új összeg. `payment_state` az új
 * rendelésé: kártyás zárolásnál `awaiting_payment` (fizetési linkkel fizet).
 */
export interface MedusaOrderSplit {
  order_id: string;
  display_id: number | null;
  parent_order_id: string;
  parent_total: number;
  total: number;
  payment_state: string;
}

/** `GET /admin/order-shipping/:id/options` (commerce, murena 26640). */
export interface MedusaOrderShippingOptions {
  current_option_id: string | null;
  options: {
    id: string;
    name: string;
    amount: number;
    carrier: "gls" | "foxpost";
    needs_point: boolean;
    heavy: boolean;
  }[];
}

/**
 * `POST /admin/order-shipping/:id/method` (commerce, murena 26640). Ha
 * `payment_due`, a különbözet a meglévő fizetési link útján fizetendő.
 */
export interface MedusaOrderMethodChange {
  changed: boolean;
  previous_total: number;
  total: number;
  difference: number;
  payment_due: boolean;
  payment_state: string | null;
}

/** `POST /admin/order-notes/:id` (commerce #493): a mentés utáni állapot. */
export interface MedusaOrderNotes {
  customer_note: string | null;
  carrier_note: string | null;
}

export interface MedusaOrderAddressRow {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  phone?: string | null;
  /** A számlázási címen a cég adószáma: `metadata.tax_id` (commerce `szamlazas.ts`). */
  metadata?: Record<string, unknown> | null;
}

/**
 * EGY RENDELÉS RÉSZLETE (`GET /admin/orders/:id`, a `ORDER_DETAIL_FIELDS`
 * mezőivel). A fizetés `data` mezője a szolgáltatóé: a Stripe-nál a
 * PaymentIntent, benne a `client_secret` is -- ebből az OS CSAK az
 * azonosítót veszi ki, a többit nem adja tovább.
 */
export interface MedusaOrderDetailRow {
  id: string;
  display_id: number;
  created_at: string;
  email: string | null;
  currency_code: string;
  customer_id: string | null;
  metadata: Record<string, unknown> | null;
  total: number;
  subtotal: number;
  discount_total: number;
  shipping_total: number;
  shipping_address: MedusaOrderAddressRow | null;
  billing_address: MedusaOrderAddressRow | null;
  items: {
    id: string;
    title: string;
    product_title: string | null;
    variant_title: string | null;
    variant_sku: string | null;
    quantity: number;
    unit_price: number;
    total: number;
    metadata: Record<string, unknown> | null;
    /** Az ÁFA-kulcs a webshop adóterületéből; a számla ebből veszi a kulcsot. */
    tax_lines?: { rate: number }[] | null;
  }[];
  shipping_methods: {
    name: string;
    data: Record<string, unknown> | null;
    /**
     * SZÁMOLT MEZŐ, és kifejezett `fields` listával a webshop NEM adja
     * (acrobot mérése, commerce-stage 41-43. rendelés, 2026-10-05): ilyenkor
     * `undefined`. A tárolt ár az `amount`, az `is_tax_inclusive` mellett.
     */
    total?: number | null;
    amount?: number | null;
    is_tax_inclusive?: boolean | null;
    tax_lines?: { rate: number }[] | null;
  }[];
  payment_collections: {
    status: string | null;
    amount: number | null;
    authorized_amount: number | null;
    captured_amount: number | null;
    refunded_amount: number | null;
    payments: {
      id: string;
      provider_id: string;
      data: Record<string, unknown> | null;
    }[];
    /**
     * A FÜGGŐ FIZETÉS (utánvét, előre utalás) a leadáskor csak munkamenet: a
     * Medusa `pending_authorization`-nél fizetés-rekordot nem hoz létre
     * (payment 2.20.1, `authorizePaymentSession`). Régi kérésnél hiányzik.
     */
    payment_sessions?: {
      provider_id: string;
      status: string | null;
    }[];
  }[];
}

/** A csomag-értesítő törzse (commerce `AdminOrderShippingNotice`, szigorú: más mező 400). */
export interface MedusaShippingNotice {
  carrier: "foxpost" | "gls";
  tracking_number: string;
  /** A szállító nyilvános követő oldala; a webshop levele gombot tesz rá (commerce #477). */
  tracking_url?: string;
  /** Csak napló a webshopban: az OS csomag-sorának azonosítója. */
  parcel_id?: string;
}

export type MedusaShippingNoticeResult =
  | { sent: true }
  | { sent: false; reason: "mail_off" | "no_email" | "already_sent" | string };

/** A webshop üzleti státusza egy rendelésre (`GET /admin/order-business-status/:id`, #472). */
export interface MedusaOrderBusinessStatus {
  order_id: string;
  status: string;
  label: string;
  changed_at: string;
  next_statuses: { status: string; label: string }[];
  history: {
    from_status: string | null;
    from_label: string | null;
    to_status: string;
    to_label: string;
    actor: string;
    source: string;
    created_at: string;
    /** A sor levele (commerce #479); `null`: nem ment, vagy a levélküldés ki van kapcsolva. */
    notification?: {
      status: "sent" | "failed" | "pending";
      at: string;
      template: string;
      resent: number;
    } | null;
  }[];
}

/** A kártyás fizetés útja (`GET /admin/order-payment/:id`, murena). */
export interface MedusaOrderPayment {
  state: string;
  hold: { authorized_at: string; expires_at: string; amount: number } | null;
  link: {
    sent_at: string;
    expires_at: string;
    reminded_at: string | null;
    amount: number;
    url: string;
  } | null;
  paid_at: string | null;
  /**
   * Amit a link MOST fizettetne (murena L2b): a feloldott zárolás teljes
   * összege, vagy egy utólag hozzáadott tétel különbözete (a zárolás ilyenkor
   * megmarad, és a Kiszállításkor vonódik le). Régebbi webshopnál hiányzik.
   */
  due?: { amount: number; reason: "released" | "difference" } | null;
}

/** Egy változat a cseréhez (`GET /admin/product-variants`). */
export interface MedusaVariantSearchRow {
  id: string;
  title: string | null;
  sku: string | null;
  product?: { title: string | null } | null;
}

/** A státuszlevél sorsa a webshop válaszában (commerce #479). */
export type MedusaStatusNotification =
  { sent: true } | { sent: false; reason: string };

export interface MedusaOrderListResult {
  rows: MedusaOrderRow[];
  /**
   * Igaz, ha a valasz elerte a lekerdezesi hatart, tehat lehet TOBB rendeles is.
   * A hivo ilyenkor szukebb idoablakkal kerdez ujra -- ugyanaz az alak, mint a
   * kategoria- es gyujtemeny-listanal.
   */
  truncated: boolean;
}

/** Egy változat vonalkód-mezői, ahogy a bolt mutatja (SEO P0 PR 4). */
/** Egy változat tömege és méretei a boltban (SEO P0 PR 8): g és mm, vagy `null`. */
export interface MedusaVariantMeasureRow {
  id: string;
  sku: string | null;
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
}

export type MedusaVariantMeasurePatch = Partial<
  Record<"weight" | "length" | "width" | "height", number>
>;

export interface MedusaVariantBarcodeRow {
  id: string;
  sku: string | null;
  ean: string | null;
  upc: string | null;
}

/** Egy átirányítás a bolt oldalán (PR 7a). */
export interface MedusaUrlRedirect {
  source_path: string;
  destination_path: string;
  status: number;
}

export interface MedusaUrlRedirectList {
  count: number;
  hash: string;
  redirects: MedusaUrlRedirect[];
}

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

  /**
   * A BOLT RENDELESEI, NOVEKMENYESEN.
   *
   * A `sinceIso` a legutobb LATOTT rendeles letrehozasi ideje. Ha null, a hivo
   * az elso futasban van, es a hatar szabja meg, mennyit kapunk.
   */
  listOrders(sinceIso: string | null): Promise<MedusaOrderListResult>;
  /**
   * A WEBSHOP RENDELÉSEI A „RENDELÉSEK” OLDALHOZ, lapozva, a legújabb elöl,
   * az üzleti státusszal együtt (a sima `/admin/orders` azt nem hozza).
   */
  orderOverview(page: {
    limit: number;
    offset: number;
  }): Promise<MedusaOrderOverviewPage>;
  /** Egy rendelés részlete; nem létező azonosítóra `null`. */
  order(id: string): Promise<MedusaOrderDetailRow | null>;
  /** A rendelés üzleti státusza a történettel; ha nincs, `null`. */
  orderBusinessStatus(id: string): Promise<MedusaOrderBusinessStatus | null>;
  /** Hány rendelése van a vásárlónak (az „új vásárló” jelhez). */
  countCustomerOrders(customerId: string): Promise<number>;
  /**
   * AZ ÜZLETI STÁTUSZ VÁLTÁSA A WEBSHOPBAN (`POST /admin/order-business-status/:id`).
   * A szabályt és a Kiszállításkori levonást a webshop workflow-ja viszi; a
   * hibája `MedusaAdminHttpError`, a törzsében a webshop mondatával.
   */
  transitionBusinessStatus(
    id: string,
    status: string,
    notifyCustomer?: boolean,
  ): Promise<MedusaStatusNotification>;
  /**
   * A LEGUTÓBBI státuszlevél újraküldése (`POST .../resend-notification`,
   * commerce #479), új kulccsal.
   */
  resendStatusNotification(id: string): Promise<MedusaStatusNotification>;
  /**
   * A RENDELÉS SZERKESZTÉSE a Medusa saját útján (`/admin/order-edits`, a
   * `:id` a RENDELÉS azonosítója): megnyitás, tétel-mennyiség (0 = törlés),
   * új tétel, kérés, megerősítés, és visszavonás. A megerősítés előtt a
   * commerce őre áll (#482: a kártyás zárolás megmarad).
   */
  beginOrderEdit(orderId: string, description: string): Promise<void>;
  setOrderEditItemQuantity(
    orderId: string,
    itemId: string,
    quantity: number,
  ): Promise<void>;
  addOrderEditItem(
    orderId: string,
    variantId: string,
    quantity: number,
  ): Promise<void>;
  requestOrderEdit(orderId: string): Promise<void>;
  confirmOrderEdit(orderId: string): Promise<void>;
  cancelOrderEdit(orderId: string): Promise<void>;
  /**
   * A KÁRTYÁS FIZETÉS ÚTJA (murena, lejáró zárolás): az állapot (`null`, ha a
   * rendelésnek nincs ilyen útja), a zárolás feloldása („Csúszik a
   * szállítás”) és a fizetési link küldése.
   */
  orderPayment(orderId: string): Promise<MedusaOrderPayment | null>;
  /** Megjött az előre utalás: a webshop levont fizetéssé teszi (commerce #509). */
  recordTransferReceipt(
    orderId: string,
    receipt: { reference: string; received_at: string; amount: number },
  ): Promise<{ recorded: boolean; payment_id: string }>;
  releaseHold(
    orderId: string,
    notifyCustomer: boolean,
  ): Promise<MedusaStatusNotification>;
  sendPaymentLink(
    orderId: string,
    notifyCustomer: boolean,
  ): Promise<MedusaStatusNotification>;
  /**
   * A rendelés címének frissítése a webshop beépített útján
   * (`POST /admin/orders/:id`, `billing_address` vagy `shipping_address`).
   */
  updateOrderAddress(
    orderId: string,
    kind: "billing" | "shipping",
    address: MedusaOrderAddressRow,
  ): Promise<void>;
  /**
   * A rendelés módjához választható csomagpontok (commerce #494). A fuvarozót
   * és a nehézáru-szabályt a rendelés dönti el, nem a hívó. 503: a fuvarozó
   * listája most nem érhető el.
   */
  orderPickupPoints(
    orderId: string,
    query: string,
    limit: number,
    /** A cél mód pontjai (a mód cseréjéhez); nélküle a rendelés mostani módjáé. */
    optionId?: string,
  ): Promise<MedusaOrderPointSearch>;
  /** A rendelés választható futáros módjai az új díjjal (commerce, murena 26640). */
  orderShippingOptions(orderId: string): Promise<MedusaOrderShippingOptions>;
  /** A szállítási mód cseréje, pontos módnál a ponttal együtt, egy lépésben. */
  changeOrderShippingMethod(
    orderId: string,
    input: {
      shipping_option_id: string;
      point_id?: string;
      source?: "finder" | "fallback";
      actor?: string;
    },
  ): Promise<MedusaOrderMethodChange>;
  /** A csomagpont cseréje (commerce #494); `actor` az előzménybe kerül. */
  changeOrderPickupPoint(
    orderId: string,
    input: { point_id: string; source?: "finder" | "fallback"; actor?: string },
  ): Promise<MedusaOrderPointChange>;
  /** A vevő és a szállító megjegyzése (commerce #493); a hiányzó kulcs nem változik. */
  updateOrderNotes(
    orderId: string,
    input: { customer_note?: string | null; carrier_note?: string | null },
  ): Promise<MedusaOrderNotes>;
  /**
   * A kijelölt tételek új, kapcsolt rendelésbe (commerce, murena 26630).
   * A `request_id` KÖTELEZŐ (murena 26634): a bontás a webshopban két
   * lépés, és ugyanazzal az azonosítóval az újraküldés a már létrejött
   * rendelést adja vagy a félbemaradt bontást fejezi be.
   */
  splitOrder(
    orderId: string,
    input: {
      lines: { item_id: string; quantity: number }[];
      actor?: string;
      request_id: string;
    },
  ): Promise<MedusaOrderSplit>;
  /** Termékváltozat keresése név vagy cikkszám szerint (a tétel cseréjéhez). */
  searchVariants(query: string): Promise<MedusaVariantSearchRow[]>;
  /**
   * A „FELADTUK A CSOMAGODAT” LEVÉL (`POST /admin/order-shipping-notice/:id`,
   * commerce #477). A webshop küldi, rendelés és csomagszám párra egyszer
   * (idempotens). Alszolgáltatói (`STUB-`) csomagszám NEM mehet ide: a webshop
   * nem szűri, a vevő levélben kapná.
   */
  sendShippingNotice(
    id: string,
    notice: MedusaShippingNotice,
  ): Promise<MedusaShippingNoticeResult>;
  /**
   * THE WEBSHOP'S STUCK MAILS (`GET /admin/webshop-mail/outbox?stuck=true`,
   * commerce W2): mails the webshop could not send, newest first.
   */
  stuckMails(page: {
    limit: number;
    offset: number;
  }): Promise<WebshopStuckMailList>;
  /**
   * One stuck mail back in the queue (`POST /admin/webshop-mail/outbox/:id/retry`):
   * the webshop's job sends it within two minutes. 404: no such mail; 409:
   * it has gone out already.
   */
  retryStuckMail(id: string): Promise<WebshopStuckMail>;
  /** Egy kategoria letrehozasa. A valaszban jon a Medusa-azonosito. */
  createProductCategory(input: MedusaCategoryInput): Promise<MedusaCategoryRow>;
  /**
   * EGY MAR LETEZO kategoria frissitese. A NEV ES A WEBCIM EGY KERESBEN megy.
   *
   * MIERT NEM KET HIVAS: ket keres kozott van egy pillanat, amikor az egyik
   * mezo mar atallt, a masik nem -- es epp az az allapot a baj, amit ez az ut
   * megszuntetni hivatott (rovid webcim hosszu nev mellett). Ugyanez az indok
   * all a termek-vetites statusz plusz csatorna paranal.
   */
  updateProductCategory(
    id: string,
    patch: MedusaCategoryPatch,
  ): Promise<MedusaCategoryRow>;
  /**
   * A GYUJTEMENYEK LISTAJA. NALUNK EZ A MARKA.
   *
   * Az utvonal `/admin/collections`, nem `/admin/product-collections` -- a
   * modell neve `ProductCollection`, tehat a ket vegpont NEM egy mintat kovet.
   * A reszletek a megvalositas mellett allnak.
   */
  listProductCollections(): Promise<MedusaCollectionListResult>;
  /** Egy gyujtemeny letrehozasa. EZ IR A BOLTI OLDALRA. */
  createProductCollection(
    input: MedusaCollectionInput,
  ): Promise<MedusaCollectionRow>;
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
   * A CEL OLDALI METAADAT, KIZAROLAG OLVASASRA.
   *
   * AMIERT KELL: a `metadata` mezo a cel oldalon CSERE-szemantikaju, tehat egy
   * kikuldott objektum mindent felulir. Osszefesulni pedig csak abbol lehet,
   * amit elobb LEKERDEZTUNK -- es a vetites eddig soha nem kerdezte le.
   * Az osszefesules szabalya a `medusa-metadata-merge.ts` modulban all.
   *
   * A `fields` szukites szandekos: egy termek teljes valasza sokszorosa ennek,
   * es ebbol a hivasbol termekenkent EGY megy el minden futasban.
   */
  fetchMetadata(id: string): Promise<Record<string, unknown> | null>;
  /**
   * A TERMEK SZALLITASI ZASZLOI A BOLT OLDALAN, OLVASASRA.
   *
   * A vegpont akkor is valaszol, ha a termeknek MEG NINCS rekordja: olyankor a
   * csupa-hamis alapertelmezest adja vissza. Ez azert szamit, mert a hivo a
   * KULONBSEGET irja ki ("mar igy allt" kontra "most allitottuk be"), es ahhoz
   * kell egy kiindulasi allapot.
   */
  /** A bolt EGYETLEN alapértelmezett szállítási profilja, vagy `null`. */
  defaultShippingProfileId(): Promise<string | null>;
  /** Egy lap termék a szállítási profiljukkal. */
  listProductShippingProfiles(
    offset: number,
    limit: number,
  ): Promise<{
    products: { id: string; shipping_profile?: { id: string } | null }[];
    count: number;
  }>;
  productShippingProfileId(productId: string): Promise<string | null>;
  /** Egy lap termék a handle-jével (SEO P0 PR 7d, a handle-átkapcsolás terve). */
  listProductHandles(
    offset: number,
    limit: number,
  ): Promise<{ products: { id: string; handle: string }[]; count: number }>;
  /**
   * CSAK A HANDLE írása egy terméken (PR 7d). Külön hívás, mert az `update` a
   * teljes vetítési alakot várja (cím, leírás), és az átkapcsolás a többi mezőhöz
   * nem nyúlhat. EZ IR A BOLTI OLDALRA.
   */
  setProductHandle(id: string, handle: string): Promise<void>;
  /** Egy lap termék a változatai SKU-jával: a kötés-sor nélküli párosításhoz. */
  listProductSkus(
    offset: number,
    limit: number,
  ): Promise<{
    products: {
      id: string;
      external_id?: string | null;
      variants?: { sku: string | null }[] | null;
    }[];
    count: number;
  }>;
  /** A termék kötése egy szállítási profilhoz. EZ IR A BOLTI OLDALRA. */
  setProductShippingProfile(
    productId: string,
    shippingProfileId: string,
  ): Promise<void>;
  fetchShippingAttributes(
    productId: string,
  ): Promise<MedusaShippingAttributeRow>;
  /** A negy zaszlo kikuldese. EZ IR A BOLTI OLDALRA. */
  setShippingAttributes(
    productId: string,
    flags: MedusaShippingFlags,
  ): Promise<MedusaShippingAttributeRow>;
  /**
   * A TERMEKISMERET A BOLT OLDALAN, OLVASASRA (#1431, a PR A / PR B
   * szerzodese: `GET /admin/product-knowledge/:product_id`).
   *
   * `null`, ha a boltnak nincs rekordja (404): az "nincs ismeret", nem hiba.
   * Minden mas hiba tovabb szall, mert egy lejart kulcs nem azt jelenti, hogy
   * a termekrol nincs mit tudni.
   */
  fetchProductKnowledge(productId: string): Promise<KnowledgeProjection | null>;
  /**
   * A TELJES CSERE egy termekre (`PUT`): ami nincs a torzsben, az eltunik.
   * Ures `facts` es `copy` torli a rekordot. EZ IR A BOLTI OLDALRA.
   */
  setProductKnowledge(
    productId: string,
    knowledge: KnowledgeProjection,
  ): Promise<KnowledgeProjection>;
  /**
   * A BOLT ÁTIRÁNYÍTÁS-LISTÁJA (SEO P0 PR 7b; a commerce PR 7a szerződése:
   * `GET /admin/url-redirects`). A `hash` a rendezett lista ujjlenyomata: az OS
   * ugyanígy számolja, és csak eltérésnél küld.
   */
  fetchUrlRedirects(): Promise<MedusaUrlRedirectList>;
  /**
   * A TELJES LISTA CSERÉJE (`PUT`): ami nincs a törzsben, az eltűnik. EZ IR A
   * BOLTI OLDALRA.
   */
  replaceUrlRedirects(
    redirects: MedusaUrlRedirect[],
  ): Promise<MedusaUrlRedirectList>;
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
   * A változatok vonalkód-mezői (SEO P0 PR 4): a frissítés-ág ebből látja, mi áll
   * ma a boltban, és csak az eltérőt írja. A töröltek nélkül: egy eltemetett
   * változatra nem írunk.
   */
  listVariantBarcodes(productId: string): Promise<MedusaVariantBarcodeRow[]>;
  /**
   * Egy változat `ean`/`upc` mezője. Csak a megadott kulcs íródik; a `null`
   * üríti (a Medusa 2.20.1 validátora `nullish`-t enged, mérve a telepített
   * `admin/products/validators.js`-ben).
   */
  updateVariantBarcode(
    productId: string,
    variantId: string,
    patch: { ean?: string | null; upc?: string | null },
  ): Promise<void>;
  /** A termék változatai a tömegükkel és méreteikkel (SEO P0 PR 8). */
  listVariantMeasures(productId: string): Promise<MedusaVariantMeasureRow[]>;
  /**
   * Egy változat tömege és méretei. Csak a megadott kulcs íródik; ürítés nincs
   * (a vetítés a Medusa értékét nem törli, ha nincs VERIFIED tény). EZ IR A
   * BOLTI OLDALRA.
   */
  updateVariantMeasures(
    productId: string,
    variantId: string,
    patch: MedusaVariantMeasurePatch,
  ): Promise<void>;
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
  ): Promise<void>; /**
   * EGY FAJL FELTOLTESE A BOLT SAJAT TAROLOJABA.
   *
   * A valaszban a Medusa fajl-KULCSA es a nyilvanos URL-je jon vissza. A
   * kettot EGYUTT kell megorizni: a kulcs az azonossag, az URL pedig az, ami
   * a termek kep-mezojebe kerul, es a ketto kozott nincs kiszamithato
   * kapcsolat (a local provider a backend cimebol epiti, az S3 a bucket
   * cimebol).
   *
   * A FELTOLTES NEM IDEMPOTENS, ES EZ MERT TENY, NEM OVATOSSAG. Mindket
   * telepitett provider MAGA general kulcsot, es mindig egyedive teszi:
   *
   *   file-local   `${Date.now()}-${eredeti fajlnev}`
   *   file-s3      `${nev}-${ulid()}${kiterjesztes}`
   *
   * Ugyanaz a fajl ketszer feltoltve KET kulonbozo kulcsot es KET kulonbozo
   * URL-t kap. Es a Medusa oldalan nem is lehet megkerdezni, hogy egy fajl mar
   * fent van-e: a file modul `listFiles` metodusa azonosito nelkul HIBAT DOB
   * ("Listing of files is only supported when filtering by ID"), tehat nev
   * szerinti kereses nincs.
   *
   * EBBOL KOVETKEZIK A HIVO KOTELEZETTSEGE: aki ezt hivja, tartson
   * nyilvantartast arrol, mit toltott mar fel. Enelkul minden futas
   * megdupllazza a fajlokat a boltban, es atirja a termek kep-URL-jeit.
   *
   * AZ `access` A VEGPONTON BEEGETVE "public" -- a bolti kepek nyilvanosak, es
   * ez szandek, nem melleklet. Privat fajlt ezen az uton nem lehet feltolteni.
   */
  uploadFile(file: MedusaFileUpload): Promise<MedusaUploadedFile>;
}

/** Egy feltoltendo fajl: a tartalom, a neve es a tipusa. */
export interface MedusaFileUpload {
  /**
   * A fajl NEVE, ahogy a bolt taroloja latni fogja.
   *
   * A Medusa a kulcsot ebbol epiti, de nem ezt hasznalja: egyedive teszi (a
   * local provider ido-belyeget tesz ele, az S3 egy ulid-ot fuz a nevhez).
   * Vagyis a nev a felismerhetoseget szolgalja, nem az azonossagot.
   */
  filename: string;
  /** A fajl tartalma. */
  content: Buffer;
  /** A tartalom tipusa (peldaul `image/jpeg`). */
  contentType: string;
}

/** Amit a bolt visszaad egy sikeres feltoltes utan. */
export interface MedusaUploadedFile {
  /**
   * A fajl KULCSA a bolt taroloján. Ez az azonossag, es ezt kell megorizni.
   */
  id: string;
  /** A nyilvanos URL, ami a termek kep-mezojebe kerul. */
  url: string;
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
/**
 * A MEZŐ NEVE ÁTMEGY, A VÁLASZ TÖBBI RÉSZE NEM.
 *
 * === MIÉRT KELLETT, ÉS MI VOLT AZ ÁRA A HIÁNYÁNAK ===
 *
 * Mérve 2026-09-04: huszonegy cikkszámból tizenkilenc elakadt a vetítésen,
 * mindegyik `HTTP 400`-zal, és a naplóban ennyi állt róla: „a Medusa HTTP 400
 * választ adott". Az OK sehol. A cél oldali állapot ép, a futás ismételhető --
 * de senki nem tudta megmondani, MIT kell javítani, és két termék ugyanabból a
 * családból (ugyanaz az ár, egység, készlet, kategória, csak a szín más)
 * ellentétesen viselkedett.
 *
 * === MEGENGEDŐ LISTA, NEM TILTÓ, ÉS EZ A LÉNYEG ===
 *
 * NEM azt soroljuk fel, mit dobunk el, hanem azt, mit engedünk át. A minta
 * kizárólag a MEZŐ-ÚTVONALAT emeli ki, és annak a karakterkészletét is
 * megköti: betű, szám, pont, kötőjel, aláhúzás, vessző és szóköz. Ami ezen
 * kívül esik -- idézőjel, kapcsos zárójel, egyenlőségjel --, az NEM illeszkedik,
 * tehát a válasz semmilyen más része nem tud átcsúszni.
 *
 * Egy tiltólistás alak itt CSENDBEN engedne át valamit egy új Medusa-verzió új
 * hibaalakjánál. A megengedő alak ilyenkor csak annyit mond, hogy nem ismerte
 * fel -- és az HANGOS.
 *
 * === AMIT EZ NEM AD FEL ===
 *
 * A fenti védelem áll: a válasz TÖRZSE továbbra sem kerül a kimenetre. Amit
 * átengedünk, az egy mező-ÚTVONAL (`variants, 0, prices`), nem érték. Titok
 * ilyen alakban nem tud megjelenni: a hossz százhúsz karakterben van fogva, és
 * a karakterkészlet nem enged idézőjelet vagy zárójelet, amivel egy
 * visszhangzott érték jönne.
 *
 * === HA NEM ILLESZKEDIK, A MAI VISELKEDÉS MARAD ===
 *
 * Nem próbálunk „valamit" kiírni. A státuszkód önmagában kevés, de IGAZ; egy
 * félig felismert szöveg viszont félrevezetne.
 */
const MEDUSA_MEZO_MINTA = /Field '([A-Za-z0-9_.\-]+(?:, ?[A-Za-z0-9_.\-]+)*)'/;

/**
 * A MÁSODIK FELISMERT ALAK: A NEVESÍTETT MEZŐ-ELUTASÍTÁS.
 *
 * A Medusa nem minden érvényesítési hibát ír `Field '...'` alakban. A termék
 * `handle` mezőjének saját ellenőrzése van, saját üzenettel (mérve a telepített
 * 2.19.0 forrásán, `product-module-service.js`):
 *
 *     Invalid product handle '<érték>'. It must contain URL safe characters
 *
 * A `Field '...'` minta erre NEM illeszkedik, tehát eddig ez a hiba csak a
 * státuszkóddal jelent meg -- épp az a hibaosztály, ami a migrációt ma
 * megállítja.
 *
 * === A MEZŐNÉV ÁLLANDÓ, NEM A VÁLASZBÓL JÖN ===
 *
 * Ez a lista az ALAKOT ismeri fel, és a mezőnevet MAGA ADJA. Az üzenetben ott
 * álló `<érték>` -- a konkrét cím -- soha nem kerül a kimenetre, és nem is
 * kiszűrjük: egyszerűen nem is olvassuk ki. Egy kiemelés-plusz-szűrés alak
 * ugyanezt ígérné, de akkor a védelem egy mintán múlna; így szerkezetileg nem
 * tud átcsúszni semmi.
 *
 * A cím a MI adatunk, nem titok -- de a szabály nem attól jó, hogy ma ismerjük
 * a tartalmat (acrobot, 2026-09-04).
 *
 * === CSAK AMIT MÉRTÜNK ===
 *
 * Egyetlen alak áll benne, mert egyet mértem le. A kategória és a gyűjtemény
 * handle-je más úton megy, és amíg azt nem néztük meg, ide sem kerül. Egy
 * "biztos ez is olyan" bejegyzés pontosan az a fajta bővítés, ami ellen a
 * megengedő lista szól.
 */
const MEDUSA_NEVESITETT_MEZOK: { minta: RegExp; mezo: string }[] = [
  { minta: /Invalid product handle '/, mezo: "handle" },
];

/** A mező a Medusa hibaválaszából, ha felismerhető alakban áll ott. */
export function medusaFailureField(body: string): string | null {
  const talalat = MEDUSA_MEZO_MINTA.exec(body);
  const mezo = talalat?.[1];
  if (mezo && mezo.length <= 120) return mezo;

  for (const alak of MEDUSA_NEVESITETT_MEZOK)
    if (alak.minta.test(body)) return alak.mezo;

  return null;
}

export function describeMedusaFailure(error: unknown): string {
  if (error instanceof MedusaAdminHttpError) {
    const mezo = medusaFailureField(error.body);
    return mezo
      ? `a Medusa HTTP ${error.status} választ adott (a hibás mező: ${mezo})`
      : `a Medusa HTTP ${error.status} választ adott`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** A rendelés-részlet mezői (`order`); a fizetés `data`-ja csak szerveren marad. */
export const ORDER_DETAIL_FIELDS = [
  "id",
  "display_id",
  "created_at",
  "email",
  "currency_code",
  "customer_id",
  "metadata",
  "total",
  "subtotal",
  "discount_total",
  "shipping_total",
  "shipping_address.*",
  "billing_address.*",
  "items.id",
  "items.title",
  "items.product_title",
  "items.variant_title",
  "items.variant_sku",
  "items.quantity",
  "items.unit_price",
  "items.total",
  "items.metadata",
  "items.tax_lines.rate",
  "shipping_methods.name",
  "shipping_methods.data",
  "shipping_methods.total",
  "shipping_methods.amount",
  "shipping_methods.is_tax_inclusive",
  "shipping_methods.tax_lines.rate",
  "payment_collections.status",
  "payment_collections.amount",
  "payment_collections.authorized_amount",
  "payment_collections.captured_amount",
  "payment_collections.refunded_amount",
  "payment_collections.payments.id",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.data",
  // a függő fizetésnek (utánvét, előre utalás) nincs rekordja, csak munkamenete
  "payment_collections.payment_sessions.provider_id",
  "payment_collections.payment_sessions.status",
].join(",");

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

  /**
   * A HITELESITO FEJLEC ONALLOAN, mert nem minden keres kuld JSON-t.
   *
   * A feltoltes multipart torzzsel megy, es ott a `content-type` fejlecet a
   * `FormData`-ra kell hagyni. Egy `Record<string, string>` indexelese
   * `string | undefined` erteket ad (a repo `noUncheckedIndexedAccess`
   * beallitasa miatt), tehat a kiemeles nem kenyelem: enelkul egy esetleg
   * hianyzo fejlec csendben `undefined` ertekkel menne ki.
   */
  private authorization(): string {
    // A kulcs a Basic séma FELHASZNÁLÓNEVE, jelszó nélkül, ezért a záró
    // kettőspont - így írja le a Medusa saját olvasása is.
    const encoded = Buffer.from(`${this.config.apiKey}:`).toString("base64");
    return `Basic ${encoded}`;
  }

  private headers(): Record<string, string> {
    return {
      authorization: this.authorization(),
      "content-type": "application/json",
    };
  }

  /**
   * A FEJLÉCEK KIS- ÉS NAGYBETŰ NÉLKÜL OLVADNAK ÖSSZE. Egy sima objektumban a
   * `content-type` és a `Content-Type` két kulcs, és a fetch a kettőt
   * „application/json, application/json” értékké fűzi; ezt a Medusa
   * JSON-olvasója nem ismeri fel, és a törzset üresnek veszi (stage,
   * 2026-10-05: az OS státuszváltása „Field 'status' is required” választ
   * kapott, miközben a törzs ott volt). A `Headers` kisbetűsít, a hívó értéke
   * így felülírja az alapot, nem mellé kerül.
   */
  private requestHeaders(extra?: HeadersInit): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers() };
    new Headers(extra).forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: this.requestHeaders(init?.headers),
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

  async listOrders(sinceIso: string | null): Promise<MedusaOrderListResult> {
    const params = new URLSearchParams({
      fields:
        "id,display_id,status,email,currency_code,total,created_at,updated_at,sales_channel_id",
      limit: String(ORDER_LIST_LIMIT),
      order: "created_at",
    });
    /**
     * A SZIGORU NAGYOBB (`$gt`) SZANDEKOS, ES NEM UGYANAZ, MINT A `$gte`.
     *
     * A hivo a legutobb MAR ATVETT rendeles idejet adja at. A `$gte` ugyanazt a
     * rendelest minden korben visszahozna, tehat minden futas ujra feldolgozna
     * legalabb egyet. Az atvetel ettol meg nem romlana el (az azonositora
     * idempotens), de minden kor vegezne felesleges munkat, orokre.
     *
     * A cserebe vallalt kockazat KIMONDVA: ha ket rendeles letrehozasi ideje
     * BETURE azonos, es a hatar pont koztuk vagja el a lapot, a masodik
     * kimaradhat. Ezert a `truncated` jelzes nem diszites: ha igaz, a hivo
     * ugyanazzal az idobelyeggel kerdez ujra, es a lap masodik feleert megy
     * vissza. Az `order` parameter ezert kotelezo -- rendezes nelkul a
     * "lap masodik fele" mondatnak nincs ertelme.
     */
    if (sinceIso) params.set("created_at[$gt]", sinceIso);

    const body = await this.request<{ orders: MedusaOrderRow[] }>(
      `/admin/orders?${params.toString()}`,
    );
    const rows = body.orders ?? [];
    return { rows, truncated: rows.length >= ORDER_LIST_LIMIT };
  }

  async orderOverview(page: {
    limit: number;
    offset: number;
  }): Promise<MedusaOrderOverviewPage> {
    const params = new URLSearchParams({
      limit: String(page.limit),
      offset: String(page.offset),
    });
    return this.request<MedusaOrderOverviewPage>(
      `/admin/order-overview?${params.toString()}`,
    );
  }

  async order(id: string): Promise<MedusaOrderDetailRow | null> {
    const params = new URLSearchParams({ fields: ORDER_DETAIL_FIELDS });
    try {
      const body = await this.request<{ order: MedusaOrderDetailRow }>(
        `/admin/orders/${encodeURIComponent(id)}?${params.toString()}`,
      );
      return body.order ?? null;
    } catch (error) {
      if (error instanceof MedusaAdminHttpError && error.status === 404)
        return null;
      throw error;
    }
  }

  async orderBusinessStatus(
    id: string,
  ): Promise<MedusaOrderBusinessStatus | null> {
    try {
      const body = await this.request<{
        business_status: MedusaOrderBusinessStatus;
      }>(`/admin/order-business-status/${encodeURIComponent(id)}`);
      return body.business_status ?? null;
    } catch (error) {
      if (error instanceof MedusaAdminHttpError && error.status === 404)
        return null;
      throw error;
    }
  }

  async transitionBusinessStatus(
    id: string,
    status: string,
    notifyCustomer = true,
  ): Promise<MedusaStatusNotification> {
    const body = await this.request<{
      notification?: MedusaStatusNotification;
    }>(`/admin/order-business-status/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ status, notify_customer: notifyCustomer }),
    });
    return body.notification ?? { sent: false, reason: "unknown" };
  }

  async beginOrderEdit(orderId: string, description: string): Promise<void> {
    await this.request<unknown>("/admin/order-edits", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId, description }),
    });
  }

  async setOrderEditItemQuantity(
    orderId: string,
    itemId: string,
    quantity: number,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/order-edits/${encodeURIComponent(orderId)}/items/item/${encodeURIComponent(itemId)}`,
      { method: "POST", body: JSON.stringify({ quantity }) },
    );
  }

  async addOrderEditItem(
    orderId: string,
    variantId: string,
    quantity: number,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/order-edits/${encodeURIComponent(orderId)}/items`,
      {
        method: "POST",
        body: JSON.stringify({ items: [{ variant_id: variantId, quantity }] }),
      },
    );
  }

  async requestOrderEdit(orderId: string): Promise<void> {
    await this.request<unknown>(
      `/admin/order-edits/${encodeURIComponent(orderId)}/request`,
      { method: "POST", body: JSON.stringify({}) },
    );
  }

  async confirmOrderEdit(orderId: string): Promise<void> {
    await this.request<unknown>(
      `/admin/order-edits/${encodeURIComponent(orderId)}/confirm`,
      { method: "POST", body: JSON.stringify({}) },
    );
  }

  async cancelOrderEdit(orderId: string): Promise<void> {
    await this.request<unknown>(
      `/admin/order-edits/${encodeURIComponent(orderId)}`,
      { method: "DELETE" },
    );
  }

  async orderPayment(orderId: string): Promise<MedusaOrderPayment | null> {
    try {
      return await this.request<MedusaOrderPayment>(
        `/admin/order-payment/${encodeURIComponent(orderId)}`,
      );
    } catch (error) {
      if (error instanceof MedusaAdminHttpError && error.status === 404)
        return null;
      throw error;
    }
  }

  async releaseHold(
    orderId: string,
    notifyCustomer: boolean,
  ): Promise<MedusaStatusNotification> {
    const body = await this.request<{
      notification?: MedusaStatusNotification;
    }>(`/admin/order-payment/${encodeURIComponent(orderId)}/release-hold`, {
      method: "POST",
      body: JSON.stringify({ notify_customer: notifyCustomer }),
    });
    return body.notification ?? { sent: false, reason: "unknown" };
  }

  /**
   * MEGJÖTT AZ ELŐRE UTALÁS (commerce #509, kártya bb3a6bd5): a webshop a
   * rendelés előre utalásos munkamenetét levont fizetéssé teszi. A második
   * hívás nem ír, csak megmondja (`recorded: false`). Eltérő összegre, nem
   * előre utalásos vagy nem váró rendelésre 409, magyar mondattal.
   */
  async recordTransferReceipt(
    orderId: string,
    receipt: { reference: string; received_at: string; amount: number },
  ): Promise<{ recorded: boolean; payment_id: string }> {
    return this.request(
      `/admin/order-payment/${encodeURIComponent(orderId)}/transfer-receipt`,
      { method: "POST", body: JSON.stringify(receipt) },
    );
  }

  async sendPaymentLink(
    orderId: string,
    notifyCustomer: boolean,
  ): Promise<MedusaStatusNotification> {
    const body = await this.request<{
      notification?: MedusaStatusNotification;
    }>(`/admin/order-payment/${encodeURIComponent(orderId)}/payment-link`, {
      method: "POST",
      body: JSON.stringify({ notify_customer: notifyCustomer }),
    });
    return body.notification ?? { sent: false, reason: "unknown" };
  }

  async updateOrderAddress(
    orderId: string,
    kind: "billing" | "shipping",
    address: MedusaOrderAddressRow,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/orders/${encodeURIComponent(orderId)}`,
      {
        method: "POST",
        body: JSON.stringify({ [`${kind}_address`]: address }),
      },
    );
  }

  async orderPickupPoints(
    orderId: string,
    query: string,
    limit: number,
    optionId?: string,
  ): Promise<MedusaOrderPointSearch> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (optionId) params.set("option_id", optionId);
    return this.request<MedusaOrderPointSearch>(
      `/admin/order-shipping/${encodeURIComponent(orderId)}/points?${params.toString()}`,
    );
  }

  async orderShippingOptions(
    orderId: string,
  ): Promise<MedusaOrderShippingOptions> {
    return this.request<MedusaOrderShippingOptions>(
      `/admin/order-shipping/${encodeURIComponent(orderId)}/options`,
    );
  }

  async changeOrderShippingMethod(
    orderId: string,
    input: {
      shipping_option_id: string;
      point_id?: string;
      source?: "finder" | "fallback";
      actor?: string;
    },
  ): Promise<MedusaOrderMethodChange> {
    return this.request<MedusaOrderMethodChange>(
      `/admin/order-shipping/${encodeURIComponent(orderId)}/method`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  async changeOrderPickupPoint(
    orderId: string,
    input: { point_id: string; source?: "finder" | "fallback"; actor?: string },
  ): Promise<MedusaOrderPointChange> {
    return this.request<MedusaOrderPointChange>(
      `/admin/order-shipping/${encodeURIComponent(orderId)}/point`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  async splitOrder(
    orderId: string,
    input: {
      lines: { item_id: string; quantity: number }[];
      actor?: string;
      request_id: string;
    },
  ): Promise<MedusaOrderSplit> {
    return this.request<MedusaOrderSplit>(
      `/admin/order-split/${encodeURIComponent(orderId)}`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  async updateOrderNotes(
    orderId: string,
    input: { customer_note?: string | null; carrier_note?: string | null },
  ): Promise<MedusaOrderNotes> {
    return this.request<MedusaOrderNotes>(
      `/admin/order-notes/${encodeURIComponent(orderId)}`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  async searchVariants(query: string): Promise<MedusaVariantSearchRow[]> {
    const params = new URLSearchParams({
      q: query,
      fields: "id,title,sku,product.title",
      limit: "20",
    });
    const body = await this.request<{ variants?: MedusaVariantSearchRow[] }>(
      `/admin/product-variants?${params.toString()}`,
    );
    return body.variants ?? [];
  }

  async resendStatusNotification(
    id: string,
  ): Promise<MedusaStatusNotification> {
    const body = await this.request<{
      notification?: MedusaStatusNotification;
    }>(
      `/admin/order-business-status/${encodeURIComponent(id)}/resend-notification`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return body.notification ?? { sent: false, reason: "unknown" };
  }

  async sendShippingNotice(
    id: string,
    notice: MedusaShippingNotice,
  ): Promise<MedusaShippingNoticeResult> {
    return this.request<MedusaShippingNoticeResult>(
      `/admin/order-shipping-notice/${encodeURIComponent(id)}`,
      {
        method: "POST",
        body: JSON.stringify(notice),
      },
    );
  }

  async stuckMails(page: {
    limit: number;
    offset: number;
  }): Promise<WebshopStuckMailList> {
    const params = new URLSearchParams({
      stuck: "true",
      limit: String(page.limit),
      offset: String(page.offset),
    });
    return this.request<WebshopStuckMailList>(
      `/admin/webshop-mail/outbox?${params.toString()}`,
    );
  }

  async retryStuckMail(id: string): Promise<WebshopStuckMail> {
    return this.request<WebshopStuckMail>(
      `/admin/webshop-mail/outbox/${encodeURIComponent(id)}/retry`,
      { method: "POST", body: JSON.stringify({}) },
    );
  }

  async countCustomerOrders(customerId: string): Promise<number> {
    const params = new URLSearchParams({
      customer_id: customerId,
      fields: "id",
      limit: "1",
    });
    const body = await this.request<{ count?: number }>(
      `/admin/orders?${params.toString()}`,
    );
    return body.count ?? 0;
  }

  async listProductCategories(): Promise<MedusaCategoryListResult> {
    const params = new URLSearchParams({
      fields: "id,name,external_id,parent_category_id,is_active,handle",
      limit: String(CATEGORY_LIST_LIMIT),
    });
    const body = await this.request<{
      product_categories: MedusaCategoryRow[];
    }>(`/admin/product-categories?${params.toString()}`);
    const rows = body.product_categories ?? [];
    return { rows, truncated: rows.length >= CATEGORY_LIST_LIMIT };
  }

  /**
   * A GYUJTEMENYEK LISTAJA.
   *
   * AZ UTVONAL NEM AZ, AMIT A MODELL NEVE SUGALL, es ez merve van a telepitett
   * 2.19.0 forrasabol: a modell `ProductCollection`, a vegpont viszont
   * `/admin/collections` -- mikozben a kategoriae `/admin/product-categories`.
   * A ket vegpont NEM egy mintat kovet, tehat a nev alapjan tippelni hiba lenne.
   *
   * A valasz kulcsa ugyanebbol a forrasbol: `{ collections, count, offset, limit }`.
   */
  async listProductCollections(): Promise<MedusaCollectionListResult> {
    const params = new URLSearchParams({
      fields: "id,title,handle,external_id",
      limit: String(COLLECTION_LIST_LIMIT),
    });
    const body = await this.request<{
      collections: MedusaCollectionRow[];
    }>(`/admin/collections?${params.toString()}`);
    const rows = body.collections ?? [];
    return { rows, truncated: rows.length >= COLLECTION_LIST_LIMIT };
  }

  /**
   * EGY GYUJTEMENY LETREHOZASA. EZ IR A BOLTI OLDALRA.
   *
   * A valasz kulcsa `collection` (nem tobbes szam), es a statusz 200, nem 201 --
   * merve a telepitett 2.19.0 utvonalabol. A `request` a nem-2xx valaszt ugyis
   * kivetelle alakitja, tehat a statusz szama itt nem dont; azert all itt, mert
   * a 201-re iras hibas feltevés lenne, ha valaha valaki ellenorizni akarna.
   */
  async createProductCollection(
    input: MedusaCollectionInput,
  ): Promise<MedusaCollectionRow> {
    const body = await this.request<{ collection: MedusaCollectionRow }>(
      "/admin/collections",
      { method: "POST", body: JSON.stringify(input) },
    );
    return body.collection;
  }

  /**
   * CSAK A WEBCIMET IRJA AT. Kulon tipus, nem a letrehozo `Partial`-ja: a
   * frissites SZANDEKOSAN nem nyul a nevhez, a szulohoz es az aktiv jelolohoz.
   *
   * MERVE a telepitett 2.19.0 forrasabol, es ez a muvelet ezen all: az
   * `UpdateProductCategory` sema elfogadja a `handle` mezot, es a modul
   * frissitesi utja NEM szarmaztat belole ujat -- a `kebabCase` harom helyen
   * all (`createProductCategories`, az upsert LETREHOZO aga, es a gyujtemeny),
   * egyik sem a frissitesen. Vagyis amit itt kuldunk, azt tarolja el.
   */
  async updateProductCategory(
    id: string,
    patch: MedusaCategoryPatch,
  ): Promise<MedusaCategoryRow> {
    const body = await this.request<{ product_category: MedusaCategoryRow }>(
      `/admin/product-categories/${encodeURIComponent(id)}`,
      { method: "POST", body: JSON.stringify(patch) },
    );
    return body.product_category;
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

  /**
   * A BOLT ALAPÉRTELMEZETT SZÁLLÍTÁSI PROFILJA (kártya 2a7f2313). A commerce
   * seedje az ÖSSZES szállítási módot erre az egyre teszi
   * (`initial-data-seed.ts`), és a Medusa csak olyan terméket enged
   * megrendelni, amelyik profilhoz kötött. `null`, ha nem pontosan egy van:
   * akkor a hívó nem választ.
   */
  async defaultShippingProfileId(): Promise<string | null> {
    const body = await this.request<{
      shipping_profiles: { id: string; type: string }[];
    }>("/admin/shipping-profiles?limit=50");
    const defaults = body.shipping_profiles.filter((p) => p.type === "default");
    return defaults.length === 1 ? defaults[0]!.id : null;
  }

  /** Egy lap termék a szállítási profiljukkal (`*shipping_profile`: reláció). */
  async listProductShippingProfiles(
    offset: number,
    limit: number,
  ): Promise<{
    products: { id: string; shipping_profile?: { id: string } | null }[];
    count: number;
  }> {
    const params = new URLSearchParams({
      fields: "id,*shipping_profile",
      offset: String(offset),
      limit: String(limit),
    });
    return this.request(`/admin/products?${params.toString()}`);
  }

  async listProductHandles(
    offset: number,
    limit: number,
  ): Promise<{ products: { id: string; handle: string }[]; count: number }> {
    // rendezve: rendezés nélkül az offset-lapozás azonos `created_at` mellett
    // elcsúszhat, és egy termék kimaradhat vagy kétszer jöhet (barracuda, #1607)
    const params = new URLSearchParams({
      fields: "id,handle",
      order: "id",
      offset: String(offset),
      limit: String(limit),
    });
    return this.request(`/admin/products?${params.toString()}`);
  }

  async setProductHandle(id: string, handle: string): Promise<void> {
    await this.request(`/admin/products/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
  }

  async listProductSkus(
    offset: number,
    limit: number,
  ): Promise<{
    products: {
      id: string;
      external_id?: string | null;
      variants?: { sku: string | null }[] | null;
    }[];
    count: number;
  }> {
    const params = new URLSearchParams({
      fields: "id,external_id,*variants",
      offset: String(offset),
      limit: String(limit),
    });
    return this.request(`/admin/products?${params.toString()}`);
  }

  /** Egy termék szállítási profilja, a visszaméréshez. */
  async productShippingProfileId(productId: string): Promise<string | null> {
    const body = await this.request<{
      product: { shipping_profile?: { id: string } | null };
    }>(
      `/admin/products/${encodeURIComponent(productId)}?fields=id,*shipping_profile`,
    );
    return body.product.shipping_profile?.id ?? null;
  }

  async setProductShippingProfile(
    productId: string,
    shippingProfileId: string,
  ): Promise<void> {
    await this.request(`/admin/products/${encodeURIComponent(productId)}`, {
      method: "POST",
      body: JSON.stringify({ shipping_profile_id: shippingProfileId }),
    });
  }

  async fetchShippingAttributes(
    productId: string,
  ): Promise<MedusaShippingAttributeRow> {
    const body = await this.request<{
      shipping_attribute: MedusaShippingAttributeRow;
    }>(`/admin/shipping-attributes/${encodeURIComponent(productId)}`);
    return body.shipping_attribute;
  }

  async setShippingAttributes(
    productId: string,
    flags: MedusaShippingFlags,
  ): Promise<MedusaShippingAttributeRow> {
    const body = await this.request<{
      shipping_attribute: MedusaShippingAttributeRow;
    }>(`/admin/shipping-attributes/${encodeURIComponent(productId)}`, {
      method: "POST",
      body: JSON.stringify(flags),
    });
    return body.shipping_attribute;
  }

  async fetchProductKnowledge(
    productId: string,
  ): Promise<KnowledgeProjection | null> {
    try {
      const body = await this.request<{
        product_knowledge: KnowledgeProjection | null;
      }>(`/admin/product-knowledge/${encodeURIComponent(productId)}`);
      return body.product_knowledge ?? null;
    } catch (error) {
      if (error instanceof MedusaAdminHttpError && error.status === 404)
        return null;
      throw error;
    }
  }

  async setProductKnowledge(
    productId: string,
    knowledge: KnowledgeProjection,
  ): Promise<KnowledgeProjection> {
    const body = await this.request<{
      product_knowledge: KnowledgeProjection;
    }>(`/admin/product-knowledge/${encodeURIComponent(productId)}`, {
      method: "PUT",
      body: JSON.stringify(knowledge),
    });
    return body.product_knowledge;
  }

  async fetchUrlRedirects(): Promise<MedusaUrlRedirectList> {
    const body = await this.request<{ url_redirects: MedusaUrlRedirectList }>(
      "/admin/url-redirects",
    );
    return body.url_redirects;
  }

  async replaceUrlRedirects(
    redirects: MedusaUrlRedirect[],
  ): Promise<MedusaUrlRedirectList> {
    const body = await this.request<{ url_redirects: MedusaUrlRedirectList }>(
      "/admin/url-redirects",
      { method: "PUT", body: JSON.stringify({ redirects }) },
    );
    return body.url_redirects;
  }

  async fetchMetadata(id: string): Promise<Record<string, unknown> | null> {
    const body = await this.request<{
      product: { metadata?: Record<string, unknown> | null };
    }>(`/admin/products/${encodeURIComponent(id)}?fields=id,metadata`);
    return body.product?.metadata ?? null;
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

  async listVariantBarcodes(
    productId: string,
  ): Promise<MedusaVariantBarcodeRow[]> {
    const params = new URLSearchParams({
      fields: "id,sku,ean,upc",
      limit: String(VARIANT_LOOKUP_LIMIT),
    });
    const body = await this.request<{ variants: MedusaVariantBarcodeRow[] }>(
      `/admin/products/${encodeURIComponent(productId)}/variants?${params.toString()}`,
    );
    return body.variants ?? [];
  }

  async updateVariantBarcode(
    productId: string,
    variantId: string,
    patch: { ean?: string | null; upc?: string | null },
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/products/${encodeURIComponent(productId)}` +
        `/variants/${encodeURIComponent(variantId)}`,
      { method: "POST", body: JSON.stringify(patch) },
    );
  }

  async listVariantMeasures(
    productId: string,
  ): Promise<MedusaVariantMeasureRow[]> {
    const params = new URLSearchParams({
      fields: "id,sku,weight,length,width,height",
      limit: String(VARIANT_LOOKUP_LIMIT),
    });
    const body = await this.request<{ variants?: MedusaVariantMeasureRow[] }>(
      `/admin/products/${encodeURIComponent(productId)}/variants?${params.toString()}`,
    );
    return body.variants ?? [];
  }

  async updateVariantMeasures(
    productId: string,
    variantId: string,
    patch: MedusaVariantMeasurePatch,
  ): Promise<void> {
    await this.request<unknown>(
      `/admin/products/${encodeURIComponent(productId)}` +
        `/variants/${encodeURIComponent(variantId)}`,
      { method: "POST", body: JSON.stringify(patch) },
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

  /**
   * A FELTOLTES NEM A KOZOS `request()` UTON MEGY, ES EZ NEM STILUS.
   *
   * A `headers()` MINDEN keresre `content-type: application/json`-t tesz, es a
   * `request()` ezt fuzi ossze a hivo fejleceivel. Egy multipart torzsnel ez
   * elrontja a kerest, es MERVE EGYIK KERULOUT SEM MUKODIK:
   *
   *   a JSON rajta marad          -> `application/json` megy, a fetch NEM javitja ki
   *   "multipart/form-data"-ra    -> boundary NELKUL megy, hasznalhatatlan
   *   `undefined` erteket adunk   -> a kulcs OTT MARAD, a boundary NEM all be
   *   `new Headers(...)` peldany  -> a spread NEMAN eldobja az egeszet
   *
   * A FormData sajat hatarolo-erteke CSAK akkor all be, ha a `headers` objektum
   * egyaltalan NINCS megadva. Ezert ez a metodus a fejlecet maga allitja ossze,
   * es KIZAROLAG az `authorization` sort veszi at.
   *
   * ES A HIBA, AMIT EZ ELKERUL, NEMA VOLNA: a keres MEGERKEZNE, a bolt
   * `multer` retege nem talalna benne fajlt, es a hiba ugy nezne ki, mintha a
   * kepfajllal lenne baj. Ugyanez a hiba mar megharapott minket a mobil
   * kliensben.
   */
  async uploadFile(file: MedusaFileUpload): Promise<MedusaUploadedFile> {
    const form = new FormData();
    /**
     * A mezo neve `files`, TOBBES SZAMBAN, es ez a bolt oldalarol kotott: a
     * vegpont `upload.array("files")` alakban olvassa a kerest, es ures
     * listanal `No files were uploaded` hibat dob. Egy egyes szamu mezonev
     * tehat nem elgepeles lenne, hanem ures feltoltes.
     */
    form.append(
      "files",
      new Blob([new Uint8Array(file.content)], { type: file.contentType }),
      file.filename,
    );

    const response = await this.fetchImpl(
      `${this.config.baseUrl}/admin/uploads`,
      {
        method: "POST",
        headers: { authorization: this.authorization() },
        body: form,
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new MedusaAdminHttpError(response.status, body.slice(0, 500));
    }

    const payload = (await response.json()) as {
      files?: { id?: string; url?: string }[];
    };
    /**
     * A VALASZ ALAKJAT ELLENORIZZUK, MERT EGY HIANYZO MEZO ITT NEMA VOLNA.
     *
     * A vegpont `{ files: [...] }` alakban valaszol, es egy `undefined` URL
     * kesobb, a termek kep-mezojeben jelenne meg -- ott mar semmi nem mondana
     * meg, hogy a feltoltes volt hianyos. Egy fajlt kuldtunk, egy sort varunk.
     */
    const uploaded = payload.files?.[0];
    if (!uploaded?.id || !uploaded.url)
      throw new MedusaAdminHttpError(
        response.status,
        `A bolt elfogadta a feltöltést, de a válasz nem hozott azonosítót és ` +
          `URL-t (${file.filename}). Ilyenkor a fájl ODAÁT LEHET, csak nem ` +
          `tudjuk, hol: a hívó ne jegyezzen fel semmit.`,
      );

    return { id: uploaded.id, url: uploaded.url };
  }
}
