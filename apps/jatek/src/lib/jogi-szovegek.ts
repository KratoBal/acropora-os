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

/** Egy szakasz tartalmának darabja: bekezdés (sortöréssel is), alcím, felsorolás, táblázat. */
export type JogiBlokk =
  | { fajta: "bekezdes"; sorok: readonly string[] }
  | { fajta: "alcim"; szoveg: string }
  | { fajta: "lista"; elemek: readonly string[] }
  | {
      fajta: "tablazat";
      fejlec: readonly string[];
      sorok: readonly (readonly string[])[];
    };

/** Egy szakasz: vagy sima bekezdések (`bekezdesek`), vagy gazdagabb tartalom (`blokkok`). */
export type JogiSzakasz = {
  cim: string;
  bekezdesek?: readonly string[];
  blokkok?: readonly JogiBlokk[];
};

/** A szakasz blokkjai: a sima bekezdések is blokkokká alakítva, hogy a lap és a vizsgálat egy alakot lásson. */
export const szakaszBlokkok = (szakasz: JogiSzakasz): readonly JogiBlokk[] =>
  szakasz.blokkok ??
  (szakasz.bekezdesek ?? []).map((b) => ({
    fajta: "bekezdes" as const,
    sorok: [b],
  }));

/** Egy blokk minden szövegdarabja (a táblázat fejléce és cellái is). */
export const blokkSzovegei = (blokk: JogiBlokk): string[] => {
  switch (blokk.fajta) {
    case "bekezdes":
      return blokk.sorok.map(egyszeru);
    case "alcim":
      return [egyszeru(blokk.szoveg)];
    case "lista":
      return blokk.elemek.map(egyszeru);
    case "tablazat":
      return [...blokk.fejlec, ...blokk.sorok.flat()].map(egyszeru);
  }
};

/** A szöveg félkövér jelölés (`**...**`) nélkül: amit az olvasó betűre lát. A lap a jelölésből <strong>-ot rajzol. */
export const egyszeru = (szoveg: string): string => szoveg.replaceAll("**", "");

/** A szakasz minden szövegdarabja: a cím és a blokkok. */
export const szakaszSzovegei = (szakasz: JogiSzakasz): string[] => [
  szakasz.cim,
  ...szakaszBlokkok(szakasz).flatMap(blokkSzovegei),
];

/** A dokumentum minden szövege soronként (vizsgálathoz). */
export const dokumentumSzovege = (dokumentum: JogiDokumentum): string =>
  [
    ...(dokumentum.bevezeto ?? []).flatMap(blokkSzovegei),
    ...dokumentum.szakaszok.flatMap(szakaszSzovegei),
  ].join("\n");

export type JogiDokumentum = {
  azonosito: "jatekszabalyzat" | "adatkezeles";
  cim: string;
  /** A vázlat-jelzés: csak a még nem végleges dokumentumon áll; a végleges szövegen nincs. */
  vazlat_jelzes?: string;
  /** A szakaszok előtti rész (alcím, bevezető bekezdések); nem számozott. */
  bevezeto?: readonly JogiBlokk[];
  szakaszok: readonly JogiSzakasz[];
};

