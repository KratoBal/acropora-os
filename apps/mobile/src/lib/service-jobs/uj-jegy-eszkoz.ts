/**
 * RELATIV UT, NEM `@/` ALIAS -- a `tsconfig.test.json` szandekosan nem hordoz
 * `paths` bejegyzest, tehat a leforditott kodban maradna az alias, es a FUTAS
 * hasalna el rajta. (Ugyanaz az indok, mint a `list-scope.ts` fejleceben.)
 */
import { filterAssets, type SearchableAsset } from "../assets/asset-search";

/**
 * UJ HIBAJEGY A HIBAJEGYEK MENUBOL -- AZ ESZKOZ KIVALASZTASA.
 *
 * === MIERT KELL ESZKOZT VALASZTANI, ES MIERT NEM ELHAGYHATO ===
 *
 * A jegy PARTNERE es HELYSZINE nem a telefonon dol el: a szerver vezeti le az
 * `originAssetId`-bol (`placementOfAsset`). Szallitoi eszkoznel a jegy partnere
 * a szallito TUKOR-sora, ami a partner belso reszlete -- a telefon ezert nem
 * vezetheti le magatol.
 *
 * Ebbol kovetkezik, hogy ez a kepernyo NEM uj utat nyit a szerver fele: a
 * felvitel ugyanaz marad, csak az eszkozt mashol valasztjuk ki. Az eszkoz
 * NELKULI jegy kulon munka, es a SZERVER oldalan kezdodik.
 */
export const UJ_JEGY_KEPERNYO = "/service-jobs/new" as const;

/**
 * A FELVITEL UTJA, EGY HELYEN.
 *
 * Azert fuggveny es nem beirt sztring a kepernyon, mert KET hivoja lesz (a
 * hibajegy-lista valasztoja es a gep adatlapja), es egy elirt paramater-nev
 * ugyanolyan csendes, mint egy elirt utvonal: a `new.tsx` `assetId` nelkul
 * VISSZAIRANYIT a listara, tehat a hiba ugy nez ki, mintha a gomb nem mukodne.
 */
export function ujJegyEszkozzel(assetId: string) {
  return { pathname: UJ_JEGY_KEPERNYO, params: { assetId } } as const;
}

/**
 * AMIT A VALASZTO KINAL -- ES MIERT NEM MINDIG HELYBEN SZURUNK.
 *
 * Tereróvel a SZERVER keres: a lista lapozott, tehat egy helyi szuro a
 * megkapott oldalbol valogatna, es kevesebbet mutatna, mint amit a szerver
 * mondott. Tereró NELKUL a mentett masolat TELJES, tehat ott a helyi szures
 * ugyanazt adja, mint a szerver adna.
 *
 * EZ A DONTES MAR LETEZETT, csak beirva az eszkoz-lista kepernyojere egyetlen
 * sorkent. Azert kerult ide, mert MOST KET kepernyo hozza ugyanezt a dontest,
 * es ket masolat pontosan addig egyezik, amig valaki az egyiket atirja.
 */
export function valaszthatoEszkozok<T extends SearchableAsset>(input: {
  szerverElemek: readonly T[] | undefined;
  mentettElemek: readonly T[] | undefined;
  kereses: string;
}): T[] {
  const { szerverElemek, mentettElemek, kereses } = input;

  if (szerverElemek) return [...szerverElemek];

  return filterAssets(mentettElemek ?? [], kereses);
}
