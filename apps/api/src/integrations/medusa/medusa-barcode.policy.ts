/**
 * A GYARTOI CIKKSZAM MEZO TARTALMA VONALKOD IS LEHET, ES AKKOR MAS A HELYE.
 *
 * KULON MODUL, ADATBAZIS NELKUL MERHETO, ugyanabbol az okbol, amiert a
 * kategoria-, a marka- es a publikacios szabaly is kulon all. *
 * AZ EREDETI INDOK AZOTA ELAVULT, ES A KOVETKEZTETESE MA MAR HAMIS. Ez a
 * bekezdes ugy szolt, hogy a torzs a `prisma`-t MODUL-SZINTU importbol veszi,
 * TEHAT teszt-duplat nem lehet neki adni. Az elso fele ma is igaz (az
 * alapertelmezeshez), a masodik nem: a `db` parameter (2026-09-04, #515) ota a
 * torzs MERHETO, es harom allitas fut rajta.
 *
 * A KOVETKEZTETES VALTOZATLAN, AZ OKA MAS: egy tiszta fuggveny allitasa NEV
 * SZERINT tud pirosodni, a torzs-teszte viszont a TELJES lancot futtatja. Ha
 * ez a szabaly a torzsben allna, egy rontasa utan nem lehetne megmondani,
 * MELYIK resz romlott el.
 *
 * ES A "PARANCS TORZSE" KIFEJEZES IS ELAVULT: a torzs 2026-09-04 ota a
 * `medusa-projection.runner.ts` modulban all (#518), a parancs maga kilenc sor.
 *
 * MIERT KELL EZ A DONTES, ES MIERT NEM ELEG "atvinni a mezot": a
 * `manufacturerPartNumber` oszlop VEGYES tartalmu. A 09-03-as UNAS exporton
 * merve, 997 kitoltott ertekbol 490 vonalkod-SZERU (8-14 szamjegy), es ebbol
 * 479 ERVENYES ellenorzo szamjeggyel -- a maradek 507 valodi gyartoi cikkszam
 * (peldaul `core7_otherm_bulk`). A ket fajta MAS helyre valo a cel oldalon,
 * es a vonalkode a fontosabb: a Medusan az `ean` es az `upc` KERESHETO mezo,
 * tehat a vevo altal beirt kod ezen mulik.
 *
 * A HOSSZ DONTI EL A MEZOT, NEM A TARTALOM: 13 szamjegy EAN-13, 12 szamjegy
 * UPC-A. Ez nem izles: a cel oldali mezok maguk is igy vannak elnevezve, es egy
 * 12 jegyu kod az `ean` mezoben ugyanugy megtalalhatatlan lenne.
 *
 * AZ ISMETLODES KIMARAD, ES EZ A LEGFONTOSABB AGA. Merve: 50 kod 151 termeken
 * ismetlodik (ket kulonbozo cikkszam ugyanarra a vonalkodra). Amig a
 * forras-oldali tisztitas meg nem tortent, ezeket NEM visszuk at -- egy
 * ismetlodo kod a boltban azt allitana, hogy ket kulonbozo termek ugyanaz.
 *
 * ES AZ ISMETLODEST EZ A FUGGVENY NEM TUDJA EGYEDUL ELDONTENI: a vetites
 * termekenkent fut, tehat a globalis kepet a HIVO adja at (`sameValueCount`).
 * Ezert parameter, es nem lekerdezes: igy a szabaly merheto marad.
 */

/** Az ellenorzo szamjegy, EAN-8/13, UPC-A es GTIN-14 sulyozassal. */
export function hasValidCheckDigit(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  if (![8, 12, 13, 14].includes(value.length)) return false;
  const szamjegyek = [...value].map(Number);
  const ellenorzo = szamjegyek[szamjegyek.length - 1]!;
  const torzs = szamjegyek.slice(0, -1).reverse();
  const osszeg = torzs.reduce(
    (acc, szamjegy, index) => acc + szamjegy * (index % 2 === 0 ? 3 : 1),
    0,
  );
  return (10 - (osszeg % 10)) % 10 === ellenorzo;
}

