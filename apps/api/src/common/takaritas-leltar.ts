/**
 * A TAKARITAS EGYSZER SZOL, ES MINDENT FELSOROL, AMI BENT MARADT.
 *
 * ELOZMENY, ES EZ NEM ELMELETI. A huszonharom integracios suite takaritasa
 * eddig kulon `assert.equal(..., 0, "...")` hivasokkal allitotta, hogy nem
 * maradt sor. Az `after` hook viszont AZ ELSO dobo allitasnal megall, tehat
 * fajlonkent csak az ELSO szamlalo sult el -- merve (verify run 34999054554):
 * tizenhat fajl takaritasat kikapcsolva mind a tizenhat pirosra valtott, de a
 * naploban csak TIZENOT allitas-bukas allt, nem negyvenharom.
 *
 * KET DOLGOT JAVIT EGYSZERRE, ES A MASODIK A FONTOSABB:
 *
 *   a MERESBEN   egy fajlonkenti rontas mostantol MINDEN szamlalot elsut, tehat
 *                egy kor meg tudja mondani, melyik szamlalo nem mer semmit
 *   a HASZNALATBAN  egy VALODI szivargasnal a kezelo eddig az ELSO tablat latta,
 *                es a javitas utan derult ki, hogy volt masik ketto is
 *
 * A NEV NEM DISZ: a kimenet abbol olvashato vissza, hany szamlalo sult el
 * egyaltalan. Ha egy fajl harom szamlalot ismer es kettot sorol fel, a harmadik
 * nem mer semmit -- es ebben az alakban ez az EGYETLEN jel rola, mert a hook
 * tobbe nem all meg az elsonel. A hallgatas itt nem zold, hanem vak folt.
 */

export type Maradek = {
  /** Emberi nev, ami a naploban is azonosit: tabla plusz a szures tengelye. */
  nev: string;
  darab: number;
};

/**
 * DOB, HA BARMELYIK SZAM NEM NULLA -- es a hibauzenet MINDET felsorolja.
 *
 * ES A NULLA-HOSSZU BEMENET IS DOB. Egy ures lista azt jelentene, hogy a hivo
 * egyetlen szamlalot sem adott at; az allitas ilyenkor SOHA nem tudna elbukni,
 * es pontosan ugy nezne ki, mint egy tiszta takaritas. Egy gyujto, ami mindig
 * ures listat kap, csendben kikapcsolja magat.
 */
export function nincsMaradek(sorok: readonly Maradek[]): void {
  if (sorok.length === 0)
    throw new Error(
      "A takaritas-leltar URES: egyetlen szamlalot sem kapott. " +
        "Egy ures leltar nem tud elbukni, tehat nem allit semmit.",
    );

  const bent = sorok.filter((sor) => sor.darab > 0);
  if (bent.length === 0) return;

  throw new Error(
    `A takaritas utan ${bent.length} tablaban maradtak sorok:\n` +
      bent.map((sor) => `  - ${sor.nev}: ${sor.darab}`).join("\n"),
  );
}
