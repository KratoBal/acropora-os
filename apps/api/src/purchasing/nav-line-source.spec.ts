import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NO_NAV_LINE_SOURCE,
  navLineSource,
  navSourceLines,
  pairExistingLines,
} from "./nav-line-source.js";

describe("navSourceLines: a tárolt NAV adat sorai", () => {
  it("a parser alakja: sorszám és szöveg", () => {
    assert.deepEqual(
      navSourceLines({
        supplierName: "X",
        lines: [
          { lineNumber: 1, description: "Só", quantity: "1" },
          { lineNumber: 2, description: "Pumpa" },
        ],
      }),
      [
        { lineNumber: 1, description: "Só" },
        { lineNumber: 2, description: "Pumpa" },
      ],
    );
  });

  it("nincs adat vagy más alak: null", () => {
    for (const ertek of [null, undefined, "x", 5, {}, { lines: "x" }])
      assert.equal(navSourceLines(ertek), null, JSON.stringify(ertek));
  });

  it("szöveg nélküli elem kimarad; rossz sorszám null-ra vált, de a szöveg marad", () => {
    assert.deepEqual(
      navSourceLines({
        lines: [
          { lineNumber: 1 },
          { lineNumber: 2, description: "" },
          null,
          { lineNumber: 1.5, description: "tört" },
          { lineNumber: 0, description: "nulla" },
          { lineNumber: "3", description: "szöveges szám" },
          { lineNumber: 2_147_483_648, description: "túl nagy" },
          { lineNumber: 2_147_483_647, description: "legnagyobb" },
        ],
      }),
      [
        { lineNumber: null, description: "tört" },
        { lineNumber: null, description: "nulla" },
        { lineNumber: null, description: "szöveges szám" },
        { lineNumber: null, description: "túl nagy" },
        { lineNumber: 2_147_483_647, description: "legnagyobb" },
      ],
    );
  });
});

describe("navLineSource: egy új sor forrása", () => {
  const SOROK = [
    { lineNumber: 1, description: "Só" },
    { lineNumber: 2, description: "Pumpa A" },
    { lineNumber: 2, description: "Pumpa B" },
    { lineNumber: null, description: "rossz" },
  ];

  it("pontosan egy egyező sorszám: a NAV szövege", () => {
    assert.deepEqual(navLineSource(SOROK, 1), {
      navLineNumber: 1,
      navLineDescription: "Só",
    });
  });

  it("nincs ilyen, kétszer áll, nincs sorszám vagy nincs NAV adat: mindkettő null", () => {
    assert.deepEqual(navLineSource(SOROK, 9), NO_NAV_LINE_SOURCE);
    assert.deepEqual(navLineSource(SOROK, 2), NO_NAV_LINE_SOURCE);
    assert.deepEqual(navLineSource(SOROK, undefined), NO_NAV_LINE_SOURCE);
    assert.deepEqual(navLineSource(null, 1), NO_NAV_LINE_SOURCE);
  });
});

describe("pairExistingLines: a meglévő sorok visszatöltése", () => {
  const sor = (
    id: string,
    sourceDescription: string | null,
    navLineNumber: number | null = null,
  ) => ({ id, sourceDescription, navLineNumber });

  it("csak a pontos, mindkét oldalon egyszer álló szöveg párosul", () => {
    const eredmeny = pairExistingLines(
      [
        sor("a", "Reef Salt 20kg"),
        sor("b", "reef salt 20kg"),
        sor("c", "Pumpa"),
        sor("d", "Pumpa"),
        sor("e", "Szűrő"),
        sor("f", null),
        sor("g", ""),
        sor("h", "Kézi tétel"),
        sor("i", "Lámpa", 7),
        sor("j", "Rossz sorszám"),
      ],
      [
        { lineNumber: 1, description: "Reef Salt 20kg" },
        { lineNumber: 2, description: "Pumpa" },
        { lineNumber: 3, description: "Szűrő" },
        { lineNumber: 4, description: "Szűrő" },
        { lineNumber: 5, description: "Lámpa" },
        { lineNumber: null, description: "Rossz sorszám" },
      ],
    );
    assert.deepEqual(eredmeny.pairs, [
      { id: "a", navLineNumber: 1, navLineDescription: "Reef Salt 20kg" },
    ]);
    assert.deepEqual(eredmeny.skipped, {
      alreadySet: 1,
      noText: 2,
      noMatch: 2,
      ambiguous: 3,
      invalidLineNumber: 1,
    });
  });

  it("minden sor pontosan egy helyre kerül: párba vagy egy okhoz", () => {
    const sorok = [
      sor("a", "x"),
      sor("b", "y"),
      sor("c", "y"),
      sor("d", null),
      sor("e", "z", 1),
    ];
    const { pairs, skipped } = pairExistingLines(sorok, [
      { lineNumber: 1, description: "x" },
      { lineNumber: 2, description: "y" },
    ]);
    const osszes =
      pairs.length + Object.values(skipped).reduce((a, b) => a + b, 0);
    assert.equal(osszes, sorok.length);
  });
});
