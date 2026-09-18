/**
 * MELYIK VALTOZATOT KERI A HIVO EGY CSATOLMANY BAJTJAIBOL.
 *
 * === MIERT A KOZOS CSOMAGBAN, ES NEM A SZERVEREN ===
 *
 * Ez a szoveg a HALOZATON megy at: a kliens beirja a keresbe, a szerver
 * osszeveti. Ha a ket oldal kulon-kulon irna le, egy elgepeles NEM hibazna --
 * a szerver egyszeruen az eredetit adna vissza, es a csempe tovabbra is a
 * teljes meretu fajlt toltene le. Semmi nem allna meg, semmi nem szolna, csak
 * a megtakaritas maradna el.
 *
 * Egy definiciobol ez forditasi kerdesse valik: aki elgepeli, nem fordul le.
 *
 * === A MOBIL MASOLATA KULON ALL, ES EZ NEM KIVETEL ===
 *
 * Az `apps/mobile` szandekosan kivul van a workspace-en, es a valasz-tipusait
 * KEZZEL masolja. Ott tehat ez az ertek megismetlodik -- azt a masolatot a
 * `mobile-response-mirror` halo veti ossze ezzel a forrassal.
 */
export const DOCUMENT_THUMBNAIL_VARIANT = "thumbnail";

/**
 * A KERES-PARAMETER NEVE. Kulon all az ERTEKTOL, mert a ket oldal ket
 * kulonbozo helyen hasznalja: a szerver a parameter NEVET olvassa, a kliens a
 * cimbe irja -- es egy elgepelt nev ugyanolyan nema, mint egy elgepelt ertek.
 */
export const DOCUMENT_VARIANT_PARAM = "variant";
