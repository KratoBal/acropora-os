/**
 * A LEVEL FEJLECEIBE NEM KERULHET SORTORES -- ES EZ NEM SZEPSEGHIBA.
 *
 * === A MERT VESZELY, A SAJAT FRISS KODOMBAN (nautilus, 2026-09-21) ===
 *
 * A level targya a sablonbol renderelodik, es a `{{jegy_targya}}` valtozo a
 * jegy CIMET teszi bele. A cim korlatja a
 * `CreateServiceJobDto`-ban `@IsString() @MinLength(1) @MaxLength(300)` --
 * SORTORES-KORLAT NELKUL (ismert pozitiv kontroll: a `@Matches` mas mezokon
 * letezik, tehat a kereses lat).
 *
 * Vagyis egy `\r\n` a jegy cimeben UJ FEJLECET tudna irni a levelbe: egy
 * `Bcc:` sort egy idegen cimre. A cimet ember irja be a rendszerunkbe, tehat
 * ez KULSO ADAT egy protokoll-fejlecben.
 *
 * === MIERT KET RETEGBEN VEDJUK, ES MIERT KET KULON ALLITASSAL ===
 *
 * acrobot kikotese (2026-09-21) a naplo-sorrol ugyanezt mondta ki: "a ketto
 * kulon elromolhat". Itt is:
 *
 *   a SZOLGALTATAS      tisztitsa a targyat, mielott fejlecce valik
 *   a KULDO             utasitsa el, ha megis kap sortorest tartalmazot
 *
 * Az elso a helyes viselkedes, a masodik az, ami akkor is all, ha valaki egy
 * MASIK osszeallitot ir melle, es elfelejti. A ket allitas kulon all.
 */

/** Sortores (CR, LF) es NUL: ezek tudnak fejlecet nyitni vagy elvagni. */
const FEJLEC_TILTOTT = /[\r\n\u0000]/;

export function hasHeaderInjection(value: string): boolean {
  return FEJLEC_TILTOTT.test(value);
}

/**
 * A FEJLEC-ERTEK BIZTONSAGOS ALAKJA: a sortores SZOKOZRE valt, nem tunik el.
 *
 * NEM TORLES, ES EZ SZANDEKOS: ha a sortorest egyszeruen kivennenk, ket szo
 * osszeragadna ("Szivattyu zugBcc: ..."), es a Targy CSENDBEN mast mondana.
 * Szokozzel a szoveg olvashato marad, es a tamadasi kiserlet is LATSZIK benne.
 */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n\u0000]+/g, " ").trim();
}