export const JATEKSZABALYZAT: JogiDokumentum = {
  azonosito: "jatekszabalyzat",
  cim: "Acropora nyereményjáték – Játékszabályzat",
  // A SZABÁLYZAT VÉGLEGES, 2. VÁLTOZAT: a szöveg Balázs jóváhagyásával (2026-11-06 10:48 UTC, acrobot 44364) a
  // `Jatekszabalyzat-acrobot-kitoltve-v2-2026-11-06.docx` szó szerint, a táblázatok táblázatként, a felsorolások
  // felsorolásként. Nincs rajta vázlat-jelzés, és nincs benne [KITÖLTENDŐ].
  szakaszok: [
    {
      cim: "1. A játék szervezője",
      blokkok: [
        { fajta: "bekezdes", sorok: ["A nyereményjáték szervezője:"] },
        {
          fajta: "bekezdes",
          sorok: [
            "Acropora Kft.",
            "Cím: 1106 Budapest, Pesti Gábor utca 35.",
            "Adószám: 23916229-2-42",
            "Kapcsolattartási email-cím: info@acropora.hu",
          ],
        },
        { fajta: "bekezdes", sorok: ["A továbbiakban: Szervező."] },
        {
          fajta: "bekezdes",
          sorok: [
            "A nyereményjáték a https://jatek.acropora.hu weboldalon zajlik.",
          ],
        },
      ],
    },
    {
      cim: "2. A játék időtartama",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A játék 2026. november 7-én 22:00 órakor kezdődik, és hét heti fordulóból áll.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A játék indulását a Szervező az Acropora YouTube élő adásában jelenti be.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: ["A heti kérdések az alábbi időszakokban válaszolhatók meg:"],
        },
        {
          fajta: "tablazat",
          fejlec: [
            "Forduló",
            "A kérdés megjelenése",
            "A válaszadás és az email-megerősítés határideje",
          ],
          sorok: [
            ["1. hét", "2026. november 7. 22:00", "2026. november 14. 21:00"],
            ["2. hét", "2026. november 14. 22:00", "2026. november 21. 21:00"],
            ["3. hét", "2026. november 21. 22:00", "2026. november 28. 21:00"],
            ["4. hét", "2026. november 28. 22:00", "2026. december 5. 21:00"],
            ["5. hét", "2026. december 5. 22:00", "2026. december 12. 21:00"],
            ["6. hét", "2026. december 12. 22:00", "2026. december 19. 21:00"],
            ["7. hét", "2026. december 19. 22:00", "2026. december 26. 21:00"],
          ],
        },
        {
          fajta: "bekezdes",
          sorok: ["A fődíj sorsolásának időpontja: 2026. december 26. 22:00."],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Valamennyi időpont magyarországi helyi idő szerint értendő. A határidők megállapításánál a játékot kiszolgáló rendszerben rögzített időpont az irányadó.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A heti fordulók zárása és a következő forduló megnyitása közötti egyórás időszakban az előző heti kérdésre már nem, a következő heti kérdésre még nem lehet nevezni.",
          ],
        },
      ],
    },
    {
      cim: "3. A részvétel feltételei",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: ["A játékban az a természetes személy vehet részt, aki:"],
        },
        {
          fajta: "lista",
          elemek: [
            "a játék kezdetekor betöltötte a 18. életévét;",
            "magyarországi lakóhellyel vagy tartózkodási hellyel rendelkezik;",
            "elfogadja a jelen Játékszabályzatot;",
            "megismeri a játékhoz tartozó Adatkezelési tájékoztatót;",
            "teljesíti az érvényes részvételhez szükséges lépéseket.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: ["A részvétel önkéntes, ingyenes, és nem kötött vásárláshoz."],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A játékban nem vehetnek részt az Acropora Kft. munkavállalói, a játék lebonyolításában közvetlenül közreműködő személyek, valamint az előzőekben felsoroltak Ptk. 8:1. § (1) bekezdés 1. pontja szerinti közeli hozzátartozói.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A részvételhez nincs szükség hírlevél-feliratkozásra vagy marketingcélú hozzájárulás megadására.",
          ],
        },
      ],
    },
    {
      cim: "4. A játék menete és az érvényes nevezés",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A Szervező minden heti forduló kezdetekor egy új kérdést tesz közzé a játék weboldalán.",
          ],
        },
        { fajta: "bekezdes", sorok: ["A kérdés lehet:"] },
        {
          fajta: "lista",
          elemek: [
            "szabadszavas, amelyre a játékos saját szöveges választ ír be; vagy",
            "feleletválasztós, amelynél a játékos a négy megadott válaszlehetőség közül egyet választ.",
          ],
        },
        { fajta: "bekezdes", sorok: ["A részvételhez a játékosnak:"] },
        {
          fajta: "lista",
          elemek: [
            "meg kell adnia a nevét és egy általa használt, működő email-címet;",
            "be kell küldenie a heti kérdésre adott válaszát;",
            "el kell fogadnia a Játékszabályzatot, és jeleznie kell, hogy megismerte az Adatkezelési tájékoztatót;",
            "a megadott email-címre küldött levélben található megerősítő linkre kattintva meg kell erősítenie a részvételét.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A válasz beküldésének és az email-megerősítésnek egyaránt az adott forduló határideje előtt meg kell történnie.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A határidőig meg nem erősített nevezés érvénytelen, és sem a heti sorsolásban, sem az adott hét alapján a fődíj sorsolásában nem vesz részt.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A játékosnak érdemes ellenőriznie a levélszemét- és promóciós mappákat is. Ha a megerősítő levél nem érkezik meg, a problémát az info@acropora.hu címen jelezheti. A jelzés önmagában nem helyettesíti a megerősítést, és nem hosszabbítja meg automatikusan a határidőt.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A Szervező a beküldéskor és a megerősítéskor nem ad visszajelzést arról, hogy a válasz helyes-e.",
          ],
        },
      ],
    },
    {
      cim: "5. A nevezések száma és az ismételt beküldés",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "Egy természetes személy egy heti fordulóban egy alkalommal nevezhet. Ugyanaz a személy több email-cím használatával sem szerezhet további heti nevezést vagy további fődíjesélyt.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Egy email-cím egy heti fordulóban egy nevezéshez használható. A játékosnak a különböző heti fordulókban ugyanazt az email-címet kell használnia, hogy a megszerzett fődíjesélyek egyértelműen összekapcsolhatók legyenek.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ismételt beküldés esetén a megerősítésig az új beküldés felülírja az előzőt (a nevet és a választ), és új megerősítő levelet küldünk, a korábbi megerősítő link pedig érvényét veszti. A megerősített válasz végleges: az azt követő újabb beküldést a rendszer nem veszi figyelembe.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A már beküldött válasz módosításának lehetősége: a válasz a megerősítésig, ugyanazzal az email-címmel újra beküldve módosítható, a megerősítés után nem. Az újabb beküldés legalább két perccel az előző után, nevezésenként legfeljebb öt alkalommal lehetséges.",
          ],
        },
      ],
    },
    {
      cim: "6. A válaszok értékelése",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A sorsolásokban kizárólag a helyes választ tartalmazó, határidőn belül beküldött és megerősített, egyébként is érvényes nevezések vesznek részt.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Feleletválasztós kérdésnél a Szervező által előzetesen meghatározott egyetlen helyes válasz jelölése fogadható el.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Szabadszavas válasznál a kis- és nagybetűk, az ékezetek, valamint a felesleges szóközök eltérése önmagában nem teszi helytelenné az egyébként egyértelműen helyes választ.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az egyértelmű, a válasz jelentését nem megváltoztató elgépelések és az azonos jelentésű megnevezések elfogadhatók.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A kétes szabadszavas válaszokat a Szervező a sorsolás előtt kézzel ellenőrzi. Az azonos tartalmú válaszokat azonos szempontok alapján értékeli.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A Szervező a helyes választ az adott heti forduló lezárását követően teszi közzé a játék weboldalán.",
          ],
        },
      ],
    },
    {
      cim: "7. Nyeremények",
      blokkok: [
        { fajta: "alcim", szoveg: "7.1. Heti nyeremények" },
        {
          fajta: "bekezdes",
          sorok: [
            "Minden heti fordulóhoz egy heti nyeremény tartozik. Az aktuális hét nyereménye a kérdéssel egyidőben jelenik meg a https://jatek.acropora.hu weboldalon.",
          ],
        },
        { fajta: "alcim", szoveg: "7.2. Fődíj" },
        { fajta: "bekezdes", sorok: ["A kampány fődíja:"] },
        {
          fajta: "bekezdes",
          sorok: ["1 db Aquaforest AF Nano Tank akvárium."],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A termékfotókon szereplő élőlények, korallok, dekorációk és egyéb kiegészítők nem képezik a fődíj részét.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A nyeremények készpénzre váltásának és átruházásának feltételei: a nyeremény készpénzre nem váltható, szabadon átruházható",
          ],
        },
      ],
    },
    {
      cim: "8. A heti sorsolások",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "Az egyes heti sorsolásokban kizárólag az adott heti kérdésre helyesen válaszoló, határidőben megerősített, érvényes nevezések vesznek részt.",
          ],
        },
        { fajta: "bekezdes", sorok: ["A heti sorsolások időpontjai:"] },
        {
          fajta: "tablazat",
          fejlec: ["Forduló", "Sorsolás időpontja"],
          sorok: [
            ["1. hét", "2026. november 14. 21:00"],
            ["2. hét", "2026. november 21. 21:00"],
            ["3. hét", "2026. november 28. 21:00"],
            ["4. hét", "2026. december 5. 21:00"],
            ["5. hét", "2026. december 12. 21:00"],
            ["6. hét", "2026. december 19. 21:00"],
            ["7. hét", "2026. december 26. 21:00"],
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A sorsolás helye vagy online felülete: a Szervező játékkezelő rendszere (online).",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A sorsolás módja: számítógépes véletlen kiválasztás a Szervező játékkezelő rendszerében. A rendszer minden sorsoláshoz kriptográfiai véletlen kezdőértéket állít elő, és azt a jelöltlistával együtt rögzíti, így a sorsolás utólag ellenőrizhető: ugyanazzal a kezdőértékkel és jelöltlistával megismételve ugyanazt az eredményt adja.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az adott heti sorsolás minden érvényes nevezése azonos eséllyel vesz részt a kiválasztásban.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Egy játékos különböző heti fordulókban több heti nyereményt is nyerhet.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ha egy fordulóban nincs érvényes, helyes nevezés, az adott heti nyeremény sorsa: nem kerül kiosztásra",
          ],
        },
      ],
    },
    {
      cim: "9. A fődíj sorsolása",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A fődíj sorsolására 2026. december 26-án 22:00 órakor kerül sor.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Minden olyan heti forduló, amelyben a játékos határidőn belül helyes választ küldött be, és részvételét határidőn belül megerősítette, egy részvételi esélyt biztosít a fődíj sorsolásán.",
          ],
        },
        { fajta: "bekezdes", sorok: ["Egy játékos így:"] },
        {
          fajta: "lista",
          elemek: [
            "egy megfelelően teljesített héttel egy esélyt;",
            "három megfelelően teljesített héttel három esélyt;",
            "mind a hét hét megfelelő teljesítésével legfeljebb hét esélyt szerezhet.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Nem feltétel mind a hét heti fordulóban részt venni: már egy érvényes, helyes és megerősített heti nevezéssel is be lehet kerülni a fődíj sorsolásába.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A fődíj jelöltlistáján minden megszerzett esély külön bejegyzésként szerepel. A sorsolás során minden ilyen bejegyzés azonos eséllyel kerülhet kiválasztásra.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A heti nyereményt korábban elnyerő játékos a fődíj sorsolásában: részt vehet",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A fődíj sorsolásának helye vagy online felülete: a Szervező játékkezelő rendszere, élőben közvetítve az Acropora YouTube csatornáján.",
          ],
        },
      ],
    },
    {
      cim: "10. A sorsolások dokumentálása és a pótnyertesek",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A Szervező a sorsolás előtt véglegesíti az adott sorsolásra jogosult nevezések, illetve fődíjesélyek listáját.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A sorsolásról feljegyzést készít, amely tartalmazza legalább:",
          ],
        },
        {
          fajta: "lista",
          elemek: [
            "a sorsolás időpontját;",
            "a részt vevő nevezések vagy esélyek számát;",
            "az alkalmazott kiválasztási eljárást;",
            "a kiválasztott nyertes és az esetleges pótnyertesek belső azonosítóját;",
            "az esetleges technikai rendellenességet és annak kezelését.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A sorsolási rendszer által előállított ellenőrzési adatokat a Szervező az Adatkezelési tájékoztatóban meghatározott ideig őrzi meg. A nevezési lista és a résztvevők email-címe nem válik nyilvánossá.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az első szabályszerűen végrehajtott és rögzített sorsolás eredménye az irányadó. Egy ellenőrzési célú megismétlés nem változtatja meg ezt az eredményt.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ha technikai hiba miatt nem állapítható meg szabályszerű eredmény, a Szervező dokumentálja a hibát, és a javítást követően ugyanabból a végleges jogosulti listából új sorsolást végez. Az új időpontot a játék weboldalán közzéteszi.",
          ],
        },
      ],
    },
    {
      cim: "11. A nyertesek értesítése és a nyeremények átadása",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A Szervező a sorsolást követő 3 munkanapon belül értesíti a nyertest a nevezéshez használt email-címen.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A nyertesnek az értesítés elküldésétől számított 15 naptári napon belül válaszolnia kell, és meg kell adnia a jogosultság ellenőrzéséhez, illetve az átadáshoz szükséges adatokat.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A nyertes elveszíti az adott nyereményre való jogosultságát, ha:",
          ],
        },
        {
          fajta: "lista",
          elemek: [
            "határidőn belül nem jelentkezik;",
            "nem felel meg a részvételi feltételeknek;",
            "megtagadja a jogosultság ellenőrzéséhez feltétlenül szükséges adatok megadását;",
            "igazoltan valótlan adatokkal vagy a szabályzat megkerülésével vett részt;",
            "a nyereményt kifejezetten visszautasítja.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A nyeremény átadásának módja: A heti nyereményeket a Foxpost csomagküldő szolgáltatóval juttatjuk el a nyertes által választott csomagautomatába, vagy személyesen vehető át az alábbi címen.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: ["A Fődíjat személyesen adjuk át a nyertesnek."],
        },
        {
          fajta: "bekezdes",
          sorok: ["Az átvétel helye vagy a kiszállítás területe:"],
        },
        {
          fajta: "bekezdes",
          sorok: ["Acropora tengeri akvarisztikai szaküzlet"],
        },
        { fajta: "bekezdes", sorok: ["1106 Budapest, Pesti Gábor utca 35"] },
        {
          fajta: "bekezdes",
          sorok: [
            "A csomagküldés útján küldött nyereményeket kizárólag Magyarország területére adjuk fel",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A nyertesek eredményhirdetése a következő felületen és adattartalommal történik (a nyertes rövidített neve, például Kovács P., és a nyereménye): https://jatek.acropora.hu. A Fődíj sorsolása élőben történik az Acropora YouTube csatornáján",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ennek adatkezelési feltételeit az Adatkezelési tájékoztató tartalmazza.",
          ],
        },
      ],
    },
    {
      cim: "12. Visszaélések és technikai problémák",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A Szervező kizárhatja azt a nevezést, amelyről igazolható, hogy:",
          ],
        },
        {
          fajta: "lista",
          elemek: [
            "automatizált vagy tömeges beküldéssel készült;",
            "más személy adatainak jogosulatlan használatával történt;",
            "a személyenkénti nevezési korlát megkerülését célozta;",
            "a játék rendszerének vagy a sorsolásnak a manipulálására irányult;",
            "egyéb módon sérti a jelen Játékszabályzatot.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A kizárás okát a Szervező dokumentálja. Önmagában egy technikai jel, például azonos internetkapcsolat használata, nem bizonyítja, hogy több nevezés ugyanahhoz a személyhez tartozik.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A játékos felel az általa megadott adatok pontosságáért és az email-fiókja hozzáférhetőségéért.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A Szervező oldalán felmerülő, a részvételt érdemben akadályozó technikai hiba esetén a Szervező a játék weboldalán tájékoztatást ad a hibáról, annak kezeléséről és az esetleges határidő-változásról. A kezelés során az érintett játékosokkal szemben egységes feltételeket alkalmaz.",
          ],
        },
      ],
    },
    {
      cim: "13. Adatkezelés",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A játékban történő részvételhez megadott személyes adatokat a Szervező a játék lebonyolításához, a részvételek megerősítéséhez és ellenőrzéséhez, a sorsolásokhoz, a nyertesek értesítéséhez és a nyeremények átadásához kapcsolódóan kezeli, a külön Adatkezelési tájékoztató szerint.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A játékban megadott email-címeket a Szervező nem használja automatikusan hírlevélküldésre vagy marketingcélra.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ha a felületen külön marketing-feliratkozási lehetőség is megjelenik, az önkéntes, a nevezéstől elkülönülő és alapértelmezetten nem bejelölt hozzájárulással működhet. Annak megadása vagy megtagadása nem befolyásolja a részvételt vagy a nyerési esélyeket.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A kezelt adatok körét, az egyes adatkezelések célját és jogalapját, az adatmegőrzési időket, az igénybe vett adatfeldolgozókat, az esetleges adattovábbításokat és az érintetti jogokat a nevezés előtt elérhető Adatkezelési tájékoztató tartalmazza.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az Adatkezelési tájékoztató elérhetősége: https://jatek.acropora.hu/adatkezeles.",
          ],
        },
      ],
    },
    {
      cim: "14. Kérdések és panaszok",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A játékos a játékkal, a válaszok értékelésével, a sorsolással vagy a nyeremény átadásával kapcsolatos kérdését és panaszát az info@acropora.hu email-címen jelezheti.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A bejelentésben kérjük feltüntetni az érintett heti fordulót, a nevezéshez használt email-címet és a probléma rövid leírását.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A Szervező a panaszt kivizsgálja, és az alkalmazandó jogszabályi határidőn belül válaszol.",
          ],
        },
      ],
    },
    {
      cim: "15. A szabályzat elérhetősége és módosítása",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A Játékszabályzat a játék teljes időtartama alatt elérhető a https://jatek.acropora.hu weboldalon.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A Szervező a szabályzatot indokolt esetben, különösen jogszabályváltozás vagy a játék lebonyolítását érintő lényeges körülmény miatt módosíthatja. A módosítást, annak okát és hatálybalépését a játék weboldalán közzéteszi.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A módosítás nem alkalmazható visszamenőleg a már szabályszerűen megszerzett részvételi esélyek elvonására vagy a már kihirdetett nyertes jogainak indokolatlan csorbítására.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A szabályzat közzétételének dátuma: 2026. november 6..",
            "Verzió: 1.0.",
          ],
        },
      ],
    },
  ],
};

