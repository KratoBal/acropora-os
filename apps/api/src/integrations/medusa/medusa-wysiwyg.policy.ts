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
  const gyerekek = new Map<string, string[]>();
  for (const kategoria of categories) {
    if (!kategoria.parentId) continue;
    const lista = gyerekek.get(kategoria.parentId);
    if (lista) lista.push(kategoria.id);
    else gyerekek.set(kategoria.parentId, [kategoria.id]);
  }

  const eredmeny = new Set<string>();
  const sor = categories
    .filter(
      (kategoria) =>
        kategoria.name.trim().toLowerCase() ===
        WYSIWYG_CATEGORY_NAME.toLowerCase(),
    )
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
  return !productCategoryIds.some((id) => wysiwygIds.has(id));
}