/**
 * A KIADVANY-TARTOMANYOK, AMIK ERVENYESEK, DE NEM TERMEK-VONALKODOK.
 *
 * A GS1 harom elotagot tart fenn kiadvanyoknak: 977 (ISSN, folyoirat), 978 es
 * 979 (ISBN es ISMN, konyv es kotta). Ezek ERVENYES ellenorzo szamjegyet
 * viselnek, tehat a checksum-vizsgalat atengedi oket -- egy akvarisztikai
 * katalogusban viszont nem lehetnek valodi termek-vonalkodok.
 *
 * MIERT KELL EZ A LISTA, ES MIERT NEM ELEG AZ EGYEDISEG: a mert adatban tobb
 * GENERALT kod all a gyartoi cikkszam mezoben, es azok tobbsegét ma az
 * ismetlodes-ag tartja vissza (egy 979-es kod tizenket termeken all, egy
 * 978-as negyen). DE AZ A VEDELEM VELETLEN: nem azert maradnak bent, mert
 * generaltak, hanem mert TOBBSZOR allnak. Egy generalt kod, ami veletlenul
 * egyedi, atmenne -- es a mert adatban pontosan egy ilyen van
 * (9780301379722, egy olyan termeken, aminek a sajat cikkszama ugyanez).
 *
 * ES EZERT NEM UGYANAZ, MINT EGY BEEGETETT ERTEK A MI ADATUNKROL. A "db"
 * mertekegyseget nem egethetjuk a kodba, mert az a KATALOGUSUNK allapota, es
 * holnap mas lehet. A 978-as elotag a GS1 SZABVANYE: nem attol fugg, mit
 * tartalmaz a mi tablank, es nem avul el a katalogus valtozasaval.
 *
 * A 12 jegyu UPC-A alak SOSEM esik ide: azt EAN-13-kent egy vezeto NULLA
 * egesziti ki, tehat "0"-val kezdodik. A vizsgalat ezert eleg a 13 jegyu
 * alakra.
 */
const KIADVANY_ELOTAGOK = ["977", "978", "979"];

/**
 * A TOBBI GS1-TARTOMANY, AMI NEM TERMEKET AZONOSIT.
 *
 * A kiadvany-elotagok mellett a GS1 tovabbi tartomanyokat is fenntart, es ezek
 * ugyanugy ERVENYES ellenorzo szamjegyet viselnek:
 *
 *   950-969   GS1 Global Office (kuponok es sajat kiosztas), NEM termek
 *   980       refund receipt
 *   981-984   kozos penznemu kupon
 *   99        kupon
 *   2         BELSO HASZNALAT: boltonkent szabadon kiosztott, valtozo sulyu
 *             arukra. Ket kulonbozo bolt ugyanazt a kodot mas termekre adhatja,
 *             tehat a boltunkon KIVUL semmit nem azonosit.
 *
 * MIERT KELL, HOLOTT MA EGYIK SEM MENNE KI: a mert adatban ket ilyen kod all
 * (9579907673293 a GS1 Global Office tartomanyban, ket cikkszamon), es MA az
 * ismetlodes-ag tartja vissza. DE AZ A VEDELEM VELETLEN -- pontosan ugyanaz a
 * mondat, ami az ISBN-nel is allt: nem azert marad bent, mert kupon, hanem mert
 * tobbszor all. Egy kupon-kod, ami veletlenul egyedi, atmegy.
 *
 * A 2-es elotagra a mert adatban NULLA eset van. Elore szol, nem visszamenoleg:
 * a belso hasznalatu kodok epp attol veszelyesek, hogy barmikor keletkezhetnek.
 */
function nemTermekTartomany(kod: string): boolean {
  const elso = kod.slice(0, 1);
  const harom = kod.slice(0, 3);
  return (
    elso === "2" ||
    (harom >= "950" && harom <= "969") ||
    (harom >= "980" && harom <= "984") ||
    harom.startsWith("99")
  );
}

/**
 * A NEGY KIMENET, ES MIERT NEM KETTO.
 *
 * A `skipped` es a `none` a keres torzsere nezve ugyanaz (egyik sem kuld
 * vonalkodot), a KOVETKEZMENYUK viszont ellentetes:
 *
 *   `none`      -- nincs mit kuldeni: a mezo ures, vagy nem vonalkod, hanem
 *                  valodi gyartoi cikkszam. Ez RENDBEN van, nincs teendo.
 *   `skipped`   -- ERVENYES vonalkod, de tobb terméken all. HIANY: ha nem
 *                  mondjuk ki, a kod csendben elmarad, es a kimenetbol nem
 *                  lehetne megmondani, melyik eset allt fenn.
 */