export const ADATKEZELES: JogiDokumentum = {
  azonosito: "adatkezeles",
  cim: "Adatkezelési tájékoztató",
  // A TÁJÉKOZTATÓ VÉGLEGES, 2. VÁLTOZAT: Balázs szövege (acrobot kitöltve, 2026-11-06 11:55 UTC, acrobot 44375) szó szerint a
  // `Adatkezelesi-acrobot-kitoltve-2026-11-06.md`-ből, a félkövér jelöléssel (`**...**`) együtt. Nincs rajta vázlat-jelzés.
  bevezeto: [
    { fajta: "alcim", szoveg: "Az Acropora nyereményjáték résztvevői részére" },
    {
      fajta: "bekezdes",
      sorok: [
        "Ez a tájékoztató bemutatja, hogyan kezeljük a **https://jatek.acropora.hu** weboldalon meghirdetett, 2026. november 7-én induló nyereményjátékhoz kapcsolódó személyes adatokat.",
      ],
    },
    {
      fajta: "bekezdes",
      sorok: [
        "A játékban való részvétel önkéntes. A részvételhez nem szükséges vásárolnod vagy hírlevélre feliratkoznod.",
      ],
    },
  ],
  szakaszok: [
    {
      cim: "1. Az adatkezelő",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "**Acropora Kft.**",
            "Cím: 1106 Budapest, Pesti Gábor utca 35.",
            "Adószám: 23916229-2-42",
            "Email: **info@acropora.hu**",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: ["A továbbiakban: **Adatkezelő** vagy **Szervező**."],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Adatkezelési kérdéssel és a jogaid gyakorlásával kapcsolatban az info@acropora.hu címen kereshetsz minket.",
          ],
        },
      ],
    },
    {
      cim: "2. Milyen adatokat kezelünk?",
      blokkok: [
        { fajta: "alcim", szoveg: "2.1. A nevezéshez kapcsolódó adatok" },
        {
          fajta: "bekezdes",
          sorok: [
            "A játékban való részvétel során az alábbi adatokat kezeljük:",
          ],
        },
        {
          fajta: "lista",
          elemek: [
            "a neved;",
            "az email-címed;",
            "a beküldött válaszod;",
            "az érintett kérdés és heti forduló azonosítója;",
            "a válasz beküldésének időpontja;",
            "az email-megerősítés ténye és időpontja;",
            "a Játékszabályzat elfogadásának és az adatkezelési hozzájárulás megadásának ténye, időpontja és az elfogadott dokumentumok verziója;",
            "a válasz értékelése és a nevezés érvényessége;",
            "a heti sorsolásokhoz és a fődíjsorsoláshoz kapcsolódó részvételi azonosítók, megszerzett esélyek és eredmények.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az email-megerősítéshez a rendszer ideiglenes megerősítő azonosítót is kezel.",
          ],
        },
        { fajta: "alcim", szoveg: "2.2. A nyertesek további adatai" },
        {
          fajta: "bekezdes",
          sorok: [
            "Ha nyersz, a nyeremény átadásához további adatokat kérhetünk, például:",
          ],
        },
        {
          fajta: "lista",
          elemek: [
            "teljes név;",
            "kapcsolattartási telefonszám;",
            "szállítási cím, ha a nyereményt kiszállítjuk;",
            "az átvétel visszaigazolása;",
            "a jogosultság ellenőrzéséhez, valamint az esetleges számviteli és adózási kötelezettségek teljesítéséhez szükséges adatok.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Csak az adott nyeremény átadásához és az alkalmazandó kötelezettségek teljesítéséhez szükséges adatokat kérjük el. A pontos adatkört az adatok bekérésekor közöljük.",
          ],
        },
        { fajta: "alcim", szoveg: "2.3. Kapcsolatfelvétel és panasz" },
        {
          fajta: "bekezdes",
          sorok: [
            "Ha emailben keresel minket, kezeljük az email-címedet, a levelezés tartalmát és az ügy intézéséhez szükséges adatokat.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Kérjük, ne küldj a játékhoz vagy a kérdésed megválaszolásához nem szükséges személyes adatot.",
          ],
        },
      ],
    },
    {
      cim: "3. Az adatkezelés célja és jogalapja",
      blokkok: [
        { fajta: "alcim", szoveg: "3.1. Nevezés, megerősítés és sorsolás" },
        { fajta: "bekezdes", sorok: ["Az adatokat azért kezeljük, hogy:"] },
        {
          fajta: "lista",
          elemek: [
            "rögzítsük a nevezésedet;",
            "megerősítő emailt küldjünk;",
            "ellenőrizzük a részvételi feltételek teljesülését;",
            "értékeljük a válaszodat;",
            "nyilvántartsuk a megszerzett fődíjesélyeket;",
            "lebonyolítsuk és dokumentáljuk a sorsolásokat;",
            "értesítsük a nyerteseket.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ennek az adatkezelésnek a jogalapja a **hozzájárulásod**, a GDPR 6. cikk (1) bekezdés a) pontja alapján.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A hozzájárulást a nevezési felületen található külön, alapértelmezetten üres jelölőnégyzet bejelölésével adhatod meg. A hozzájárulás megadása elkülönül a Játékszabályzat elfogadásától.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A nevezéshez szükséges adatok és hozzájárulás nélkül nem tudjuk biztosítani a részvételedet.",
          ],
        },
        { fajta: "alcim", szoveg: "3.2. A nyeremény átadása" },
        {
          fajta: "bekezdes",
          sorok: [
            "A nyeremény átadásához szükséges adatokat a Játékszabályzat szerinti kötelezettségünk teljesítése érdekében kezeljük.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Jogalap: **szerződés teljesítése**, a GDPR 6. cikk (1) bekezdés b) pontja alapján.",
          ],
        },
        {
          fajta: "alcim",
          szoveg: "3.3. Számviteli és adózási kötelezettségek",
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Amennyiben a nyeremény átadása számviteli vagy adózási kötelezettséggel jár, az ehhez szükséges adatokat **jogi kötelezettség teljesítése** alapján kezeljük, a GDPR 6. cikk (1) bekezdés c) pontja szerint.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az alkalmazandó jogszabályok: a számvitelről szóló 2000. évi C. törvény (a nyeremények kiadását alátámasztó bizonylatok), valamint a személyi jövedelemadóról szóló 1995. évi CXVII. törvény (a nyereményhez kapcsolódó adókötelezettség, amelyet a Szervező teljesít).",
          ],
        },
        { fajta: "alcim", szoveg: "3.4. Panaszkezelés" },
        {
          fajta: "bekezdes",
          sorok: ["A panaszok intézéséhez szükséges adatkezelés jogalapja:"],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "az Adatkezelő **jogos érdeke** (GDPR 6. cikk (1) bekezdés f) pont), amely a játékkal kapcsolatos kérdések és panaszok kivizsgálásához, megválaszolásához, valamint az esetleges jogviták megelőzéséhez és rendezéséhez fűződik. Csak azokat az adatokat kezeljük, amelyeket a megkeresésben megadsz, vagy amelyek az ügy intézéséhez szükségesek.",
          ],
        },
      ],
    },
    {
      cim: "4. A nyertesek nevének közzététele",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "Az eredmények átlátható bemutatása érdekében a játék weboldalán közzétesszük a nyertes **vezetéknevét és keresztnevének kezdőbetűjét**, például: **Kovács P.**, a részben kitakart email-címét (lásd lent), valamint a megnyert nyereményt és a forduló megjelölését.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A nyertes email-címét csak részben kitakarva tesszük közzé: a címnek a @ előtti részéből az első két karakter látszik, a többit pontok takarják, a @ utáni rész teljes (például: **ko•••@gmail.com**). Erre azért van szükség, hogy az azonos rövidített nevű nyertesek megkülönböztethetők legyenek. A teljes email-címet, a telefonszámot és a szállítási címet nem tesszük közzé.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A rövidített név is személyes adat. A honlapon megjelenő eredményt bárki megtekintheti.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A közzététel jogalapja a **hozzájárulásod** (GDPR 6. cikk (1) bekezdés a) pont), amelyet a nevezési felületen, az adatkezelési hozzájárulás jelölőnégyzetével adsz meg: a hozzájárulás szövege kifejezetten tartalmazza, hogy nyertesség esetén a rövidített neved és a részben kitakart email-címed megjelenik.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A közzététel időtartama: **2027. január 10-ig**. Ezt követően a nevet és a kitakart email-címet eltávolítjuk az általunk kezelt eredménylistáról.",
          ],
        },
        { fajta: "alcim", szoveg: "A fődíj élő sorsolása" },
        {
          fajta: "bekezdes",
          sorok: [
            "A fődíj sorsolását élőben közvetítjük az **Acropora YouTube csatornáján**. Az adásban a nyertesnek ugyanazok az adatai jelennek meg, mint a weboldalon: a rövidített neve, a részben kitakart email-címe és a nyeremény. Más játékos neve vagy email-címe az adásban nem jelenik meg. A jogalap ugyanaz a hozzájárulás, mint a weboldali közzétételnél.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az adás felvétele a csatornán **2027. január 10-ig** nyilvánosan elérhető, ezt követően nem nyilvánossá tesszük. A YouTube szolgáltatója a Google Ireland Limited; a csatornán megjelenő tartalomra a YouTube saját adatkezelési feltételei is vonatkoznak.",
          ],
        },
      ],
    },
    {
      cim: "5. Mennyi ideig őrizzük meg az adatokat?",
      blokkok: [
        { fajta: "alcim", szoveg: "5.1. Nevezési adatok" },
        {
          fajta: "bekezdes",
          sorok: [
            "A nevezési adatokat legkésőbb a fődíj 2026. december 26-i sorsolását követő 15. napig, **2027. január 10-ig** töröljük a játék aktív adatbázisából.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ez a törlési határidő nem vonatkozik azokra az adatokra, amelyeket a következő pontok szerint, külön célból és jogalapon tovább kell kezelnünk.",
          ],
        },
        { fajta: "alcim", szoveg: "5.2. Nyereményátadási adatok" },
        {
          fajta: "bekezdes",
          sorok: [
            "A kizárólag a nyeremény átadásához szükséges adatokat az átadás lezárását követő **90 nap** elteltével töröljük, kivéve a kötelezően megőrzendő dokumentumokban szereplő adatokat.",
          ],
        },
        { fajta: "alcim", szoveg: "5.3. Számviteli és adózási adatok" },
        {
          fajta: "bekezdes",
          sorok: [
            "A jogszabály alapján megőrzendő bizonylatokat és az azokban szereplő adatokat a számvitelről szóló 2000. évi C. törvény 169. § (2) bekezdése alapján **legalább 8 évig** őrizzük meg.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ez nem jelenti a teljes nevezési adatbázis további megőrzését.",
          ],
        },
        { fajta: "alcim", szoveg: "5.4. Panaszok és megkeresések" },
        {
          fajta: "bekezdes",
          sorok: [
            "A kapcsolattartási és panaszkezelési adatokat az ügy lezárását követő **5 évig**, az általános elévülési időnek megfelelően (Ptk. 6:22. §) őrizzük meg.",
          ],
        },
        { fajta: "alcim", szoveg: "5.5. Biztonsági mentések és levelezés" },
        {
          fajta: "bekezdes",
          sorok: [
            "A törlés kiterjed az általunk kezelt, további megőrzést nem igénylő exportokra és másolatokra is.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A biztonsági mentésekből az adatok a mentés készítésétől számított **legfeljebb 90 napon** belül kerülnek ki. A mentéseket kizárólag helyreállításra használjuk; helyreállítás esetén a korábban esedékessé vált törléseket ismét végrehajtjuk.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A megerősítő és értesítő levelek elküldött példányait a küldő postafiókból a nevezési adatokkal együtt, **2027. január 10-ig** töröljük. A rendszer a levelekről csak darabszámot naplóz, email-címet nem.",
          ],
        },
      ],
    },
    {
      cim: "6. Kik férhetnek hozzá az adatokhoz?",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "Az Acropora Kft. munkatársai közül kizárólag azok férhetnek hozzá az adatokhoz, akiknek ez a játék lebonyolításához, a nyeremények átadásához vagy az ügyintézéshez szükséges.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A szolgáltatás működéséhez az alábbi szolgáltatókat vesszük igénybe:",
          ],
        },
        { fajta: "alcim", szoveg: "Tárhelyszolgáltatás" },
        {
          fajta: "bekezdes",
          sorok: [
            "**Hetzner Online GmbH**",
            "Cím: Industriestr. 25, 91710 Gunzenhausen, Németország",
            "Feladata: a játékot kiszolgáló szerver infrastruktúrájának biztosítása.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az adatkezelés tényleges helyszíne: **Németország** (Európai Unió).",
          ],
        },
        { fajta: "alcim", szoveg: "Levelezés és levélküldés" },
        {
          fajta: "bekezdes",
          sorok: [
            "**Google Ireland Limited**",
            "Cím: Gordon House, Barrow Street, Dublin 4, Írország",
            "Igénybe vett szolgáltatás: **Google Workspace (Gmail)**.",
            "Feladata: a megerősítő és értesítő emailek küldése, valamint a játékkal kapcsolatos levelezés tárolása.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A Google a Google Workspace adatfeldolgozási feltételei szerint, adatfeldolgozóként jár el.",
          ],
        },
        { fajta: "alcim", szoveg: "További közreműködők" },
        {
          fajta: "bekezdes",
          sorok: [
            "**FOXPOST Zrt.** (csomagküldés)",
            "Feladata: a heti nyeremények kiszállítása a nyertes által választott csomagautomatába. Megkapja a nyertes nevét, telefonszámát, email-címét és a választott csomagautomatát.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "**Könyvelés**",
            "A nyereményekhez kapcsolódó számviteli bizonylatok adataihoz a könyvelésünket végző szolgáltató fér hozzá, kizárólag a számviteli és adózási kötelezettségek teljesítéséhez.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A személyes adatokat nem értékesítjük, és nem adjuk át más szervezetnek annak saját marketingcéljaira.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Jogszabályban meghatározott esetben az arra jogosult hatóság részére adatot szolgáltathatunk.",
          ],
        },
      ],
    },
    {
      cim: "7. Nemzetközi adattovábbítás",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A szolgáltatók igénybevétele során az adatok feldolgozásának helyét és az esetleges, Európai Gazdasági Térségen kívüli hozzáférést a konkrét szolgáltatási szerződések határozzák meg.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: ["A játékhoz kapcsolódó nemzetközi adattovábbítás:"],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A tárhelyszolgáltató (Hetzner) az adatokat az Európai Unióban, Németországban kezeli; EU-n kívülre nem továbbítja.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A Google (levélküldés, YouTube) a szolgáltatás nyújtása során az adatokhoz az Európai Gazdasági Térségen kívül, így az Egyesült Államokban is hozzáférhet. Ennek alapja az EU–USA adatvédelmi keretrendszerről szóló európai bizottsági megfelelőségi határozat (GDPR 45. cikk), amelyhez a Google csatlakozott, valamint az Európai Bizottság által elfogadott általános adatvédelmi kikötések (GDPR 46. cikk (2) bekezdés c) pont). A garanciák a Google Workspace adatfeldolgozási feltételeiben ismerhetők meg (https://workspace.google.com/terms/dpa_terms.html), és kérésedre az info@acropora.hu címen is megküldjük őket.",
          ],
        },
      ],
    },
    {
      cim: "8. Technikai adatok és sütik",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A tömeges, automatizált beküldések korlátozásához a rendszer a látogató IP-címét ideiglenesen, a szerver memóriájában használja.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A sebességkorlátozáshoz kapcsolódó bejegyzés **legfeljebb egy percig** él a szerver memóriájában, ezután automatikusan törlődik. Adatbázisba és naplóba nem kerül.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az IP-címet e célból nem kapcsoljuk a nevezési adatbázishoz.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "E technikai adatkezelés jogalapja az Adatkezelőnek a weboldal biztonságos működtetéséhez és a visszaélések megelőzéséhez fűződő **jogos érdeke**, a GDPR 6. cikk (1) bekezdés f) pontja alapján.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az érdekmérlegelés lényege: a korlátozás nélkül a nevezési felületet gépi, tömeges beküldéssel el lehetne árasztani, ami a többi játékos esélyeit és a megerősítő levelek kézbesítését veszélyeztetné. Az IP-cím kezelése ehhez a legkisebb szükséges beavatkozás: csak percenkénti számlálásra használjuk, nem tároljuk, nem kapcsoljuk a nevezésedhez, és egy percen belül törlődik. Ezért úgy ítéljük meg, hogy a jogos érdekünk nem sérti aránytalanul a jogaidat. A teljes érdekmérlegelést kérésedre az info@acropora.hu címen megküldjük.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A játékot kiszolgáló alkalmazások naplóiba IP-cím, név vagy email-cím nem kerül; hozzáférési naplót a játék oldalairól nem vezetünk. Hiba esetén a napló csak a forduló azonosítóját és a hiba fajtáját rögzíti.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A weboldal **nem használ sütit**, és nem használ más böngészőtárhelyet, látogatottságmérő vagy külső követőkódot sem. A betűtípusokat és a képeket a saját szerverünkről töltjük be.",
          ],
        },
      ],
    },
    {
      cim: "9. Hírlevél és marketing",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: ["A játékhoz **nem tartozik hírlevél-feliratkozás**."],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A nevezéskor megadott email-címedet nem használjuk reklámlevelek, ajánlatok vagy hírlevelek küldésére.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A részvételt megerősítő, a nyereményről tájékoztató és a játék lebonyolításához szükséges üzeneteket a játékhoz kapcsolódóan küldjük.",
          ],
        },
      ],
    },
    {
      cim: "10. A hozzájárulás visszavonása",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A hozzájáruláson alapuló adatkezeléshez adott hozzájárulásodat bármikor, indokolás nélkül visszavonhatod az **info@acropora.hu** címre küldött levélben.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A visszavonás nem érinti a visszavonás előtt végzett adatkezelés jogszerűségét.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ha a sorsolás előtt visszavonod a nevezési adatok kezeléséhez adott hozzájárulásodat, a nevezésedet és a hozzá tartozó esélyeket kivesszük a még le nem zajlott sorsolásokból.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A visszavonás nem változtatja meg automatikusan a már lezajlott sorsolás eredményét. A más jogalapon, például jogszabályi kötelezettség miatt megőrzendő adatokat a rájuk vonatkozó szabályok szerint kezeljük tovább.",
          ],
        },
      ],
    },
    {
      cim: "11. Milyen jogok illetnek meg?",
      blokkok: [
        { fajta: "bekezdes", sorok: ["A GDPR feltételei szerint kérheted:"] },
        {
          fajta: "lista",
          elemek: [
            "**a hozzáférést:** tájékoztatást és másolatot kérhetsz a rólad kezelt személyes adatokról;",
            "**a helyesbítést:** kérheted a pontatlan adatok javítását és a hiányos adatok kiegészítését;",
            "**a törlést:** kérheted az adataid törlését, ha annak feltételei fennállnak;",
            "**az adatkezelés korlátozását:** a GDPR-ban meghatározott esetekben;",
            "**az adathordozhatóságot:** az általad rendelkezésünkre bocsátott, hozzájárulás vagy szerződés alapján, automatizáltan kezelt adatok tekintetében.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A saját helyzeteddel kapcsolatos okból tiltakozhatsz a jogos érdek alapján végzett adatkezelés ellen. Ilyenkor megvizsgáljuk, fennállnak-e az adatkezelés folytatásának jogszabályi feltételei.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A jogaid nem minden esetben korlátlanok; például a kötelezően megőrzendő bizonylatok törlését a megőrzési idő alatt nem tudjuk teljesíteni.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Kérésedet az **info@acropora.hu** címre küldheted. Szükség esetén az azonosításodhoz arányos, további információt kérhetünk.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Indokolatlan késedelem nélkül, főszabály szerint a kérelem beérkezésétől számított **egy hónapon belül** tájékoztatunk az intézkedésről.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A kérelmek összetettsége vagy száma miatt ez a határidő szükség esetén további két hónappal meghosszabbítható. Erről és az indokokról az első hónapon belül tájékoztatunk.",
          ],
        },
      ],
    },
    {
      cim: "12. Panasz és bírósági jogorvoslat",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "Ha úgy gondolod, hogy személyes adataid kezelése sérti a jogaidat, megkereshetsz minket az **info@acropora.hu** címen.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Ettől függetlenül panaszt tehetsz a felügyeleti hatóságnál:",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "**Nemzeti Adatvédelmi és Információszabadság Hatóság – NAIH**",
            "Cím: 1055 Budapest, Falk Miksa utca 9–11.",
            "Email: ugyfelszolgalat@naih.hu",
            "Honlap: https://www.naih.hu",
          ],
        },
        { fajta: "bekezdes", sorok: ["Jogosult vagy bírósághoz is fordulni."] },
      ],
    },
    {
      cim: "13. Automatizált döntések és adatbiztonság",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A játék rendszerében a feleletválasztós és az egyértelmű szabadszavas válaszok értékelése automatizáltan történhet. A kétes szabadszavas válaszokat a Szervező kézzel ellenőrzi.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "A sorsolás a Játékszabályzatban meghatározott véletlenszerű kiválasztási eljárással történik.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az értékeléssel vagy a részvétel érvényességével kapcsolatos kifogásodat az info@acropora.hu címen jelezheted.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az adatok védelméhez hozzáférési korlátozásokat és a kockázatokhoz igazodó technikai, illetve szervezési intézkedéseket alkalmazunk.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az automatizált értékelés a megadott helyes válasszal való egyezést vizsgálja (szabadszavas válasznál a kis- és nagybetűk, az ékezetek és a szóközök eltérésétől eltekintve). Ez nem minősül a GDPR 22. cikke szerinti, rád nézve joghatással járó vagy hasonlóan jelentős mértékben érintő döntésnek. Ha vitatod a válaszod értékelését, kérésedre azt munkatársunk felülvizsgálja.",
          ],
        },
      ],
    },
    {
      cim: "14. A tájékoztató elérhetősége és változásai",
      blokkok: [
        {
          fajta: "bekezdes",
          sorok: [
            "A tájékoztató a játék weboldalán, a nevezés előtt és a játék teljes időtartama alatt elérhető.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "Az adatkezelés lényeges változásairól megfelelő tájékoztatást adunk. Ha új adatkezelési célhoz hozzájárulás szükséges, azt külön kérjük.",
          ],
        },
        {
          fajta: "bekezdes",
          sorok: [
            "**Közzététel dátuma: 2026. november 6.**",
            "**Verzió: 1.0**",
          ],
        },
      ],
    },
  ],
};

export const JOGI_DOKUMENTUMOK = [JATEKSZABALYZAT, ADATKEZELES] as const;

/** Hány `[KITÖLTENDŐ` jelölés van egy dokumentumban. */
export const kitoltendoDb = (dokumentum: JogiDokumentum): number =>
  [
    ...(dokumentum.bevezeto ?? []).flatMap(blokkSzovegei),
    ...dokumentum.szakaszok.flatMap(szakaszSzovegei),
  ].reduce((db, szoveg) => db + szoveg.split(KITOLTENDO).length - 1, 0);

/** Igaz, amig akar egy `[KITÖLTENDŐ` jelölés megmaradt: ez a szöveg NEM mehet ki élesre. */
export const jogiSzovegVazlat = (): boolean =>
  JOGI_DOKUMENTUMOK.some((d) => kitoltendoDb(d) > 0);
