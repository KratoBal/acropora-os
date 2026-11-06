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
      return [...blokk.sorok];
    case "alcim":
      return [blokk.szoveg];
    case "lista":
      return [...blokk.elemek];
    case "tablazat":
      return [...blokk.fejlec, ...blokk.sorok.flat()];
  }
};

/** A szakasz minden szövegdarabja: a cím és a blokkok. */
export const szakaszSzovegei = (szakasz: JogiSzakasz): string[] => [
  szakasz.cim,
  ...szakaszBlokkok(szakasz).flatMap(blokkSzovegei),
];

/** A dokumentum minden szövege soronként (vizsgálathoz). */
export const dokumentumSzovege = (dokumentum: JogiDokumentum): string =>
  dokumentum.szakaszok.flatMap(szakaszSzovegei).join("\n");

export type JogiDokumentum = {
  azonosito: "jatekszabalyzat" | "adatkezeles";
  cim: string;
  /** A vázlat-jelzés: csak a még nem végleges dokumentumon áll; a végleges szövegen nincs. */
  vazlat_jelzes?: string;
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
    .flatMap(szakaszSzovegei)
    .reduce((db, szoveg) => db + szoveg.split(KITOLTENDO).length - 1, 0);

/** Igaz, amig akar egy `[KITÖLTENDŐ` jelölés megmaradt: ez a szöveg NEM mehet ki élesre. */
export const jogiSzovegVazlat = (): boolean =>
  JOGI_DOKUMENTUMOK.some((d) => kitoltendoDb(d) > 0);
