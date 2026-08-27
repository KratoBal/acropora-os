/**
 * KÉR-E EZ A KÉSZÜLÉK ÉRTESÍTÉST -- a döntés, a tárolástól külön.
 *
 * A tárolás natív (`expo-secure-store`), tehát `node --test` alatt nem
 * futtatható; a DÖNTÉS viszont igen, és pont az a rész, amit el lehet rontani.
 * Ugyanaz a szétválasztás, mint az auth rétegben: az adapter külön, a szabály
 * mérhetően.
 */

export type PushPreference = "on" | "off";

/**
 * A BEÁLLÍTATLAN ÁLLAPOT BEKAPCSOLTAT JELENT, és ez nem kényelmi döntés.
 *
 * A telefon ma is regisztrál magától az első bejelentkezéskor, és a munkalap
 * kiosztásáról szóló értesítés az egyetlen, ami a szerelőt a helyszínen eléri.
 * Ha a hiányzó beállítás kikapcsoltat jelentene, akkor mindenki, aki a
 * kapcsolóhoz soha nem nyúl, CSENDBEN esne ki az értesítésekből -- és épp az
 * a fajta hiba, ami nem hibázik, csak nem történik meg semmi.
 */
export function pushEnabled(preference: PushPreference | null): boolean {
  return preference !== "off";
}

/**
 * REGISZTRÁLJON-E MOST a készülék.
 *
 * Két feltétel, és mindkettő kell: legyen bejelentkezett kolléga (a szerver a
 * munkamenetből veszi a gazdát), és ne legyen kikapcsolva a kapcsoló. A
 * bejelentkezés hiánya nem "kikapcsolt" állapot: kijelentkezve nincs kihez
 * kötni a készüléket.
 */
export function shouldRegisterPush(input: {
  authenticated: boolean;
  preference: PushPreference | null;
}): boolean {
  return input.authenticated && pushEnabled(input.preference);
}
