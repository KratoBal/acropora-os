import type { DocumentOwner } from "./document-store.js";

/**
 * MENNYI HELYET SZABADITANA FEL A SOROKBAN ALLO DOKUMENTUMOK ATHELYEZESE.
 *
 * A kerdes MERETLEN volt (kartya 8f606437), es nem azert, mert nehez: a valasz
 * nem a kodban all, hanem az ADATBAN -- es a fejlesztoi konteneribol az eles
 * adatbazis halozatilag nem erheto el. Ez tehat nem jogosultsagi kerdes es nem
 * hianyzo eszkoz volt, hanem az, hogy a PARANCS nem letezett.
 *
 * Ezert ez a modul a SZAMOLAST irja le, tisztan -- a lekerdezes a CLI-ben all.
 * Aki eleri az adatbazist, egy parancsot futtat, nem kutatast vegez.
 *
 * === MIERT A `sizeBytes`, ES NEM A `length(content)` ===
 *
 * Mind a harom tabla sajat `sizeBytes` oszlopot visel, amit a feltoltes ir. A
 * nyers `length(content)` UGYANAZT adna, csak dragabban (a teljes bajtsort be
 * kellene olvasni), es egy olyan sornal, ahol a ketto ELTER, epp az elteres a
 * lelet -- azt viszont nem ez a jelentes hivatott megtalalni.
 *
 * === ES AMIT A SZAM NEM MOND MEG ===
 *
 * Az adatbazis-fajl MERETE nem ennyivel csokken. A `Bytes` oszlop nagy erteket
 * a Postgres TOAST-ban tarolja es tomoriti, a torles pedig a helyet a tablanak
 * hagyja, amig `VACUUM FULL` nem fut. Ez a jelentes a NYERS TARTALOM
 * osszmeretet mondja meg -- azt, amennyi ATKERULNE a tarolora --, nem a
 * felszabadulo lemezteruletet. A ketto osszekeverese pontosan az a fajta
 * allitas, amit a kartya meg akar elozni.
 */

export type SorOsszegzes = {
  owner: DocumentOwner;
  /**
   * CSAK A SORBAN: van tartalom, es NINCS tarolo-kulcs. Ezeket TENYLEG at kell
   * helyezni ahhoz, hogy a hely felszabaduljon.
   */
  sorbanAllo: number;
  sorbanAlloBajt: number;
  /**
   * UGYANAZ A HALMAZ, DE A VALODI BAJTHOSSZBOL (`octet_length(content)`).
   *
   * A `sizeBytes` oszlopot a feltoltes irja; a MAI iro ut a valodi hosszbol
   * veszi, tehat egy elteres csak REGI sorokrol szolhat -- es ez a jelentes pont
   * azokrol szol. Egyszer fog lefutni, egy kilenc napja varo jelszo mogul: ha
   * egyszer fut, hozza el mind a kettot. Ahol a ketto ELTER, ott a kulonbseg
   * maga a lelet.
   */
  sorbanAlloNyersBajt: number;
  /**
   * MINDKET HELYEN: a tartalom MAR atkerult a tarolora, es a soros peldany
   * MEGIS ott all. EZ A KARTYA LEGOLCSOBB FELE -- ezekhez semmilyen athelyezes
   * nem kell, a sorbeli masolat MA torolheto.
   *
   * A ket halmazt azert kell KULON szamolni, mert a teendojuk MAS: az elsohoz
   * egy athelyezes kell, a masodikhoz egy `UPDATE ... SET content = NULL`. Egy
   * kozos szamban a ketto osszeadodna, es a dontes a dragabb feltevesbol
   * indulna.
   */
  mindketHelyen: number;
  mindketHelyenBajt: number;
  mindketHelyenNyersBajt: number;
  /** MAR CSAK A TAROLON: a rendes vegallapot. A nevezo, ami nelkul a szam ertelmezhetetlen. */
  csakTarolon: number;
  /**
   * EGYIK HELYEN SEM -- se tartalom, se kulcs. Ha ilyen van, az NEM
   * athelyezesi kerdes, hanem serult sor: a `exactly_one_content_source`
   * megkotes epp ezt zarja ki, tehat egy nem-nulla szam itt LELET.
   */
  egyikSem: number;
};

export type InlineJelentes = {
  soronkent: SorOsszegzes[];
  osszesSorbanAllo: number;
  osszesSorbanAlloBajt: number;
  osszesSorbanAlloNyersBajt: number;
  osszesMindketHelyen: number;
  osszesMindketHelyenBajt: number;
  osszesMindketHelyenNyersBajt: number;
  osszesCsakTarolon: number;
  osszesEgyikSem: number;
};

/**
 * A NEVEZO IS A JELENTES RESZE. Egy "1200 sor, 3,4 GB" onmagaban nem mondja meg,
 * hogy az a katalogus fele vagy a szazaleke -- es a dontes (athelyezzuk-e) epp
 * ezen mulik.
 */
export function inlineJelentes(sorok: readonly SorOsszegzes[]): InlineJelentes {
  const ossz = (mit: (s: SorOsszegzes) => number) =>
    sorok.reduce((eddig, s) => eddig + mit(s), 0);
  return {
    soronkent: [...sorok],
    osszesSorbanAllo: ossz((s) => s.sorbanAllo),
    osszesSorbanAlloBajt: ossz((s) => s.sorbanAlloBajt),
    osszesSorbanAlloNyersBajt: ossz((s) => s.sorbanAlloNyersBajt),
    osszesMindketHelyen: ossz((s) => s.mindketHelyen),
    osszesMindketHelyenBajt: ossz((s) => s.mindketHelyenBajt),
    osszesMindketHelyenNyersBajt: ossz((s) => s.mindketHelyenNyersBajt),
    osszesCsakTarolon: ossz((s) => s.csakTarolon),
    osszesEgyikSem: ossz((s) => s.egyikSem),
  };
}

/** Ember szamara olvashato meret. A jelentes a NYERS bajtszamot is kiirja mellette. */
export function olvashatoMeret(bajt: number): string {
  if (bajt < 1024) return `${bajt} B`;
  const egysegek = ["kB", "MB", "GB", "TB"];
  let ertek = bajt / 1024;
  let i = 0;
  while (ertek >= 1024 && i < egysegek.length - 1) {
    ertek /= 1024;
    i += 1;
  }
  return `${ertek.toFixed(1)} ${egysegek[i]}`;
}
