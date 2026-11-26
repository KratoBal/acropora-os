import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_GLOSSARY_LIMITS,
  hasAiGlossaryControlCharacter,
  parseAiGlossarySaveInput,
} from "./ai-glossary.js";

/*
  AZ AI SZÓJEGYZÉK MENTÉSÉNEK SZABÁLYAI (kártya 7a5ea203, C2). MI PIROSÍT: egy hiányzó kiinduló verzió átjut (az elveszett frissítés
  védelem csendben kikapcsol); a szerver mezői (createdBy, approvedBy, approvedAt) átjutnak; sortörés vagy vezérlő-, láthatatlan,
  irányváltó karakter átjut a modell utasításába; üres, túl hosszú vagy kétszer szereplő sor átjut; az ékezetes magyar szöveg
  elutasul (a kontroll).
*/
const row = (overrides: Record<string, unknown> = {}) => ({
  abbreviation: "ATO",
  original: "Automatic Top Off",
  language: "en",
  hungarian: "automatikus párolgás-utántöltő rendszer",
  approved: true,
  ...overrides,
});
const body = (overrides: Record<string, unknown> = {}) => ({
  expectedVersion: 1,
  note: "ATO magyar neve",
  entries: [
    row(),
    row({
      abbreviation: "KH",
      original: "Karbonathärte",
      language: "de",
      hungarian: "karbonátkeménység",
      approved: false,
    }),
  ],
  ...overrides,
});

describe("az AI szójegyzék mentése", () => {
  it("a jó törzset elfogadja, a szövegek szélét levágja, a megjegyzés elhagyható, a null kiinduló verzió is jó", () => {
    const parsed = parseAiGlossarySaveInput(
      body({
        note: undefined,
        expectedVersion: null,
        entries: [row({ abbreviation: " ATO ", hungarian: " név " })],
      }),
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.expectedVersion, null);
      assert.equal(parsed.value.note, "");
      assert.deepEqual(
        parsed.value.entries[0],
        row({ abbreviation: "ATO", hungarian: "név" }),
      );
    }
  });

  const refused: Array<[string, unknown, RegExp]> = [
    ["nem objektum", [], /törzse/],
    [
      "hiányzó kiinduló verzió",
      (() => {
        const b = body();
        delete (b as Record<string, unknown>).expectedVersion;
        return b;
      })(),
      /melyik verzióból/,
    ],
    ["nulla verzió", body({ expectedVersion: 0 }), /verzió száma/],
    ["tört verzió", body({ expectedVersion: 1.5 }), /verzió száma/],
    ["szöveges verzió", body({ expectedVersion: "1" }), /verzió száma/],
    [
      "a szerver mezője (createdBy)",
      body({ createdBy: "valaki" }),
      /Ismeretlen mező: createdBy/,
    ],
    [
      "a szerver mezője a soron (approvedBy)",
      body({ entries: [row({ approvedBy: "valaki" })] }),
      /approvedBy/,
    ],
    ["nem lista", body({ entries: "x" }), /listája hiányzik/],
    ["üres lista", body({ entries: [] }), /nem lehet üres/],
    [
      "rossz nyelv",
      body({ entries: [row({ language: "fr" })] }),
      /angol vagy német/,
    ],
    [
      "nem logikai jelölő",
      body({ entries: [row({ approved: "igen" })] }),
      /jelölője/,
    ],
    ["üres szöveg", body({ entries: [row({ hungarian: "  " })] }), /üres/],
    [
      "hosszú magyar név",
      body({
        entries: [
          row({ hungarian: "x".repeat(AI_GLOSSARY_LIMITS.hungarian + 1) }),
        ],
      }),
      /túl hosszú/,
    ],
    [
      "hosszú megjegyzés",
      body({ note: "x".repeat(AI_GLOSSARY_LIMITS.note + 1) }),
      /Megjegyzés|megjegyzés/,
    ],
    [
      "kétszer szereplő rövidítés",
      body({ entries: [row(), row()] }),
      /kétszer/,
    ],
    [
      "túl sok sor",
      body({
        entries: Array.from(
          { length: AI_GLOSSARY_LIMITS.entries + 1 },
          (_, i) => row({ abbreviation: `A${i}` }),
        ),
      }),
      /legfeljebb/,
    ],
  ];
  for (const [name, input, message] of refused) {
    it(`${name}: elutasítja`, () => {
      const parsed = parseAiGlossarySaveInput(input);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.match(parsed.message, message);
    });
  }
});

describe("egysoros szöveg, vezérlőkarakter nélkül", () => {
  // a karakterek kódpontból, nem a forrásban: egy láthatatlan karakter a forrásban olvashatatlan lenne
  const codes = [
    0x0a, 0x0d, 0x09, 0x00, 0x85, 0x200b, 0x2028, 0x2029, 0x202e, 0x2066,
    0xfeff,
  ];

  it("minden tiltott karaktert elutasít a három szövegben, a megjegyzésben is", () => {
    for (const code of codes) {
      const bad = `ab${String.fromCodePoint(code)}cd`;
      for (const field of ["abbreviation", "original", "hungarian"] as const) {
        const parsed = parseAiGlossarySaveInput(
          body({ entries: [row({ [field]: bad })] }),
        );
        assert.equal(parsed.ok, false, `${code.toString(16)} in ${field}`);
        if (!parsed.ok) assert.match(parsed.message, /egy sorban/);
      }
      assert.equal(
        parseAiGlossarySaveInput(body({ note: bad })).ok,
        false,
        `${code.toString(16)} in the note`,
      );
    }
  });

  it("az ékezetes magyar szöveget, kötőjelet, vesszőt, zárójelet és idézőjelet elfogadja (kontroll)", () => {
    const good = "induktív csatolású plazma, ICP-OES (vízelemzés) „példa”";
    assert.equal(hasAiGlossaryControlCharacter(good), false);
    assert.equal(
      parseAiGlossarySaveInput(body({ entries: [row({ hungarian: good })] }))
        .ok,
      true,
    );
  });
});
