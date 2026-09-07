/**
 * A WYSIWYG SZABALY: MELYIK TERMEK NEM RENDELHETO ELORE.
 *
 * BALAZS DONTESE (2026-09-04): a WYSIWYG termekeknel a rendelhetoseg legyen
 * KIKAPCSOLVA, es a jelolest a KATEGORIA adja -- nem egy nevsor, nem egy
 * cikkszam-lista. Egy WYSIWYG termek EGY DARAB, konkret allat vagy korall: ha
 * elfogyott, nincs "ugyanolyan" masik.
 *
 * MIERT KULON MODUL: a szabaly tiszta fuggveny, tehat adatbazis nelkul merheto,
 * es egy allitasa NEV SZERINT tud pirosodni. A lekerdezes a hivonal marad.
 *
 * === HAROM ROSSZ ALAK, MIND MERVE (acrobot es polip, 2026-09-04, a teszt
 * adatbazison es a UNAS forrason) ===
 *
 *   csak a CIKKSZAM                    3 termek   -- harom kimarad
 *   csak az ELSODLEGES besorolas       2 termek   -- negy kimarad
 *   csak a NEV, reszfa nelkul          4 termek   -- a ket acrofrag kimarad
 *   RESZFA + MINDEN besorolas          6 termek   -- HELYES, egyezik a forrassal
 *
 * A ket acrofrag azert esik ki a harmadik alaknal, mert az SPS GYEREK-
 * kategoriaban all, ami a WYSIWYG alatt fugg. Ezert kell a reszfat bejarni.
 *
 * === ES EGY MEGTEVESZTO MEZO, AMIT POLIP TALALT ===
 *
 * A UNAS valasz `Statuses` blokkjaban van egy MASIK, 'WYSIWYG' NEVU jelzo
 * (Type=plus), ami MIND az 1889 termeken jelen van, mindig `Value=0`. Az NEM a
 * kategoria. Aki arra epit, MINDENT vagy SEMMIT kap -- es a ket eredmeny kozul
 * az egyik hihetonek is latszik.
 *
 * Ez a modul ezert a MI kategoria-fankbol dolgozik, nem a forras jelzoibol.
 *
 * === ES AMI A HELYES MUKODES JELE ELES ADATON: A NAPLOSOR, NEM AZ ALLAPOT ===
 *
 * Merve 2026-09-04, a teszt telepitesen, ket termeken egy futtatasban:
 *
 *   195-WYSIWYG (WYSIWYG termek):  backorder: tiltva (mar igy allt)
 *   156161      (rendes termek):   backorder: engedelyezve (most allitottuk be)
 *
 * A WYSIWYG termeken az EREDMENY (tiltva) ONMAGABAN NEM BIZONYIT SEMMIT: a Medusa
 * alapertelmezese egy uj valtozaton amugy is hamis, tehat ugyanez az allapot allna
 * elo akkor is, ha ez a szabaly egyaltalan nem futott volna le.
 *
 * AMI BIZONYIT, AZ A KET SOR KULONBSEGE. A parancs osszeveti a DONTEST a jelenlegi
 * bolti allapottal, es kiirja, melyik tortent (`most allitottuk be` kontra `mar igy
 * allt`). Ha ez a szabaly hibas lenne es igazat adna, a WYSIWYG termeken is
 * `engedelyezve (most allitottuk be)` allna -- pontosan az, ami a masikon all.
 *
 * EZERT ALL ITT: aki kesobb csak a Medusa-oldali erteket nezi meg, ugy fogja latni,
 * hogy "nem tortent semmi", es abbol nem tudja eldonteni, hogy a szabaly mukodik-e.
 * A bizonyitek helye a PARANCS KIMENETE, nem a bolt.
 */

