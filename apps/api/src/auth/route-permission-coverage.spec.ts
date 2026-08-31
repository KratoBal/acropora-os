import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * MINDEN UTVONAL MONDJA MEG, MILYEN JOG KELL HOZZA.
 *
 * EZ A TESZT A FORRAST OLVASSA, es ez szandekos -- ugyanaz az indok, mint a
 * `partner-scope-and-branch.spec.ts`-nel. Futasidoben ugyanezt allitani
 * utvonalankent EGY teszt lenne, mindegyikhez egy olyan keroval, akinek epp az
 * a joga hianyzik: harminchet utvonal, harminchet bejelentkezes. A forras-
 * olvasas egy korben megnezi mindet, es akkor is szol, ha az uj utvonalhoz ma
 * meg nincs teszteset.
 *
 * MIERT KELL EGYALTALAN, HA MA NINCS HIBA. Merve 2026-08-31: a harom
 * partner-hatokoru kontroller MIND A 37 utvonala visel jogosultsagi dekoratort,
 * tehat ma NINCS mit javitani. Amit ez a fajl ad, az nem javitas, hanem az, hogy
 * a kovetkezo utvonal ne csendben szulessen meg nelkule. Ugyanaznap merve az is,
 * hogy ez NEM elmeleti: a dekoratort levéve a lista-vegpontrol NULLA teszt valt
 * pirosra -- sem az 1448 egysegteszt, sem a 30 kontroller-szintu allitas, sem az
 * akkori HTTP-suite --, mert MINDEN kero MINDEN suite-ban rendelkezett a
 * szukseges joggal. Egy fixtura, amiben mindenki jogosult, LATHATATLANNA teszi a
 * jogosultsagot.
 *
 * A HATOKOR ES A JOGOSULTSAG KET KULON TENGELY, es ez a fajl a masodikrol szol:
 *   hatokor     -- kinek szamit a kero (partnerScopeOf, es a rola szolo suite-ok)
 *   jogosultsag -- hasznalhatja-e egyaltalan ezt a vegpontot (ez a fajl)
 * Az egyikre irt allitas a masikrol semmit nem mond.
 */

const CONTROLLERS = [
  "src/service-assets/service-assets.controller.ts",
  "src/worksheets/worksheets.controller.ts",
  "src/suppliers/suppliers.controller.ts",
];

const ROUTE = new RegExp(
  String.raw`((?:^[ \t]*@[\w.]+\([^\n]*\)\n)*)` + // a route ELOTTI dekoratorok
    String.raw`^[ \t]*@(Get|Post|Patch|Put|Delete)\(([^\n]*)\)\n` +
    String.raw`((?:^[ \t]*@[^\n]*\n)*)`, // es a route UTANIAK
  "gm",
);

interface Route {
  file: string;
  name: string;
  guarded: boolean;
}

function routes(): Route[] {
  return CONTROLLERS.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(ROUTE)].map((match) => {
      const decorators = `${match[1] ?? ""}${match[4] ?? ""}`;
      return {
        file,
        name: `@${match[2]}(${(match[3] ?? "").trim()})`,
        guarded:
          decorators.includes("RequirePermissions") ||
          decorators.includes("@Public"),
      };
    });
  });
}

/**
 * A KONTROLL A KERESESRE, es ez az allitas tartja a masikat.
 *
 * Egy mintaillesztes, ami URES halmazt vet ossze egy szaballyal, ZOLDEN HAZUDIK:
 * nem talal szabalytalan utvonalat, mert nem talal utvonalat. Ha valaki atirja a
 * kontrollerek alakjat, ez a sor szol eloszor.
 */
it("megtalálja az útvonalakat, amiket vizsgálni akar", () => {
  const found = routes();
  assert.ok(
    found.length >= 30,
    `Csak ${found.length} útvonalat találtam a három kontrollerben; a minta valószínűleg elavult.`,
  );
  for (const file of CONTROLLERS) {
    assert.ok(
      found.some((route) => route.file === file),
      `${file}: egyetlen útvonalat sem találtam benne.`,
    );
  }
});

describe("jogosultsági dekorátor", () => {
  it("minden útvonalon ott van", () => {
    const unguarded = routes().filter((route) => !route.guarded);
    assert.deepEqual(
      unguarded.map((route) => `${route.file} ${route.name}`),
      [],
      "Ezek az útvonalak nem mondják meg, milyen jog kell hozzájuk.",
    );
  });
});
