/**
 * KI KAPJON ERTESITEST EGY DELEGALASROL -- ES AKI EPP KIOSZT, AZ NEM.
 *
 * === A HIBA, AMIT EZ JAVIT ===
 *
 * A jegy delegaltjainak listaja eddig VALTOZATLANUL ment az ertesitonek, tehat
 * aki magat is rátette a jegyre, SAJAT TETTEROL kapott pusht -- masodperceken
 * belul azutan, hogy megnyomta a gombot.
 *
 * === A DONTES, AMI EBBEN NEM KOVETKEZMENY ===
 *
 * Aki SAJAT MAGAT osztja ki, NE kapjon ertesitest (acrobot dontese,
 * 2026-09-21). Ez nem a hibabol kovetkezik: lehetne ugy is, hogy mindenki kap,
 * aki a listan all, es akkor a sajat nev is jarna. A valasztas indoka egy
 * mondat: aki epp most nyomta meg a gombot, TUDJA.
 *
 * Ezert all ra kulon allitas is. Egy dontes, amit csak a kod mond ki, a
 * kovetkezo olvasonak kovetkezmenynek latszik, es barmikor "egyszerusitheto".
 *
 * === AMIT EZ A FUGGVENY SZANDEKOSAN NEM TUD ===
 *
 * Nem ismeri a KET hivohely kulonbseget. A felvitelnel a teljes uj nevsor
 * erkezik, a kesobbi atszervezesnel CSAK a hozzaadottak -- a szures szabalya
 * ugyanaz, a BEMENET jelentese nem. Ezert a hivo adja be, mit szurjon, es
 * ezert all mind a ket hivohelyre KULON allitas: egy kozos helper mogott
 * konnyu osszemosni oket, es akkor egy rontas mind a kettot elviszi.
 */
export function ertesitendoDelegaltak(input: {
  /** Akik a hivo szerint ertesitest kapnanak. */
  jeloltek: readonly string[];
  /** Aki a muveletet vegzi. */
  cselekvo: string;
}): string[] {
  return input.jeloltek.filter((id) => id !== input.cselekvo);
}
