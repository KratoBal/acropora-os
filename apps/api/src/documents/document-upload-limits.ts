/**
 * MENNYIT FOGAD EL EGY DOKUMENTUM-FELTOLTES: DARAB ES MERET, EGY HELYEN.
 *
 * === MIERT KERULT IDE (3420fef3) ===
 *
 * A keret HAROM feluleten allt, egymastol fuggetlenul: a munkalapon, az
 * eszkozon es a hibajegyen. Mind a harom ugyanazt a ket szamot mondta (tiz
 * fajl, tiz megabajt), harom kulon neven, harom kulon fajlban -- es a kartya
 * szerint mar HAROMSZOR kellett oket EGYSZERRE javitani.
 *
 * A KARTYA CIME KETTOT MONDOTT, ES HAROM VOLT. Ez nem apro elteres: aki a
 * cimre hagyatkozik, ket helyet javit, a harmadik csendben ottmarad, es a keret
 * ugyanugy ketfele lesz -- csak mas bontasban. A szam a kartyan is javitva.
 *
 * === MIERT EGY ERTEK, ES NEM HAROM, AMIT EGYUTT TARTUNK ===
 *
 * Harom nevesitett konstans, ami mindig ugyanazt az erteket viseli, azt IGERI,
 * hogy kulon allithatoak -- es pont ezert csusznak el. Egy ertek viszont
 * KIMONDJA, hogy ez EGY szabaly: ha valaha egy felulet mast kap, az kulon
 * dontes lesz, nem egy elfelejtett sor.
 *
 * === A SZORZAT A VALODI HATAR, NEM A KET SZAM KULON ===
 *
 * A fajlok a MEMORIABAN gyulnek (`memoryStorage`), tehat egy keres legrosszabb
 * esete a darabszam es a meret SZORZATA: tiz kep tiz megabajttal szaz megabajt
 * egyetlen keresben. Ezert all a ketto egy objektumban: aki az egyiket emeli,
 * lassa a masikat is.
 *
 * === AMI IDE SZANDEKOSAN NEM TARTOZIK ===
 *
 * A leltar-import es az UNAS-import 25 megabajtos kerete MAS keret, nem ennek a
 * masolata: ott EGY fajl erkezik, es nem kep, hanem tablazat. Osszevonni oket
 * annyi lenne, mint azt allitani, hogy a ket korlat ugyanarrol szol.
 */
export const DOCUMENT_UPLOAD_LIMITS = {
  /** Hany fajl mehet egy keresben. */
  files: 10,
  /** Egy fajl felso merete, bajtban. */
  fileSizeBytes: 10 * 1024 * 1024,
} as const;
