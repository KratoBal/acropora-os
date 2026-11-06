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
  /** A vázlat-jelzés: csak a még nem végleges dokumentumon áll; a végleges szövegen nincs. */
  vazlat_jelzes?: string;
  szakaszok: readonly JogiSzakasz[];
};

const VAZLAT =
  "VÁZLAT: ez a szöveg még nem végleges. A [KITÖLTENDŐ] jelölésű részeket a szervező tölti ki, addig a játék nem hirdethető meg.";

export const JATEKSZABALYZAT: JogiDokumentum = {
  azonosito: "jatekszabalyzat",
  cim: "Játékszabályzat",
  // A SZABÁLYZAT VÉGLEGES: Balázs szövege, szó szerint (exchange/jatek/Jatekszabalyzat-balazs-2026-11-06.docx, 2026-11-06 09:06 UTC);
  // nincs rajta vázlat-jelzés, és nincs benne [KITÖLTENDŐ].
  szakaszok: [
    {
      cim: "1. A játék szervezője",
      bekezdesek: [
        "Acropora Kft.",
        "1106 Budapest Pesti Gábor utca 35",
        "Adószám: 23916229-2-42",
        "info@acropora.hu",
      ],
    },
    {
      cim: "2. A játék időtartama",
      bekezdesek: [
        "A játékban hetente új kérdés nyílik. Egy kérdésre a nyitás és a zárás között lehet válaszolni.",
        "A játék 2026 november 7-én 22:00 órakor kezdődik.",
        "Az első hét kérdésére 2026 november 14 21:00-ig lehet választ beküldeni.",
        "A második hét kérdése 2026 november 14 22:00 órakor jelenik meg és 2026 november 21 21:00 óráig lehet válaszolni.",
        "A harmadik hét kérdése 2026 november 21 22:00 órakor jelenik meg és 2026 november 28 21:00 óráig lehet válaszolni.",
        "A negyedik hét kérdése 2026 november 28 22:00 órakor jelenik meg és 2026 december 5 21:00 óráig lehet válaszolni.",
        "Az ötödik hét kérdése 2026 december 5 22:00 órakor jelenik meg és 2026 december 12 21:00 óráig lehet válaszolni.",
        "Az hatodik hét kérdése 2026 december 12 22:00 órakor jelenik meg és 2026 december 19 21:00 óráig lehet válaszolni.",
        "Az hetedik hét kérdése 2026 december 19 22:00 órakor jelenik meg és 2026 december 26 21:00 óráig lehet válaszolni.",
        "A Fődij sorsolása 2026 december 26-án este 22:00 órakor történik.",
      ],
    },
    {
      cim: "3. Ki vehet részt",
      bekezdesek: [
        "A játékban bárki résztvehet, aki a játék kezdetekor betöltötte a 18. életévét. A játékban az Acropora Kft. dolgozói és családtagjai nem vehetnek részt.",
      ],
    },
    {
      cim: "4. Hogyan lehet részt venni",
      bekezdesek: [
        "Hetente egy kérdés érkezik: vagy szabad szöveggel kell válaszolni, vagy a megadott lehetőségek közül kell választani.",
        "A játékos megadja a nevét, az e-mail-címét és a válaszát. A részvétel akkor érvényes, ha a játékos a kapott levélben lévő megerősítő linkre kattint. A megerősítés a kérdés zárásáig lehetséges.",
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
        "Minden héten sorsolás van a helyes, megerősített részvételek között.",
        "Aki több héten játszott helyesen és megerősítve, annyiszor szerepel a karácsonyi sorsolás jelöltlistáján, ahány héten ezt megtette.",
        "A jelöltlista, az eredmény és a véletlen mag elmentésre kerül, a sorsolás visszakereshető.",
        "Ha egy sorsolást újra lefuttatnak, mindig az első, rögzített eredmény számít; az újrafuttatás csak ellenőrzés.",
        "A játék 2026 november 7-én 22:00 órakor kezdődik.",
        "Az első hét kérdésére 2026 november 14 21:00-ig lehet választ beküldeni.",
        "A második hét kérdése 2026 november 14 22:00 órakor jelenik meg és 2026 november 21 21:00 óráig lehet válaszolni.",
        "A harmadik hét kérdése 2026 november 21 22:00 órakor jelenik meg és 2026 november 28 21:00 óráig lehet válaszolni.",
        "A negyedik hét kérdése 2026 november 28 22:00 órakor jelenik meg és 2026 december 5 21:00 óráig lehet válaszolni.",
        "Az ötödik hét kérdése 2026 december 5 22:00 órakor jelenik meg és 2026 december 12 21:00 óráig lehet válaszolni.",
        "Az hatodik hét kérdése 2026 december 12 22:00 órakor jelenik meg és 2026 december 19 21:00 óráig lehet válaszolni.",
        "Az hetedik hét kérdése 2026 december 19 22:00 órakor jelenik meg és 2026 december 26 21:00 óráig lehet válaszolni.",
        "A Fődij sorsolása 2026 december 26-án este 22:00 órakor történik.",
      ],
    },
    {
      cim: "7. A nyertesek értesítése",
      bekezdesek: ["A nyertest a megadott e-mail-címen értesítjük."],
    },
    {
      cim: "8. Adatkezelés",
      bekezdesek: [
        "Az e-mail-címet csak a játékra és a nyertes értesítésére használjuk, hírlevélre nem. A részletek az Adatkezelési tájékoztatóban vannak.",
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
