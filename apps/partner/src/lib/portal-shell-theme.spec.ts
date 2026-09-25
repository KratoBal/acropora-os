import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * SURGOS JAVITAS, 2026-09-25 -- Balazs elo hibajelentese a
 * ticket.acropora.hu-rol, ket kulon hibajelenseg:
 *
 * 1) KEVERT TEMA ES SZUK TARTALOM: sotet modban a tartalom sotet, de az
 *    oldalsav vilagos maradt, es a tartalom nem toltotte ki a rendelkezesre
 *    allo szelesseget (`portal-shell.tsx` `<main className="content">`-je
 *    olyan `max-width`/`margin: 0 auto` dobozt adott, amit egy pilot oldal
 *    GYERMEK negativ margoja nem tudott felulirni).
 * 2) LILA, TULMERETEZETT GOMBOK: a `globals.css` regi, RETEG NELKULI
 *    `button { background: #4c397f; ... }` szabalya a CSS Cascade Layers
 *    specifikacio szerint MINDIG felulirta a Tailwind `utilities` retegeben
 *    elo osztalyokat, fuggetlenul a szelektor specificitasatol -- ezert lett
 *    lila es nagy MINDEN gomb, aminek Tailwind-osztallyal probaltunk sajat
 *    kinezetet adni (lapozo, statusz-fulek, kijelentkezes).
 *
 * Ez a spec mindket javitast forras-szinten rogziti, ugyanazzal a hatarral,
 * mint a szomszed `portal-wiring.spec.ts`/`visual-base.spec.ts`: a forras
 * SZOVEGET olvassa, nem a renderelt kepernyot -- renderelo ehhez a
 * csomaghoz ma nincs.
 */

const GYOKER = join(process.cwd(), "src");

/**
 * A KOMMENTEK NELKULI KOD, UGYANAZ AZ ALAK, MINT A SZOMSZED
 * `visual-base.spec.ts`-BEN: a sajat magyarazo szovegunk (peldaul ITT, ebben
 * a fajlban is) tartalmazhatja azt, amit a meres keres -- egy nyers
 * illesztes ezert a DOKUMENTACIOT venne leletnek.
 */
