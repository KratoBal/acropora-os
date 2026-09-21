/**
 * Mikor ertekesitheto egy Acropora OS termek a storefronton, es mit jelent ez
 * a Medusa oldalan.
 *
 * KULON MODUL, HALOZAT NELKUL MERHETO. A brief kikotese, es nem formasag: a
 * publikacios dontes eddig nem letezett, es ha a parancssori felulet torzsebe
 * kerulne, akkor a szabalyt csak eles hivassal lehetne megnezni. Egy szabaly,
 * amit csak halozattal lehet merni, elobb-utobb merjetlen marad.
 *
 * A DONTES KET KAPUT AD VISSZA, es szandekosan egyszerre hasznaljuk oket
 * (Balazs 6. pontja). A telepitett Medusa 2.19.0 kodjabol merve a storefront a
 * KETTO METSZETET nezi: a `GET /store/products` utvonal `applyDefaultFilters`
 * hivasa `status: published` ertekre szur, es emellett a keresehez tartozo
 * sales channel linkre is. Barmelyik hianyzik, a termek nem jon vissza.
 * Egyetlen kapu tehat elegendo LENNE a lathatosag megszuntetesehez, de akkor a
 * masik allapot csendben elsodrodna attol, amit hiszunk rola.
 */

/**
 * AZ ISMERT GAZDAK, EGY HELYEN.
 *
 * A gazda-feltetel NEGY ponton all: a harom vetito parancsban (termek, keszlet,
 * ar) es magaban a publikacios szabalyban. 2026-09-02-ig mind a negy KULON irta
 * le ugyanazt a feltetelt, es amikor a tulajdonos dontese megvaltoztatta
 * (Balazs, 17:54: "Ami az unasban van az kell a medusaba is"), negy helyen
 * kellett volna atvezetni -- negy kulon alkalom arra, hogy egy kimaradjon.
 *
 * A KIMARADAS PEDIG NEM EGYFORMA: ha egy parancs-szuro marad a regin, az
 * HANGOS (nem tortenik semmi). Ha a szabaly marad a regin, az NEMA (minden
 * atmegy, a futas sikert jelent, es a boltban semmi nem latszik).
 *
 * A `null` SZANDEKOSAN NEM ISMERT: a sema ket erteket ismer, es amirol nem
 * tudjuk, honnan jott, azt visszatartjuk. Kiengedni csendes tevedes,
 * visszatartani hangos.
 */
export const KNOWN_CATALOG_AUTHORITIES = ["ACROPORA", "UNAS"] as const;

export function isKnownCatalogAuthority(authority: string | null): boolean {
  return (KNOWN_CATALOG_AUTHORITIES as readonly string[]).includes(
    authority ?? "",
  );
}

/** Amit a dontes bemenetkent kap. Csak allapot, semmi mas. */
export interface ProductPublicationState {
  /**
   * `UNAS`, `ACROPORA` vagy `null`.
   *
   * 2026-09-02-IG A NEM-ACROPORA GAZDA ONMAGABAN ELUTASITAS VOLT. Ma nem az:
   * a tulajdonos dontese (Balazs, 2026-09-02 17:54, Discord) szo szerint
   * "Nem kell kapcsolo. Ami az unasban van az kell a medusaba is. Akar regi
   * akar ujonnan rogzitett lesz". Egy UNAS gazdaju termek tehat ugyanugy
   * ertekesitheto, ha a tobbi harom feltetel all.
   *
   * A `null` VISZONT MARAD FAIL-CLOSED, es ez nem ovatoskodas: a gazda ket
   * ismert erteke UNAS es ACROPORA (a sema enumja), a `null` egyik sem --
   * vagyis nem tudjuk, honnan jott a termek. Egy ismeretlen gazdaju termeket
   * kiengedni CSENDES tevedes (megjelenik a boltban, es senki nem keresi),
   * visszatartani viszont HANGOS.
   */
  catalogAuthority: string | null;
  isActive: boolean;
  /** Az Acropora-tulajdonu uzleti dontes. */
  webshopSellable: boolean;
  /** Hany AKTIV valtozata van a termeknek. */
  activeVariantCount: number;
  /**
   * A TERMEK VALTOZATAINAK CIKKSZAMAI -- a nem-termek sorok felismeresehez.
   *
   * Elhagyhato, es ez szandekos: a regi hivok (es a fixturak) valtozatlanul
   * ervenyesek maradnak, es hianyaban a szabaly UGYANUGY dont, mint eddig.
   * Egy kotelezo mezo itt minden meglevo hivohelyet atirna anelkul, hogy
   * barmelyik dontese valtozna.
   */
  variantSkus?: readonly string[];
}

/**
 * Miert lett az eredmeny az, ami. A jelentes ezt irja ki, nem a nyers logikai
 * erteket: egy "nem ertekesitheto" sor onmagaban nem mondja meg, mit kell
 * tenni ahhoz, hogy az legyen.
 */
export type PublicationReason =
  | "sellable"
  | "unknown-authority"
  | "product-inactive"
  | "no-active-variant"
  | "not-webshop-sellable"
  | "not-a-product";

