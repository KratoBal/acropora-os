import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { munkaoraEgysegFigyelmeztetes } from "./munkaora-egyseg";

const szol = (kind: string, unit: string) =>
  munkaoraEgysegFigyelmeztetes({ kind, unit }) !== null;

/**
 * UGYANAZ A KET IRANY, MINT A WEBES OLDALON (957be72d, 4. kikotes).
 *
 * A ket peldany kozott nincs kozos import (az apps/mobile kivul esik a pnpm
 * munkateren), tehat az elcsuszas ellen EZ a ket allitas ved: ha barmelyik
 * oldal elmozdul, az ott PIROS lesz.
 */
describe("a munkaóra-sor mértékegysége a telefonon", () => {
  it("db mellett SZÓL", () => {
    assert.equal(szol("LABOR", "db"), true);
    assert.equal(szol("LABOR", "kg"), true);
  });

  it("óra mellett NEM szól, írásmódtól függetlenül", () => {
    for (const alak of ["óra", "Óra", "ORA", "ora", " óra ", "h"])
      assert.equal(szol("LABOR", alak), false, `szólt erre: ${alak}`);
  });

  it("a nem-munka sorra soha nem szól", () => {
    assert.equal(szol("OTHER", "db"), false);
  });

  it("az üres egységre nem szól", () => {
    assert.equal(szol("LABOR", ""), false);
  });

  /**
   * A MONDAT A TELEFON SZAVAT HASZNALJA: ott KAPCSOLO all, nem jelolonegyzet.
   * A webes szoveg "vedd ki a jelolest", itt "kapcsold ki" -- ugyanaz a
   * teendo, a keperno sajat szavaval.
   */
  it("a mondat a telefon kapcsolójára utal", () => {
    const uzenet = munkaoraEgysegFigyelmeztetes({ kind: "LABOR", unit: "db" });
    assert.ok(uzenet);
    assert.match(uzenet, /kapcsold ki/);
  });
});

/**
 * A KEPERNYO TENYLEG HIVJA -- FORRAS SZINTEN.
 *
 * A modul megléte nem bizonyitja, hogy hasznaljak: ugyanaz a res, amit a
 * webes oldalon a kulon komponens-allitas zar be. Itt nincs renderelo, tehat
 * a HIVAS ALAKJAT merjuk.
 */
describe("a munkalap képernyő bekötése", () => {
  const forras = readFileSync(
    join(__dirname, "..", "..", "..", "src", "app", "worksheets", "[id].tsx"),
    "utf8",
  );

  it("a képernyő a közös szabályt hívja, a KAPCSOLÓ állásával", () => {
    assert.match(
      forras,
      /munkaoraEgysegFigyelmeztetes\(\{\s*kind: isLabor \? "LABOR" : "OTHER",\s*unit,?\s*\}\)/,
    );
  });

  /**
   * ES KI IS RAJZOLJA. Enelkul a fenti allitas egy olyan valtozatot is zolden
   * hagyna, ami kiszamolja az uzenetet, es sehol nem mutatja meg.
   */
  it("POZITÍV KONTROLL: a képernyő ki is írja az üzenetet", () => {
    assert.match(forras, /\{egysegFigyelmeztetes\}/);
  });
});