function kodSzoveg(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

describe("a portal héja és a tartalom doboza (sürgős javítás, 2026-09-25)", () => {
  const shell = readFileSync(
    join(GYOKER, "components", "portal-shell.tsx"),
    "utf8",
  );

  /**
   * A `<main>` HAROM ALAKBAN FORDUL ELO EBBEN A FAJLBAN (betoltes/
   * atiranyitas/hozzaferes-megtagadva agakon `className="centered"`
   * illetve `"access-denied"`-del) -- EZEKET SZANDEKOSAN NEM ERINTI EZ A
   * JAVITAS, csak azt az EGYET, ami a `{children}`-t, vagyis a tenyleges
   * lapokat adja tovabb. Ezert a celzott alakra illesztunk, nem BARMELYIK
   * `<main>`-re.
   */
  it("a `.content` doboz nem tért vissza a lapokat átadó `<main>`-re", () => {
    const mainSor = kodSzoveg(shell).match(
      /<main\b[\s\S]*?>\s*\{children\}/,
    )?.[0];
    assert.ok(
      mainSor,
      "nem találom a {children}-t átadó <main> elemet portal-shell.tsx-ben",
    );
    assert.doesNotMatch(
      mainSor!,
      /className="[^"]*\bcontent\b[^"]*"/,
      "a gyermek-tartalmat átadó <main> a régi .content osztályt viseli, ami újra ráhúzza a keskeny dobozt",
    );
  });

  it("az oldalsav önállóan, a `useThemePreference` preferenciájával kapja meg a data-theme-et", () => {
    assert.match(shell, /from\s+"@acropora\/ui"/);
    assert.match(shell, /useThemePreference\(\)/);
    const asideSor = shell.match(/<aside\b[\s\S]*?>/)?.[0];
    assert.ok(asideSor, "nem találom az <aside> elemet portal-shell.tsx-ben");
    assert.match(
      asideSor!,
      /data-theme=\{effectiveTheme\}/,
      "az oldalsav gyökere nem viseli a data-theme attribútumot",
    );
  });

  /**
   * MASODIK KOR, 2026-09-25 (Balazs 16:50-es kepei): a lapokat atado
   * `<main>` MOST MAR sajat magan is viseli a `data-theme`-et es egy
   * temakoveto hatteret, ugyanugy, mint az `<aside>` -- ez zarja be azt a
   * rest, ami egy roved (nincs `min-h-screen`) reszletlap ALATT vilagosan
   * maradt sotet modban.
   */
  it("a `<main>` is a `data-theme`-et és a téma-hátteret viseli, mint az `<aside>`", () => {
    const mainSor = kodSzoveg(shell).match(
      /<main\b[\s\S]*?>\s*\{children\}/,
    )?.[0];
    assert.ok(
      mainSor,
      "nem találom a {children}-t átadó <main> elemet portal-shell.tsx-ben",
    );
    assert.match(
      mainSor!,
      /data-theme=\{effectiveTheme\}/,
      "a <main> nem viseli a data-theme attribútumot",
    );
    assert.match(
      mainSor!,
      /className="[^"]*\bbg-pilot-grey-50\b[^"]*"/,
      "a <main> nem visel téma-vezérelt (bg-pilot-grey-50) hátteret",
    );
  });

  /**
   * ISMERT POZITIV KONTROLL A KOVETKEZO KET ALLITASHOZ: ha ez a lista ures
   * lenne, minden hiany-allitas zold lenne, es epp a hiany-allitasok adjak
   * ennek a specnek az ertelmet (lasd `visual-base.spec.ts` azonos mintajat).
   */
  /**
   * A HÁROM AKVÁRIUM-LAP 2026-09-25-TŐL KIKERÜLT ERRŐL A LISTÁRÓL -- pilot-
   * stílusú lett (emlék 1847, `feat/portal-aquarium-pilot-round-1`), és
   * MOST a lenti `pilotLapok` listában szerepel, ugyanúgy, ahogy a
   * `ticket-list.tsx`/`asset-detail.tsx` is ott áll, amióta pilot-stílusú.
   * UGYANEZ A NAP UGYANEZT TETTE A `new-ticket.tsx`-szel (#1140, main), MAJD
   * A `settings.tsx`-szel is (ez a PR) -- REBASE UTÁN (2026-09-25) a két
   * változás UNIÓJA azt jelenti, hogy EZ A LISTA MOST ÜRES: az összes
   * portál-lap (11 db) pilot-aqua stílusú.
   */
  const regiStilusuLapok: { fajl: string; leiras: string }[] = [];

  /**
   * NEM "ISMERT POZITÍV KONTROLL" TÖBBÉ, HANEM A MIGRÁCIÓ LEZÁRÁSÁNAK
   * ÁLLÍTÁSA: a lista NEM azért üres, mert a felismerés nem működik, hanem
   * mert nincs több migrálandó lap. Ha valaha ÚJ, régi-stílusú lap kerülne
   * be, ez az állítás pirosra vált -- ez a szerepe, nem a "nem üres" mérce.
   */
  it("a régi-stílusú lapok listája szándékosan üres: minden lap pilot-aqua", () => {
    assert.deepEqual(regiStilusuLapok, []);
  });

  for (const { fajl, leiras } of regiStilusuLapok) {
    it(`a(z) "${leiras}" (${fajl}) saját maga viseli a \`content\` osztályt`, () => {
      const kod = kodSzoveg(
        readFileSync(join(GYOKER, "components", fajl), "utf8"),
      );
      const gyokerElemek = [
        ...kod.matchAll(/return\s*\(\s*<(section|p)\b[^>]*>/g),
      ];
      assert.ok(
        gyokerElemek.length > 0,
        `nem találok <section>/<p> gyökér-visszatérést ${fajl}-ban`,
      );
      for (const talalat of gyokerElemek) {
        assert.match(
          talalat[0],
          /className="[^"]*\bcontent\b[^"]*"/,
          `a gyökér elem nem viseli a "content" osztályt: ${talalat[0]}`,
        );
      }
    });
  }

  /**
   * A HAT PILOT-AQUA LAP MAR NEM IGENYLI A NEGATIV MARGOS SZOKO-TECHNIKAT --
   * ES HA VALAKI VISSZATENNE, AZ ISMET ELTORNE A SZELESSEGET (a `.content`
   * doboz mar nincs a szulo hejban, tehat a negativ margo most MASHOVA
   * tolna el a tartalmat, nem "vissza a helyere").
   */
  const pilotLapok = [
    "ticket-list.tsx",
    "ticket-detail.tsx",
    "asset-list.tsx",
    "asset-detail.tsx",
    "worksheet-list.tsx",
    "worksheet-detail.tsx",
    /*
      NEW-TICKET.TSX ÉS SETTINGS.TSX 2026-09-25-TŐL EBBE A CSOPORTBA
      TARTOZNAK (pilot-aqua átültetés, lásd a saját fejlécüket): a
      `regiStilusuLapok` listából ide költöztek.
    */
    "new-ticket.tsx",
    "settings.tsx",
    // A HÁROM AKVÁRIUM-LAP, PILOT-STÍLUSRA VÁLTVA 2026-09-25-TŐL (emlék 1847).
    "aquarium-list.tsx",
    "aquarium-detail.tsx",
    "new-aquarium.tsx",
  ];

  for (const fajl of pilotLapok) {
    it(`a(z) ${fajl} nem visel elavult, .content-et semlegesítő negatív margót`, () => {
      const kod = readFileSync(join(GYOKER, "components", fajl), "utf8");
      const vetkesek = [
        ...kod.matchAll(/className="[^"]*-m[xtb]-\d+[^"]*"/g),
      ].filter((m) =>
        /PilotThemeRoot/.test(kod.slice(Math.max(0, m.index! - 40), m.index!)),
      );
      assert.deepEqual(
        vetkesek.map((m) => m[0]),
        [],
        "egy PilotThemeRoot ismét negatív margós dobozt visel",
      );
    });
  }
});

/** A CSS-KOMMENTEK NELKULI SZOVEG -- lasd a `kodSzoveg` fejleceit fent: ez a
 * spec sajat magyarazo szovege (peldaul a lenti fejlecben) idezi a
 * `background: #4c397f` mintat, tehat egy nyers illesztes a KOMMENTET is
 * leletnek venne. */
function cssSzoveg(forras: string): string {
  return forras.replace(/\/\*[\s\S]*?\*\//g, " ");
}

describe("a gombok színe (sürgős javítás, 2026-09-25)", () => {
  const css = cssSzoveg(
    readFileSync(join(GYOKER, "app", "globals.css"), "utf8"),
  );

  /**
   * A CSS CASCADE LAYERS SPECIFIKACIO SZERINT A RETEGEN KIVULI SZABALY
   * MINDIG MAGASABB PRIORITASU BARMELY RETEGBELINEL, FUGGETLENUL A
   * SZELEKTOR SPECIFICITASATOL. Ezert egy retegezetlen `button { background:
   * ... }` MINDIG felulirta a Tailwind `utilities` retegeben elo
   * `bg-*`/`text-*`/`font-*` osztalyokat -- ez az allitas azt zarja le,
   * hogy a regi lila alapszin `@layer base`-en belul all, tehat a Tailwind
   * `utilities` retege (magasabb prioritasu, mint a `base`) szabalyosan
   * felulirhatja minden olyan gombon, aminek van sajat Tailwind-osztalya.
   */
  it("a régi `button` alapszín `@layer base`-en belül áll, nem rétegezetlenül", () => {
    const layerMatch = css.match(/@layer\s+base\s*\{([\s\S]*?)\n\}\n/);
    assert.ok(
      layerMatch,
      "nem találok @layer base { ... } blokkot globals.css-ben",
    );
    assert.match(
      layerMatch![1]!,
      /background:\s*#4c397f/,
      "a régi lila alapszín nem a @layer base blokkon belül áll",
    );

    /*
      ISMERT POZITIV KONTROLL: ha a fenti regex bármilyen okból túl tágan
      illeszkedne (pl. egy másik @layer base blokkra), ez az állítás azt
      ellenőrzi, hogy a `#4c397f` szín a FÁJLBAN KÍVÜL a talált blokkon
      sehol máshol, rétegezetlenül nem áll.
    */
    const kivul = css.replace(layerMatch![0]!, "");
    assert.doesNotMatch(
      kivul,
      /background:\s*#4c397f/,
      "a lila alapszín a @layer base blokkon kívül is előfordul, tehát rétegezetlenül is hat",
    );
  });
});

/**
 * MÁSODIK KÖR, 2026-09-25 -- Balázs második hibajelentése: a fenti
 * `@layer base` javítás után a lapozó és a Kijelentkezés helyesen
 * elszíntelenedett, DE az inaktív státusz-fülek (Hibajegyek/Eszközök/
 * Munkalapok listák) TOVÁBBRA IS lila hátterűek maradtak, csak az AKTÍV fül
 * lett zöld.
 *
 * MÉRVE AZ ÉLES, LEFORDÍTOTT CSS-EN (2026-09-25 16:2x, ticket.acropora.hu):
 * a `@layer base` fix maga helyesen ott áll és helyesen alacsonyabb
 * prioritású, mint a `utilities` réteg -- a hiányzó darab nem a réteg,
 * hanem az, hogy az inaktív fülnek EGYÁLTALÁN NINCS `background-color`-t adó
 * Tailwind-osztálya NYUGALMI állapotban (csak `hover:bg-*`, ami kizárólag
 * `:hover`-en hat). A `@layer base` réteg csak akkor veszíthet, ha van VELE
 * VERSENGŐ, magasabb rétegbeli szabály -- ha nincs, marad az egyetlen forrás,
 * és a lila átlátszik. Ez az állítás ezt a hiányt fogja meg: minden
 * `<button>` minden feltételes className-ágának kell legyen egy NYUGALMI
 * (nem `hover:`/`focus:`/`active:` előtagú) `bg-*` osztálya.
 */
describe("az inaktív gomb-állapotoknak is van nyugalmi háttér-osztálya (2026-09-25)", () => {
  const GYOKER2 = join(process.cwd(), "src");

  /**
   * A KOMPONENSEK GYŰJTÉSE UGYANAZZAL A BEJÁRÁSSAL, MINT A
   * `visual-base.spec.ts`-BEN: minden `.tsx` a `components/` alatt.
   */
  function komponensFajlok(konyvtar: string, gyujto: string[] = []): string[] {
    for (const b of readdirSync(konyvtar, { withFileTypes: true })) {
      const ut = join(konyvtar, b.name);
      if (b.isDirectory()) komponensFajlok(ut, gyujto);
      else if (b.name.endsWith(".tsx")) gyujto.push(ut);
    }
    return gyujto;
  }

  /** EGY OSZTÁLY-TOKEN NYUGALMI HÁTTÉR, HA `bg-`-vel kezdődik, ÉS NEM
   * pszeudo-állapot előtaggal (`hover:`/`focus:`/`active:`/`disabled:`). */
  function vanNyugalmiHatter(osztalyLista: string): boolean {
    return osztalyLista.split(/\s+/).some((token) => /^bg-/.test(token));
  }

  /**
   * MINDEN `<button` FELTÉTELES (`cond ? "A" : "B"`) CLASSNAME-ÁGÁT
   * MEGKERESI, ÉS VISSZAADJA AZOKAT, AMELYIKBŐL HIÁNYZIK A NYUGALMI
   * HÁTTÉR-OSZTÁLY.
   *
   * A MINTA SZŰK, ÉS EZ SZÁNDÉKOS: csak az egyszerű, egyetlen ternáris ágú
   * `className={\`... ${cond ? "A" : "B"}\`}` alakra illeszkedik -- ez a
   * három vétkes fájl (és a `PilotButton`/`PilotSegmentedControl`) ALAKJA.
   * Egy összetettebb (több feltételes, beágyazott) className-t ez a minta
   * kihagyna, de azt eddig egyik pilot-aqua gomb sem használja.
   */
  function hianyzoNyugalmiHatterek(kod: string): string[] {
    const talalatok: string[] = [];
    for (const m of kod.matchAll(
      /<button[\s\S]{0,400}?className=\{`[\s\S]*?\$\{[\s\S]*?\?\s*"([^"]*)"\s*:\s*"([^"]*)"[\s\S]*?\}`\}/g,
    )) {
      for (const ag of [m[1]!, m[2]!]) {
        if (!vanNyugalmiHatter(ag)) talalatok.push(ag);
      }
    }
    return talalatok;
  }

  /**
   * ISMERT POZITÍV KONTROLL: a felismerő függvény TÉNYLEG talál hiányt egy
   * olyan mintán, amilyen a hiba ELŐTT állt (mérve: ez pontosan az a sztring,
   * ami a `ticket-list.tsx`-ben a javítás előtt élt). Ha ez a kontroll zöld
   * lenne akkor is, ha a minta soha semmit nem fogna meg, a lenti
   * hiány-állítások értelmüket vesztenék.
   */
  it("ISMERT POZITÍV KONTROLL: a felismerő fogja a régi, javítatlan alakot", () => {
    const regiMinta =
      '<button type="button" className={`x ${a ? "bg-pilot-aqua-50 text-pilot-aqua-700" : "text-pilot-grey-500 hover:bg-pilot-grey-50"}`}>';
    assert.deepEqual(hianyzoNyugalmiHatterek(regiMinta), [
      "text-pilot-grey-500 hover:bg-pilot-grey-50",
    ]);
  });

  const fajlok = komponensFajlok(join(GYOKER2, "components"));

  it("a bejárás lát komponens-fájlokat", () => {
    assert.ok(fajlok.length >= 10, `gyanúsan kevés fájl: ${fajlok.length}`);
  });

  for (const ut of fajlok) {
    it(`${ut.slice(GYOKER2.length + 1)}: minden feltételes gomb-állapotnak van nyugalmi háttere`, () => {
      const kod = readFileSync(ut, "utf8");
      assert.deepEqual(
        hianyzoNyugalmiHatterek(kod),
        [],
        "egy <button> feltételes ága csak hover:-re ad bg-*-ot, nyugalmi állapotban a régi lila @layer base szabály marad az egyetlen forrás",
      );
    });
  }
});

describe("a megosztott Pilot-gombok is nyugalmi hátteret visznek (2026-09-25)", () => {
  /*
    A KOMMENTEK NELKUL, UGYANAZ AZ OK, MINT MASHOL EBBEN A FAJLBAN: a lenti
    allitasok sajat magyarazo szovege (peldaul a "ghost" szo idezojelben)
    talalatnak nezne ki egy nyers regex szamara.
  */
  const kod = kodSzoveg(
    readFileSync(
      join(process.cwd(), "..", "..", "packages", "ui", "src", "pilot-ui.tsx"),
      "utf8",
    ),
  );

  /**
   * A `ghost` VÁLTOZAT ÉS A `PilotSegmentedControl` INAKTÍV ÁGA MA MÉG
   * SEHOL NEM FUT A PARTNER PORTÁLON (mérve: nulla hívóhely) -- ez a két
   * állítás MEGELŐZŐ javítás, nem élő hiba. A `packages/ui` megosztott,
   * tehát ugyanez a hiány bármelyik jövőbeli hívóhelyen (partner portál)
   * ugyanígy átlátszó lilát adna, ha valaki használná.
   */
  it("a PilotButton `ghost` változata nyugalmi háttérrel indul", () => {
    const ghostSor = kod.match(/ghost:\s*\n?\s*"([^"]*)"/)?.[1];
    assert.ok(ghostSor, "nem találom a PilotButton ghost változatát");
    assert.match(
      ghostSor!,
      /(^|\s)bg-transparent(\s|$)/,
      `a ghost változatnak nincs nyugalmi bg- osztálya: ${ghostSor}`,
    );
  });

  it("a PilotSegmentedControl inaktív állapota nyugalmi háttérrel indul", () => {
    const inaktivAg = kod.match(
      /value === opt\s*\n\s*\?\s*"[^"]*"\s*\n\s*:[\s\S]*?"([^"]*)"/,
    )?.[1];
    assert.ok(inaktivAg, "nem találom a PilotSegmentedControl inaktív ágát");
    assert.match(
      inaktivAg!,
      /(^|\s)bg-transparent(\s|$)/,
      `az inaktív állapotnak nincs nyugalmi bg- osztálya: ${inaktivAg}`,
    );
  });
});
