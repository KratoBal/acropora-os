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
  /**
   * EZ A MONDAT AT VAN IRVA (2026-09-17), ES A FENTI BEKEZDES ELORE MEGMONDTA.
   *
   * Korabban azt allt itt, hogy a fenykep "most nem tölthető fel", es hogy
   * terero kell hozza. A fejlec kimondta, hogy ez a JELEN allapotrol szol, es
   * "akkor ez az ág egyszerűen nem áll elő többé", amikor a kepesseg megjon.
   *
   * A KEPESSEG MEGJOTT, AZ AG VISZONT ELOALL: a mentett masolat allapota
   * megmarad. Ezert nem a feltetelt vettuk ki, hanem a MONDATOT irtuk at --
   * kulonben epp azt tiltana, amiert a sor keszult.
   */
  photo:
    "Mentett másolatot nézel. A fénykép így is felvehető: a telefonon vár, és magától felmegy, amint visszajön a hálózat.",
} as const;
