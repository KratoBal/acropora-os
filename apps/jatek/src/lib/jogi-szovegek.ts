/**
 * A JATEKSZABALYZAT ES AZ ADATKEZELESI TAJEKOZTATO (a jatek 4. szelete). MINDKETTO BALAZS SZOVEGE, szo szerint
 * (2026-11-06: a szabalyzat 09:06, a tajekoztato 09:10 UTC; exchange/jatek/*-balazs-2026-11-06.docx), nehany kerte
 * kivetellel, amelyeket a fajlok kommentjei es a spec megneveznek. NINCS RAJTUK VAZLAT-JELZES, es nincs bennuk
 * [KITOLTENDO].
 *
 * A vazlat gepezete megmaradt egy jovobeli, meg nem vegleges szovegnek: a lap a `[KITOLTENDO]` jelolest lathatoan
 * kiirja, a spec megszamolja, es a `jogiSzovegVazlat` ellenorzes addig igazat ad, amig akar egy is megmaradt.
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

export const JATEKSZABALYZAT: JogiDokumentum = {
  azonosito: "jatekszabalyzat",
  cim: "Játékszabályzat",
  // A SZABÁLYZAT VÉGLEGES: Balázs szövege, szó szerint (exchange/jatek/Jatekszabalyzat-balazs-2026-11-06.docx, 2026-11-06 09:06 UTC);
  // nincs rajta vázlat-jelzés, és nincs benne [KITÖLTENDŐ]. A TXT-TŐL KÉT HELYEN TÉR EL, Balázs kérésére (acrobot 44298,
  // 2026-11-06 09:10 UTC): a 6. szakasz végén a fődíj mondatai, a 7. végén a nyertes nevének közzététele, és a menetrend két
  // nyilvánvaló elírása javítva ("Az hatodik" és "Az hetedik" helyett "A hatodik", "A hetedik"). A többi szó szerint.
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
        "A hatodik hét kérdése 2026 december 12 22:00 órakor jelenik meg és 2026 december 19 21:00 óráig lehet válaszolni.",
        "A hetedik hét kérdése 2026 december 19 22:00 órakor jelenik meg és 2026 december 26 21:00 óráig lehet válaszolni.",
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
        "A hatodik hét kérdése 2026 december 12 22:00 órakor jelenik meg és 2026 december 19 21:00 óráig lehet válaszolni.",
        "A hetedik hét kérdése 2026 december 19 22:00 órakor jelenik meg és 2026 december 26 21:00 óráig lehet válaszolni.",
        "A Fődij sorsolása 2026 december 26-án este 22:00 órakor történik.",
        "A fődíj egy Aquaforest AF Nano Tank akvárium. A képeken látható dekoráció és élővilág nem része a nyereménynek. A heti nyereményt az adott heti kérdéssel együtt tesszük közzé a játék oldalán.",
      ],
    },
    {
      cim: "7. A nyertesek értesítése",
      bekezdesek: [
        "A nyertest a megadott e-mail-címen értesítjük.",
        "A nyertes nevét rövidített alakban (vezetéknév és a keresztnév kezdőbetűje, például Kovács P.) közzétesszük a játék oldalán.",
      ],
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
  // A TÁJÉKOZTATÓ VÉGLEGES: Balázs szövege, szó szerint (exchange/jatek/Adatkezelesi-tajekoztato-balazs-2026-11-06.docx, 2026-11-06
  // 09:10 UTC), egy kivétellel (acrobot 44299): a 3. szakasz végén a nyertes nevének közzététele, mert azt ki kell mondani.
  szakaszok: [
    {
      cim: "1. Az adatkezelő",
      bekezdesek: [
        "Acropora Kft.",
        "1106 Budapest Pesti Gábor utca 35",
        "Adószám: 23916229-2-42",
        "info@acropora.hu",
      ],
    },
    {
      cim: "2. Milyen adatokat kezelünk",
      bekezdesek: [
        "A nevedet, e-mail-címedet, a beküldött válaszodat, azt, hogy melyik kérdésre és mikor küldted be, valamint a megerősítés tényét és idejét.",
      ],
    },
    {
      cim: "3. Mire használjuk",
      bekezdesek: [
        "A játék lebonyolítására: a beküldések rögzítésére, a részvétel megerősítésére, a sorsolásra és a nyertes értesítésére.",
        "Az e-mail-címedet másra, így hírlevélre sem használjuk. A játékhoz nincs hírlevélre feliratkozás.",
        "Ha nyersz, a nevedet rövidített alakban (vezetéknév és a keresztnév kezdőbetűje, például Kovács P.) közzétesszük a játék oldalán.",
      ],
    },
    {
      cim: "4. Mennyi ideig őrizzük",
      bekezdesek: [
        "Az adataidat a fődíj sorsolását követő maximum 15 nappal töröljük rendszerünkből",
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
