/**
 * MIT MOND A LAP, AMIKOR MENTETT MÁSOLATOT NÉZ.
 *
 * === MIÉRT KÜLÖN MODUL, KÉT SZÖVEG MIATT ===
 *
 * Mert a lapon KÉT művelet esik ki térerő nélkül, és a kettőnek EGYFORMÁN kell
 * viselkednie. A hibajegy-képernyő első alakjában nem így volt: a léptetés
 * kimondta, miért nem megy, a fénykép-szakasz viszont EGYETLEN SZÓ NÉLKÜL
 * eltűnt. Két kihagyás egy képernyőn, két különböző viselkedéssel -- és a
 * másodikat semmi nem mérte.
 *
 * Itt a szövegek ADATOK, nem beágyazott szövegek a jelölésben: így egy állítás
 * meg tudja nézni, hogy a képernyő MIND A KETTŐT használja.
 *
 * === AZ ALAKJUK A JELEN ÁLLAPOTRÓL SZÓL, NEM A VILÁGRÓL ===
 *
 * Nem azt mondják, hogy „térerő nélkül nem lehet fényképet rögzíteni" -- az
 * ÁLTALÁNOS állítás lenne, és hazudni kezdene abban a percben, amikor az
 * offline fényképezés elkészül. Azt mondják, hogy MOST, EZEN a lapon, amit épp
 * nézel, miért nem megy. Ez akkor is igaz marad, ha a képesség egyszer megjön:
 * akkor ez az ág egyszerűen nem áll elő többé.
 */
export const OFFLINE_COPY_NOTICE = {
  /** A léptetés kiesik: a szerver a LÁTOTT állapotra ír feltételesen. */
  step: "Mentett másolatot nézel, ezért a léptetés most nem megy. A jegy állapotát térerőnél tudod átírni.",
  /** A feltöltés kiesik: a kép a szerverre megy, nem a másolatba. */
  photo:
    "Mentett másolatot nézel, ezért a fénykép most nem tölthető fel. Térerőnél tudsz képet tenni a jegyre.",
  /**
   * A FELIRAT KIESIK: egy MÁR FELTÖLTÖTT sorra ír, és az a szerveren áll.
   *
   * A sorba tenni MÁS kérdés lenne, mint a fénykép: a felirat egy létező
   * rekordot módosít, tehát harmadik sorfajta kellene hozzá. Amíg nincs, ez a
   * mondat mondja ki, miért nem megy -- egy letiltott mező enélkül ugyanúgy néz
   * ki, mint egy elromlott.
   */
  caption:
    "Mentett másolatot nézel, ezért a felirat most nem írható. Térerőnél tudod megnevezni a képet.",
} as const;
