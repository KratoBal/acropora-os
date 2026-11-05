/**
 * A JATEKSZABALYZAT ES AZ ADATKEZELESI TAJEKOZTATO VAZLATA (a jatek 4. szelete; a vegleges szoveg Balazse,
 * brief 2026-11-05). KOZVETLENUL A JATEK MUKODESEBOL IRT: azt mondja ki, amit az oldal es az api tenylegesen csinal
 * (hetente egy kerdes, e-mail megerosites, csak a helyes valasz kerul a sorsolasba, nincs hirlevel). MINDEN
 * JOGI ES UZLETI DONTES [KITOLTENDO] JELOLESSEL ALL, nem kitalalt szoveggel: a szervezo adatai, a dijak, az
 * idotartam, a jogalap, a megorzesi ido, az adatfeldolgozok, az erintettek jogai.
 *
 * A LAP A JELOLEST LATHATOAN KIIRJA: egy `[KITOLTENDO]` marker nem mehet ki eles kozzetetelre; a spec megszamolja
 * oket, es a `jogiSzovegVazlat` ellenorzes addig igazat ad, amig akar egy is megmaradt.
 */
export const KITOLTENDO = "[KITÖLTENDŐ";

export type JogiSzakasz = { cim: string; bekezdesek: readonly string[] };

export type JogiDokumentum = {
  azonosito: "jatekszabalyzat" | "adatkezeles";
  cim: string;
  vazlat_jelzes: string;
  szakaszok: readonly JogiSzakasz[];
};

const VAZLAT =
  "VÁZLAT: ez a szöveg még nem végleges. A [KITÖLTENDŐ] jelölésű részeket a szervező tölti ki, addig a játék nem hirdethető meg.";

export const JATEKSZABALYZAT: JogiDokumentum = {
  azonosito: "jatekszabalyzat",
  cim: "Játékszabályzat",
  vazlat_jelzes: VAZLAT,
  szakaszok: [
    {
      cim: "1. A játék szervezője",
      bekezdesek: [
        "[KITÖLTENDŐ: a szervező neve, székhelye, cégjegyzékszáma, adószáma és elérhetősége]",
      ],
    },
    {
      cim: "2. A játék időtartama",
      bekezdesek: [
        "A játékban hetente új kérdés nyílik. Egy kérdésre a nyitás és a zárás között lehet válaszolni.",
        "[KITÖLTENDŐ: a játék első és utolsó napja, a karácsony előtti fődíj-sorsolás időpontja]",
      ],
    },
    {
      cim: "3. Ki vehet részt",
      bekezdesek: [
        "[KITÖLTENDŐ: a részvétel feltételei, az életkori és egyéb korlátozások, a játékból kizártak köre]",
      ],
    },
    {
      cim: "4. Hogyan lehet részt venni",
      bekezdesek: [
        "Hetente egy kérdés érkezik: vagy szabad szöveggel kell válaszolni, vagy a megadott lehetőségek közül kell választani.",
        "A játékos megadja az e-mail-címét és a válaszát. A részvétel akkor érvényes, ha a játékos a kapott levélben lévő megerősítő linkre kattint. A megerősítés a kérdés zárásáig lehetséges.",
        "Egy e-mail-címmel hetente egyszer lehet játszani.",
      ],
    },
    {
      cim: "5. A válasz értékelése",
      bekezdesek: [
        "Csak a helyes válasz kerül a sorsolásba. A játékos a beküldéskor nem kap visszajelzést arról, hogy a válasza helyes-e.",
        "Szöveges válasznál a kis- és nagybetű, az ékezet és a szóközök különbsége nem számít. A kétes esetet a szervező kézzel bírálja el.",
      ],
    },
    {
      cim: "6. A sorsolás",
      bekezdesek: [
        "Minden héten sorsolás van a helyes, megerősített részvételek között. A heti sorsolás rövid videóban látható.",
        "Karácsony előtt fődíj-sorsolás van élő adásban. Aki több héten játszott helyesen és megerősítve, annyiszor szerepel a karácsonyi sorsolás jelöltlistáján, ahány héten ezt megtette.",
        "A jelöltlista, az eredmény és a véletlen mag elmentésre kerül, a sorsolás visszakereshető.",
        "[KITÖLTENDŐ: a heti sorsolások időpontja, a fődíj-sorsolás helye és a közvetítés csatornája]",
      ],
    },
    {
      cim: "7. A nyeremények",
      bekezdesek: [
        "[KITÖLTENDŐ: a heti nyeremény és a fődíj megnevezése, értéke, az átvétel módja, a nyereményhez kapcsolódó adófizetési kötelezettség]",
      ],
    },
    {
      cim: "8. A nyertesek értesítése",
      bekezdesek: [
        "A nyertest a megadott e-mail-címen értesítjük.",
        "[KITÖLTENDŐ: a jelentkezés határideje, és mi történik, ha a nyertes nem jelentkezik]",
      ],
    },
    {
      cim: "9. Adatkezelés",
      bekezdesek: [
        "Az e-mail-címet csak a játékra és a nyertes értesítésére használjuk, hírlevélre nem. A részletek az Adatkezelési tájékoztatóban vannak.",
      ],
    },
    {
      cim: "10. Egyéb rendelkezések",
      bekezdesek: [
        "[KITÖLTENDŐ: kizárás csalás esetén, a szabályzat módosítása, a játék lezárása, a felelősség korlátai, a vitás kérdések rendezése]",
      ],
    },
  ],
};

