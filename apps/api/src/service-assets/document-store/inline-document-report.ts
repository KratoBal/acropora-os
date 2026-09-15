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
  /** Sorok, amikben MA a tartalom all (nincs `storageKey`). */
  sorbanAllo: number;
  /** Azok osszmerete a sajat `sizeBytes` oszlopuk szerint. */
  sorbanAlloBajt: number;
  /** Sorok, amik MAR a tarolon vannak -- a nevezo, ami nelkul a szam ertelmezhetetlen. */
  tarolon: number;
};

export type InlineJelentes = {
  soronkent: SorOsszegzes[];
  osszesSorbanAllo: number;
  osszesSorbanAlloBajt: number;
  osszesTarolon: number;
};

/**
 * A NEVEZO IS A JELENTES RESZE. Egy "1200 sor, 3,4 GB" onmagaban nem mondja meg,
 * hogy az a katalogus fele vagy a szazaleke -- es a dontes (athelyezzuk-e) epp
 * ezen mulik.
 */
export function inlineJelentes(sorok: readonly SorOsszegzes[]): InlineJelentes {
  return {
    soronkent: [...sorok],
    osszesSorbanAllo: sorok.reduce((ossz, s) => ossz + s.sorbanAllo, 0),
    osszesSorbanAlloBajt: sorok.reduce((ossz, s) => ossz + s.sorbanAlloBajt, 0),
    osszesTarolon: sorok.reduce((ossz, s) => ossz + s.tarolon, 0),
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
