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
  | "not-webshop-sellable";

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
export function decidePublication(
  state: ProductPublicationState,
): PublicationDecision {
  const refuse = (reason: PublicationReason): PublicationDecision => ({
    sellable: false,
    reason,
    status: "draft",
    salesChannel: "detach",
  });

  if (
    state.catalogAuthority !== "ACROPORA" &&
    state.catalogAuthority !== "UNAS"
  )
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
};