export const ADATKEZELES: JogiDokumentum = {
  azonosito: "adatkezeles",
  cim: "Adatkezelési tájékoztató",
  vazlat_jelzes: VAZLAT,
  szakaszok: [
    {
      cim: "1. Az adatkezelő",
      bekezdesek: [
        "[KITÖLTENDŐ: az adatkezelő neve, székhelye, elérhetősége, az adatvédelmi kapcsolattartó, ha van]",
      ],
    },
    {
      cim: "2. Milyen adatokat kezelünk",
      bekezdesek: [
        "Az e-mail-címedet, a beküldött válaszodat, azt, hogy melyik kérdésre és mikor küldted be, valamint a megerősítés tényét és idejét.",
        "[KITÖLTENDŐ: a látogató IP-címének kezelése (az oldal a visszaélések elleni sebességkorláthoz továbbadja az API-nak): kezeljük-e, mennyi ideig, és milyen technikai naplók keletkeznek]",
      ],
    },
    {
      cim: "3. Mire használjuk",
      bekezdesek: [
        "A játék lebonyolítására: a beküldések rögzítésére, a részvétel megerősítésére, a sorsolásra és a nyertes értesítésére.",
        "Az e-mail-címedet másra, így hírlevélre sem használjuk. A játékhoz nincs hírlevélre feliratkozás.",
      ],
    },
    {
      cim: "4. Az adatkezelés jogalapja",
      bekezdesek: ["[KITÖLTENDŐ: a jogalap és az indoklása]"],
    },
    {
      cim: "5. Mennyi ideig őrizzük",
      bekezdesek: [
        "[KITÖLTENDŐ: a megőrzési idő a nyertesekre és a nem nyertesekre, a sorsolás nyilvántartásának megőrzése]",
      ],
    },
    {
      cim: "6. Kik kaphatják meg",
      bekezdesek: [
        "[KITÖLTENDŐ: az adatfeldolgozók (tárhely, levélküldés), az esetleges adattovábbítás]",
      ],
    },
    {
      cim: "7. Milyen jogaid vannak",
      bekezdesek: [
        "[KITÖLTENDŐ: a hozzáférés, helyesbítés, törlés, korlátozás és tiltakozás joga, hol és hogyan kérhető, a panasz a felügyeleti hatóságnál]",
      ],
    },
  ],
};

export const JOGI_DOKUMENTUMOK = [JATEKSZABALYZAT, ADATKEZELES] as const;

/** Hány `[KITÖLTENDŐ` jelölés van egy dokumentumban. */
export const kitoltendoDb = (dokumentum: JogiDokumentum): number =>
  dokumentum.szakaszok
    .flatMap((s) => [s.cim, ...s.bekezdesek])
    .reduce((db, szoveg) => db + szoveg.split(KITOLTENDO).length - 1, 0);

/** Igaz, amig akar egy `[KITÖLTENDŐ` jelölés megmaradt: ez a szöveg NEM mehet ki élesre. */
export const jogiSzovegVazlat = (): boolean =>
  JOGI_DOKUMENTUMOK.some((d) => kitoltendoDb(d) > 0);