/** A fa egy csomopontja, csak azokkal a mezokkel, amiket a szabaly olvas. */
export interface WysiwygCategoryNode {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * A WYSIWYG kategoria neve, ahogy a fankban all.
 *
 * KULON KONSTANS, hogy egy atnevezes EGY helyen tortenjen -- es hogy a
 * teszt is ERRE hivatkozhasson, ne egy masodik, kezzel beirt szoveget merjen.
 */
export const WYSIWYG_CATEGORY_NAME = "WYSIWYG";

/**
 * A WYSIWYG RESZFA minden kategoria-azonositoja.
 *
 * A NEVRE ILLESZTES KIS-NAGYBETU FUGGETLEN, es ez meresi dontes, nem kenyelem:
 * a kategoria-nevek a UNAS-bol jonnek, es ott az irasmod nem garantalt. Egy
 * betupontos egyezes egy atirt "Wysiwyg" utan CSENDBEN ures halmazt adna, es
 * onnantol minden termek rendelheto lenne -- vagyis a hiba a MEGENGEDO irany
 * fele mutatna, ami itt a dragabb.
 *
 * A KOR ELLEN VEDETT: egy onmagara mutato szulo-lanc (adathiba) nem vegtelen
 * ciklust ad, hanem megall -- a mar bejart azonositokat szamon tartjuk.
 */
export function wysiwygSubtreeIds(
  categories: readonly WysiwygCategoryNode[],
): Set<string> {
  return subtreeIdsByNames(categories, [WYSIWYG_CATEGORY_NAME]);
}

/**
 * EGY RESZFA-BEJARAS, TOBB SZABALYNAK.
 *
 * === MIERT KULON, ES MIERT MOST ===
 *
 * A "melyik termek esik egy nevesitett kategoria ALA" kerdes ma HAROM szabalynal
 * all elo: a WYSIWYG rendelhetoseg, az elo allat szallitasi korlat, es a kirakat
 * sotet-vilagos valtoja. Ha mindegyik SAJAT bejarast ir, akkor a kor elleni
 * vedelem, a kis-nagybetu kezelese es a "minden besorolas szamit" szabaly harom
 * helyen all -- es az elso nap elcsuszik.
 *
 * A NEVEK maradnak szabalyonkent kulon (azok tenyleg kulonboznek); a BEJARAS
 * egy.
 */
export function subtreeIdsByNames(
  categories: readonly WysiwygCategoryNode[],
  names: readonly string[],
): Set<string> {
  const keresett = new Set(names.map((n) => n.trim().toLowerCase()));

  const gyerekek = new Map<string, string[]>();
  for (const kategoria of categories) {
    if (!kategoria.parentId) continue;
    const lista = gyerekek.get(kategoria.parentId);
    if (lista) lista.push(kategoria.id);
    else gyerekek.set(kategoria.parentId, [kategoria.id]);
  }

  const eredmeny = new Set<string>();
  const sor = categories
    .filter((kategoria) => keresett.has(kategoria.name.trim().toLowerCase()))
    .map((kategoria) => kategoria.id);

  while (sor.length > 0) {
    const id = sor.pop()!;
    if (eredmeny.has(id)) continue;
    eredmeny.add(id);
    for (const gyerek of gyerekek.get(id) ?? []) sor.push(gyerek);
  }
  return eredmeny;
}

/**
 * RENDELHETO-E ELORE EZ A TERMEK.
 *
 * MINDEN BESOROLAS SZAMIT, az elsodleges ES az alternativ egyarant. Merve: a
 * hat termekbol NEGYNEL a WYSIWYG csak ALTERNATIV besorolaskent all -- egy
 * `isPrimary` szures tehat negyet elengedne, es azok elore rendelhetok
 * maradnanak.
 *
 * AZ ALAPERTELMEZES A MAI VISELKEDES: ami nincs a reszfaban, az tovabbra is
 * rendelheto (`true`).
 */
export function decideWysiwygBackorder(
  productCategoryIds: readonly string[],
  wysiwygIds: ReadonlySet<string>,
): boolean {
  return !isWysiwygProduct(productCategoryIds, wysiwygIds);
}

/**
 * EGY DARAB-E EZ A TERMEK: A JELZO, AMIT A BOLT OLDALA OLVAS.
 *
 * === MIERT KELL, HOLOTT A BACKORDER-DONTES MAR ITT ALL ===
 *
 * A ket kerdes MA egybeesik, de NEM UGYANAZ, es a kirakat oldalan a kulonbseg
 * a vevo ele kerul. Az `allow_backorder = false` jelentese "nem rendelheto
 * elore"; a `unique_piece` jelentese "egy darab, ez a konkret peldany". Ha a
 * kirakat az elsobol olvasna ki a masodikat, akkor egy BARMILYEN okbol
 * elorendeles-mentes termek lapjara "Eladva" kerulne, es a vevo azt olvasna,
 * hogy a peldany elkelt -- holott csak a raktar urult ki.
 *
 * Ezert kulon nev, ugyanabbol a forrasbol. A ket fuggveny egymasbol all elo,
 * tehat egy szabaly-valtozas nem tudja a kettot szetcsuszasra vinni.
 *
 * === ES AMIT EZ NEM ALLIT ===
 *
 * Nem allitja, hogy a termek ELOALLAT. A WYSIWYG reszfa az EGYEDI DARABOT
 * jeloli; egy hasznalt eszkoz is lehet egyedi darab anelkul, hogy elne. A
 * ketto kulon kerdes, es a nevuk se legyen ugyanaz.
 */
export function isWysiwygProduct(
  productCategoryIds: readonly string[],
  wysiwygIds: ReadonlySet<string>,
): boolean {
  return productCategoryIds.some((id) => wysiwygIds.has(id));
}