export interface PublicationDecision {
  sellable: boolean;
  reason: PublicationReason;
  /** A Medusa product status, amit be kell allitani. */
  status: "published" | "draft";
  /**
   * Mi tortenjen a storefront sales channel kapcsolattal.
   *
   * A telepitett 2.19.0 termek-frissito folyamata a `sales_channels` mezot
   * CSEREKENT kezeli: a meglevo linkeket torli, es a kapott listat hozza
   * letre. Ebbol ket dolog kovetkezik, es mindketto jol jon: az `attach`
   * ismetelheto duplikacio nelkul, a `detach` pedig egy ures lista.
   */
  salesChannel: "attach" | "detach";
}

/**
 * A szabaly, ahogy Balazs 3-5. pontja kimondja.
 *
 * A sorrend nem tetszoleges: a gazda, az aktivitas es a valtozat MEGELOZI az
 * uzleti jelzest. Igy az indoklas mindig a LEGKORABBI akadalyt nevezi meg, es
 * nem azt, hogy "nincs bejelolve a webshop", amikor valojaban a termek
 * inaktiv.
 *
 * AZ ELSO KAPU 2026-09-02 OTA SZUKEBB: nem azt kerdezi, hogy MIENK-E a
 * torzsadat, hanem hogy ISMERJUK-E a gazdajat. A ket ismert ertek (UNAS es
 * ACROPORA) egyarant atmegy rajta.
 */
/**
 * A SOROK, AMIK NEM TERMEKEK -- NEVESITVE, INDOKKAL ES A MERES DATUMAVAL.
 *
 * === MIERT KELL, HOLOTT MA EGYIK SEM MENNE KI ===
 *
 * Merve a staging adatbazison, 2026-09-21: mind a ketto BEJUT hozzank, es
 * AKTIV valtozatkent all (`isActive = true` a termeken es a valtozaton is).
 * Ami ma visszatartja oket, az KIZAROLAG a `webshopSellable = false`, vagyis a
 * `not-webshop-sellable` ag.
 *
 * ES AZ A VEDELEM VELETLEN. A `webshopSellable` nem azert hamis, mert ezek a
 * sorok NEM TERMEKEK, hanem mert a UNAS-ban a statuszuk 0 -- nincsenek kint az
 * elo boltban. A ket allitas MA egybeesik, de nem ugyanaz:
 *
 *   ami ma vedi        "ez a termek nincs kint a boltban"
 *   amit ez a lista    "ez a sor nem is termek"
 *
 * Ha valaki a UNAS-ban elo allapotba teszi barmelyiket -- egy kedvezmeny-tetelnel
 * ez nem elkepzelhetetlen, mert a bolt sajat mechanikaja hasznalja --, a mai
 * vedelem AZONNAL megszunik, es semmi nem szolna.
 *
 * Ugyanaz az alak, amit a vonalkod-szabaly mar kimond a kiadvany-elotagrol:
 * "nem azert maradnak bent, mert generaltak, hanem mert TOBBSZOR allnak".
 *
 * === AMIT A KET SOR VALOJABAN CSINAL (a 2026-09-02-i UNAS exportbol) ===
 *
 *   discount-amount   "Kedvezmeny", 1 Ft brutto. A bolt sajat kedvezmeny-tetele,
 *                     nem arucikk. Az erteke a "Gyartoi cikkszam" oszlopban is
 *                     all, tehat a vonalkod-mezobe is beszivarog.
 *   Alap_Hal          "Aalap_Hal", 1,27 Ft brutto. Sablon-rekord uj halak
 *                     felvitelehez. A "SEF URL" oszlopban is all, tehat a bolti
 *                     cim is ebbol kepzodne.
 */
const NEM_TERMEK_CIKKSZAMOK: readonly string[] = [
  "discount-amount",
  "Alap_Hal",
];

export function decidePublication(
  state: ProductPublicationState,
): PublicationDecision {
  const refuse = (reason: PublicationReason): PublicationDecision => ({
    sellable: false,
    reason,
    status: "draft",
    salesChannel: "detach",
  });

  /*
    A NEM-TERMEK SOR AZ ELSO KAPU, ES A SORREND ITT INDOK.

    A tobbi ok mind arrol szol, hogy egy TERMEK miert nem ertekesitheto most.
    Ez arrol, hogy a sor nem is termek -- tehat a tobbi kerdes fel sem merul.
    Ha kesobb allna, a jelentes azt mondana egy kedvezmeny-tetelrol, hogy
    "nincs webshopos ertekesitesre jelolve", mintha barmikor lehetne.
  */
  if (state.variantSkus?.some((sku) => NEM_TERMEK_CIKKSZAMOK.includes(sku)))
    return refuse("not-a-product");

  if (!isKnownCatalogAuthority(state.catalogAuthority))
    return refuse("unknown-authority");
  if (!state.isActive) return refuse("product-inactive");
  if (state.activeVariantCount < 1) return refuse("no-active-variant");
  if (!state.webshopSellable) return refuse("not-webshop-sellable");

  return {
    sellable: true,
    reason: "sellable",
    status: "published",
    salesChannel: "attach",
  };
}

/** Egy sor a jelentesbe, emberi olvasasra. */
export const PUBLICATION_REASON_TEXT: Record<PublicationReason, string> = {
  sellable: "értékesíthető a webshopban",
  "unknown-authority": "a törzsadat gazdája ismeretlen",
  "product-inactive": "a termék inaktív",
  "no-active-variant": "nincs aktív változata",
  "not-webshop-sellable": "nincs webshopos értékesítésre jelölve",
  "not-a-product": "ez a sor nem termék (a bolt saját segédtétele)",
};
