import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  it("a `.content` doboz lekerült a közös, a lapokat átadó `<main>`-ről", () => {
    assert.match(
      kodSzoveg(shell),
      /<main>\{children\}<\/main>/,
      "a gyermek-tartalmat átadó <main> osztályt visel, ami újra ráhúzza a keskeny dobozt",
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
   * ISMERT POZITIV KONTROLL A KOVETKEZO KET ALLITASHOZ: ha ez a lista ures
   * lenne, minden hiany-allitas zold lenne, es epp a hiany-allitasok adjak
   * ennek a specnek az ertelmet (lasd `visual-base.spec.ts` azonos mintajat).
   */
  const regiStilusuLapok: { fajl: string; leiras: string }[] = [
    { fajl: "settings.tsx", leiras: "Beállítások" },
    { fajl: "new-ticket.tsx", leiras: "Új hibajegy" },
    { fajl: "aquarium-list.tsx", leiras: "Akváriumok lista" },
    { fajl: "aquarium-detail.tsx", leiras: "Akváriumok adatlap" },
    { fajl: "new-aquarium.tsx", leiras: "Új akvárium" },
  ];

  it("a kontroll-lista tényleg nem üres", () => {
    assert.ok(regiStilusuLapok.length >= 5);
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