export type MedusaBarcodeDecision =
  | { kind: "none"; field: null; value: null; duplicate: null }
  | { kind: "ean"; field: "ean"; value: string; duplicate: null }
  | { kind: "upc"; field: "upc"; value: string; duplicate: null }
  | { kind: "skipped"; field: null; value: null; duplicate: string };

/**
 * A DONTES. Csak allapot megy be, csak dontes jon ki.
 *
 * A `sameValueCount` azt mondja meg, HANY aktiv varianson all ugyanez az ertek.
 * Az 1 az egyedi eset; a 0 nem fordulhat elo (a sajat sor mindig szamit), es ha
 * megis, ugy kezeljuk, mint az egyedit: a hivo szamlalasi hibaja miatt NEM
 * dobunk el egy jo kodot.
 */
export function decideMedusaBarcode(
  value: string | null,
  sameValueCount: number,
): MedusaBarcodeDecision {
  const kod = (value ?? "").trim();
  if (!kod || !hasValidCheckDigit(kod))
    return { kind: "none", field: null, value: null, duplicate: null };

  /**
   * A MEZO-VALASZTAS AZ ISMETLODES-VIZSGALAT ELOTT ALL, ES EZ A SORREND MERT
   * DONTES, NEM IZLES.
   *
   * A `skipped` azt mondja a kimenetben, hogy a tisztitas helye a FORRAS: ott
   * dol el, MELYIK terméke a kod. Egy kiadvany-elotagu kodnal ez HAMIS -- nem
   * az a kerdes, melyikuke, hanem hogy EGYIKUKE SEM, mert nem is vonalkod.
   * Ugyanez all a 8 es a 14 jegyu alakra: azoknak nincs cel-mezojuk.
   *
   * A forditott sorrend tizenhat terméket sorolna a rossz csoportba (merve a
   * forrason), es a kimenetunk ellentmondana a tisztitasi listanak: ott ezek
   * "a mezo torlendo" jelolest kapnak, nem "szetvalasztando"-t.
   *
   * VAGYIS ELOSZOR AZT KERDEZZUK MEG, HOGY EGYALTALAN VONALKOD-E, es csak
   * azutan, hogy egyedi-e.
   */
  const mezo =
    kod.length === 13 &&
    !KIADVANY_ELOTAGOK.some((elotag) => kod.startsWith(elotag)) &&
    !nemTermekTartomany(kod)
      ? "ean"
      : kod.length === 12
        ? "upc"
        : null;

  /**
   * A 8 es a 14 jegyu alak, valamint a kiadvany-elotag ERVENYES ellenorzo
   * szamjeggyel is ide esik: a cel oldalon `ean` (13) es `upc` (12) mezo van, a
   * GTIN-14 es az EAN-8 egyikbe sem illik. A mert adatban a hat ilyen hosszusagu
   * ertek MIND ervenytelen volt, tehat az az ag ma nem all elo -- de a
   * hossz-vizsgalat nem tamaszkodhat erre.
   */
  if (!mezo) return { kind: "none", field: null, value: null, duplicate: null };

  if (sameValueCount > 1)
    return { kind: "skipped", field: null, value: null, duplicate: kod };

  return mezo === "ean"
    ? { kind: "ean", field: "ean", value: kod, duplicate: null }
    : { kind: "upc", field: "upc", value: kod, duplicate: null };
}

/**
 * A KIHAGYAS SORA. Megnevezi a kodot es a termeket, mert a tisztitas pontosan
 * azon a kodon mulik.
 *
 * ES MEGMONDJA, MIT KELL MEGNEZNI, mert a kimenetbol onmagaban nem derulne ki,
 * hogy a hiba a forrasban van, nem nalunk: ugyanaz a vonalkod ket kulonbozo
 * cikkszamon a UNAS oldalan all igy, es amig ott nincs tisztazva, a bolt
 * oldalan a kod ket termeket allitana azonosnak.
 */
export function describeSkippedBarcode(
  productId: string,
  barcode: string,
  sameValueCount: number,
): string {
  return (
    `${productId}: a ${barcode} vonalkód ${sameValueCount} aktív változaton ` +
    `áll, ezért NEM megy ki. Egy ismétlődő kód a boltban azt állítaná, hogy ` +
    `két különböző termék ugyanaz. A tisztítás helye a forrás (UNAS), nem a ` +
    `vetítés: ott dől el, melyik terméké a kód.`
  );
}
