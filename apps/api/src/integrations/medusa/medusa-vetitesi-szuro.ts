/**
 * A VETITESI SZURO: MEGMERT, TEVES GYARTOI CIKKSZAM-ERTEKEK VISSZATARTASA.
 *
 * === MIT SZUR, ES MIERT NEM A FORRASBAN JAVITJUK ===
 *
 * A UNAS "Gyartoi cikkszam" mezoje szazhetven soron egy MASIK sajat termekunk
 * cikkszamat tartalmazza (polip merese, 2026-09-10). Ebbol nyolcvannegy sor
 * bizonyithatoan hibas, es a lista mellettuk INDOKOT is visel.
 *
 * Az elo UNAS-ba NEM irunk: az esetenkenti engedelyt kivan, es nem
 * visszaforditható. A vetites viszont SZURES -- ha a forrasban javul az ertek,
 * a szuro magatol hatastalanna valik.
 *
 * === MIERT PAROS EGYEZES, ES NEM CSAK AZ ERTEK ===
 *
 * A tiltas nem az ERTEK tulajdonsaga: ugyanaz a vonalkod egy MASIK terméken
 * helyes lehet -- sot, a legtobb esetben van is jogos gazdaja. Ezert a lista
 * PART tart nyilvan (cikkszam + hibas ertek), es a szuro csak akkor sul el, ha
 * MIND A KETTO egyezik.
 *
 * ENNEK EGY MASODIK HASZNA IS VAN, ES EZ A FONTOSABB: a szuro MAGATOL LEJAR.
 * Ha valaki a forrasban kijavitja az erteket, a par nem egyezik tobbe, es a
 * termek uj kodja akadalytalanul kimegy. Egy csak-cikkszamra szuro lista
 * ezzel szemben orokre nemava tenne azt a terméket.
 *
 * === MIT NEM SZUR, ES EZ SZANDEKOS ===
 *
 * Az AI termekkereso (collectArticleNumbers) tovabbra is FELVESZI a mezot a
 * cikkszam-savba, szuretlenul. Ez NEM kovetkezetlenseg: ott egy valodi
 * gyartoi keszletkod HASZNOS kereso-kulcs (a vevo a gyarto adatlapjarol
 * masolja), es egy teves ertek ott legrosszabb esetben egy folosleges
 * talalatot ad -- mig a boltban egy teves EAN GLOBALIS azonositot allit egy
 * termekrol.
 *
 * A ket fogyaszto tehat ket kulonbozo szabalyt kap, mert a KAR alakja is mas.
 * (acrobot dontese, 2026-09-10.)
 */

/** Egy sor a listabol: a mi cikkszamunk es az az ertek, ami nem az ove. */
export type TiltottKodParos = {
  sku: string;
  /** A "Gyartoi cikkszam" mezo megmert, teves erteke. */
  ertek: string;
};

/**
 * A KULCS ALAKJA. Trimmel, mert a forrasban all szokoz, es kis-nagybetu
 * erzekeny MARAD: egy vonalkod szamjegyekbol all, a cikkszamainkban viszont
 * van betu is (AF_starterpack), es ott a kis-nagybetu megkulonbozteto.
 */
function kulcs(sku: string, ertek: string): string {
  return `${sku.trim()} ${ertek.trim()}`;
}

/**
 * A LISTA INDEXELESE. Egyszer fut le, es a kereses utana O(1).
 *
 * Az ures vagy hianyos sorok KIMARADNAK, es ez nem ovatoskodas: egy ures
 * ertek mezo ures kulcsot adna, es akkor a szuro MINDEN ertek nelkuli
 * termeket eltalalna -- pontosan az a fajta nema tulszures, amit egy
 * darabszamon nem lehet eszrevenni.
 */
export function indexelTiltoLista(
  sorok: readonly TiltottKodParos[],
): ReadonlySet<string> {
  const ki = new Set<string>();
  for (const sor of sorok) {
    const s = (sor?.sku ?? "").trim();
    const e = (sor?.ertek ?? "").trim();
    if (!s || !e) continue;
    ki.add(kulcs(s, e));
  }
  return ki;
}

/**
 * A DONTES. Csak allapot megy be, csak igen/nem jon ki -- adatbazis nelkul
 * merheto, ugyanabbol az okbol, amiert a vonalkod-szabaly is kulon all.
 */
export function tiltottKod(
  sku: string | null | undefined,
  ertek: string | null | undefined,
  index: ReadonlySet<string>,
): boolean {
  const s = (sku ?? "").trim();
  const e = (ertek ?? "").trim();
  if (!s || !e) return false;
  return index.has(kulcs(s, e));
}

/**
 * A LISTA BETOLTESE -- ES EZ AZ EGYETLEN HELY, AHOL A FORRAS SZAMIT.
 *
 * MA URES, ES EZT HANGOSAN KIMONDJA. Egy szuro, ami csendben nem szur,
 * rosszabb a hianyzo szuronel: a naplo ugyanugy nez ki, mintha egyetlen
 * ertek sem akadt volna fenn.
 *
 * A LISTA HELYE MEG DONTES ALATT ALL (murena kerdese acrobotnak, 2026-09-10):
 * beegetve a repoba, vagy kulso fajlbol. A ket alak ara kulonbozik --
 * beegetve a valtozas DIFF-ben latszik, kulso fajlnal a repo tiszta marad,
 * cserebe a hiany nema lehet. Ez a fuggveny azert all kulon, hogy a dontes
 * EGY fuggveny torzsere szukuljon, es semmi mas ne mozduljon tole.
 */
export function betoltTiltoLista(out: {
  stdout: (text: string) => void;
}): ReadonlySet<string> {
  const sorok: readonly TiltottKodParos[] = [];
  const index = indexelTiltoLista(sorok);
  if (index.size === 0) {
    out.stdout(
      "A vetítési szűrő listája ÜRES: egyetlen érték sem lesz visszatartva. " +
        "Ez nem hiba, hanem a mai állapot -- a lista helye még döntés alatt.\n",
    );
  } else {
    out.stdout(`A vetítési szűrő listája ${index.size} párost tart.\n`);
  }
  return index;
}
