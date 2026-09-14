/**
 * EGY FAJL MERETE, EMBERI ALAKBAN.
 *
 * KOZOS FUGGVENY, NEM KET MASOLAT. 2026-09-14-ig ez a szamitas az eszkoz
 * reszletlapjanak aljan allt, helyi segedfuggvenykent -- es a hibajegy
 * csatolmanyaihoz ugyanez kellett volna masodszor is. Ket peldany ugyanarrol a
 * kerekitesrol addig egyezik, amig valaki az egyiket "pontositja": onnantol
 * UGYANAZ a fajl KET kulonbozo meretet mutatna ket kepernyon, es a felhasznalo
 * nem tudna, melyik igaz.
 *
 * A HATAR ES A KEREKITES SZANDEKOS, es nem kozmetika:
 *
 *   `Math.max(1, ...)`  egy par szaz bajtos fajl `0 kB` alakban ugy nezne ki,
 *                       mintha URES lenne -- holott van benne tartalom. A
 *                       "kisebb, mint amit merunk" es a "semmi" ket kulonbozo
 *                       allapot, es csak az egyik baj.
 *   egy tizedes MB-nal  a megabajtos tartomanyban a pontos bajtszam nem mond
 *                       tobbet, csak hosszabb.
 */
export function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} kB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
