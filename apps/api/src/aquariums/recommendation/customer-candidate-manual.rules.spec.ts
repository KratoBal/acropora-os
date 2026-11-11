import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  harmsWanted,
  manualMatches,
  mergeCandidateMatches,
  type ManualEntryInput,
} from "./customer-candidate-manual.rules.js";

/**
 * A KÉZI SOROK A VEVŐI JELÖLTEKBEN (V3.4 S2c-2). MI PIROSÍT: egy PENDING sorú termék (akár csak az egyik sora) jelöltként kimegy; a bolti
 * szöveg alapú sor kapcsoló nélkül ajánlásra kerül; egy másik sor hatása (a termék minden mozgása) kimarad az ellentétes-hatás szűrőből,
 * vagy a szűrő a nem engedett alapú sor hatását is kihagyja; a mellékhatás-lista nem egyesül; nem https hivatkozás átmegy; a JEV és a
 * kézi út egyesítésekor a hivatkozás nem a gyártóié (JEV), vagy a hatások nem egyesülnek.
 */
const entry = (over: Partial<ManualEntryInput> = {}): ManualEntryInput => ({
  productId: "p1",
  parameterCode: "KH",
  direction: "EMEL",
  referenceUrl: "https://shop.example/p1",
  basis: "MAKER",
  sideEffects: [],
  sideEffectsStatus: "FILLED",
  ...over,
});
const wantedKh = new Map<string, "EMEL" | "CSOKKENT">([["KH", "EMEL"]]);

describe("manualMatches", () => {
  it("a complete product offered for its move: the reference and its kind, the effects and the side effects", () => {
    const [match, ...rest] = manualMatches(
      [entry({ sideEffects: ["FOSZFAT:CSOKKENT", "PH:EMEL"] })],
      wantedKh,
      { allowShopText: false },
    );
    assert.equal(rest.length, 0);
    assert.deepEqual(match, {
      productId: "p1",
      effects: [{ parameterCode: "KH", direction: "EMEL" }],
      sideEffects: [
        { parameterCode: "FOSZFAT", direction: "CSOKKENT" },
        { parameterCode: "PH", direction: "EMEL" },
      ],
      evidenceRef: "https://shop.example/p1",
      referenceKind: "MAKER",
    });
  });

  it("a PENDING row keeps its whole product out, even when the PENDING row is another move and the move asked for is filled", () => {
    for (const rows of [
      [entry({ sideEffectsStatus: "PENDING" })],
      [
        entry(),
        entry({ parameterCode: "KALCIUM", sideEffectsStatus: "PENDING" }),
      ],
    ])
      assert.deepEqual(
        manualMatches(rows, wantedKh, { allowShopText: true }),
        [],
      );
  });

  it("a shop-text row is offered only with the switch; the maker row of the same product is offered either way", () => {
    const shop = entry({ basis: "SHOP_TEXT" });
    assert.deepEqual(
      manualMatches([shop], wantedKh, { allowShopText: false }),
      [],
    );
    assert.equal(
      manualMatches([shop], wantedKh, { allowShopText: true })[0]!
        .referenceKind,
      "SHOP_TEXT",
    );
    assert.equal(
      manualMatches([entry()], wantedKh, { allowShopText: false })[0]!
        .referenceKind,
      "MAKER",
    );
  });

  it("the effects come from EVERY row of the product, a shop-text row the switch does not allow included: knowing an effect is not recommending", () => {
    const rows = [
      entry(),
      entry({ parameterCode: "KALCIUM", basis: "SHOP_TEXT" }),
    ];
    const [match] = manualMatches(rows, wantedKh, { allowShopText: false });
    assert.deepEqual(match!.effects, [
      { parameterCode: "KALCIUM", direction: "EMEL" },
      { parameterCode: "KH", direction: "EMEL" },
    ]);
    // so a customer whose calcium is HIGH (wants it down) is not sent a product that raises it
    const wanted = new Map<string, "EMEL" | "CSOKKENT">([
      ["KH", "EMEL"],
      ["KALCIUM", "CSOKKENT"],
    ]);
    assert.deepEqual(manualMatches(rows, wanted, { allowShopText: false }), []);
  });

  it("the side effects of all rows of a product are one list, without repeats; a malformed or approved-parameter entry is dropped", () => {
    const [match] = manualMatches(
      [
        entry({ sideEffects: ["FOSZFAT:CSOKKENT", "bad", "KH:EMEL", "A:B"] }),
        entry({ parameterCode: "NITRAT", sideEffects: ["FOSZFAT:CSOKKENT"] }),
      ],
      wantedKh,
      { allowShopText: false },
    );
    assert.deepEqual(match!.sideEffects, [
      { parameterCode: "FOSZFAT", direction: "CSOKKENT" },
    ]);
  });

  it("a non-https reference and a parameter outside the approved four are never offered", () => {
    assert.deepEqual(
      manualMatches([entry({ referenceUrl: "http://x.example/p" })], wantedKh, {
        allowShopText: true,
      }),
      [],
    );
    assert.deepEqual(
      manualMatches(
        [entry({ parameterCode: "FOSZFAT" })],
        new Map([["FOSZFAT", "CSOKKENT" as const]]),
        { allowShopText: true },
      ),
      [],
    );
  });

  it("a product is offered once however many of its rows match; a maker row comes before a shop-text one", () => {
    const wanted = new Map<string, "EMEL" | "CSOKKENT">([
      ["KH", "EMEL"],
      ["KALCIUM", "EMEL"],
    ]);
    const matches = manualMatches(
      [
        entry({ basis: "SHOP_TEXT", referenceUrl: "https://shop.example/a" }),
        entry({
          parameterCode: "KALCIUM",
          referenceUrl: "https://maker.example/b",
        }),
      ],
      wanted,
      { allowShopText: true },
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.referenceKind, "MAKER");
    assert.equal(matches[0]!.evidenceRef, "https://maker.example/b");
  });
});

describe("mergeCandidateMatches", () => {
  const jev = (
    over: Partial<{
      productId: string;
      effects: { parameterCode: string; direction: "EMEL" | "CSOKKENT" }[];
      sideEffects: { parameterCode: string; direction: "EMEL" | "CSOKKENT" }[];
      evidenceRef: string;
    }> = {},
  ) => ({
    productId: "p1",
    effects: [{ parameterCode: "KH", direction: "EMEL" as const }],
    sideEffects: [],
    evidenceRef: "https://maker.example/jev",
    ...over,
  });
  const none = new Map();

  it("the same product on both paths: the maker's JEV reference wins and the effects and side effects are one list", () => {
    const manual = manualMatches(
      [
        entry({
          basis: "SHOP_TEXT",
          parameterCode: "KALCIUM",
          sideEffects: ["PH:EMEL"],
        }),
      ],
      new Map([["KALCIUM", "EMEL" as const]]),
      { allowShopText: true },
    );
    const [merged, ...rest] = mergeCandidateMatches(
      [
        jev({
          sideEffects: [{ parameterCode: "FOSZFAT", direction: "CSOKKENT" }],
        }),
      ],
      manual,
      none,
      new Map([["KH", "EMEL" as const]]),
    );
    assert.equal(rest.length, 0);
    assert.equal(merged!.evidenceRef, "https://maker.example/jev");
    assert.equal(merged!.referenceKind, "MAKER");
    assert.deepEqual(
      merged!.effects.map(
        (effect) => `${effect.parameterCode}:${effect.direction}`,
      ),
      ["KALCIUM:EMEL", "KH:EMEL"],
    );
    assert.deepEqual(
      merged!.sideEffects.map((effect) => effect.parameterCode),
      ["FOSZFAT", "PH"],
    );
  });

  it("a manual-only product keeps its own reference and kind, and the JEV's verified effects of that product join its effects", () => {
    const manual = manualMatches([entry({ basis: "SHOP_TEXT" })], wantedKh, {
      allowShopText: true,
    });
    const [merged] = mergeCandidateMatches<ReturnType<typeof jev>>(
      [],
      manual,
      new Map([
        [
          "p1",
          {
            effects: [{ parameterCode: "NITRAT", direction: "EMEL" as const }],
            sideEffects: [
              { parameterCode: "PH", direction: "CSOKKENT" as const },
            ],
          },
        ],
      ]),
      wantedKh,
    );
    assert.equal(merged!.referenceKind, "SHOP_TEXT");
    assert.equal(merged!.evidenceRef, "https://shop.example/p1");
    assert.deepEqual(
      merged!.effects.map(
        (effect) => `${effect.parameterCode}:${effect.direction}`,
      ),
      ["KH:EMEL", "NITRAT:EMEL"],
    );
    assert.deepEqual(merged!.sideEffects, [
      { parameterCode: "PH", direction: "CSOKKENT" },
    ]);
  });

  it("an effect the other path knows can knock a candidate out: the opposite-effect filter runs AFTER the merge", () => {
    const wanted = new Map<string, "EMEL" | "CSOKKENT">([
      ["KH", "EMEL"],
      ["NITRAT", "CSOKKENT"],
    ]);
    const manual = manualMatches([entry()], wanted, { allowShopText: false });
    assert.equal(manual.length, 1);
    const merged = mergeCandidateMatches<ReturnType<typeof jev>>(
      [],
      manual,
      new Map([
        [
          "p1",
          {
            effects: [{ parameterCode: "NITRAT", direction: "EMEL" as const }],
            sideEffects: [],
          },
        ],
      ]),
      wanted,
    );
    assert.deepEqual(merged, []);
  });

  it("a JEV-only product passes through as a maker reference", () => {
    const [merged] = mergeCandidateMatches([jev()], [], none, wantedKh);
    assert.equal(merged!.referenceKind, "MAKER");
    assert.equal(merged!.evidenceRef, "https://maker.example/jev");
  });
});

describe("harmsWanted", () => {
  it("only the same parameter in the opposite direction harms; another parameter or the same direction does not", () => {
    const wanted = new Map<string, "EMEL" | "CSOKKENT">([["KH", "EMEL"]]);
    assert.equal(
      harmsWanted([{ parameterCode: "KH", direction: "CSOKKENT" }], wanted),
      true,
    );
    assert.equal(
      harmsWanted([{ parameterCode: "KH", direction: "EMEL" }], wanted),
      false,
    );
    assert.equal(
      harmsWanted([{ parameterCode: "NITRAT", direction: "CSOKKENT" }], wanted),
      false,
    );
  });
});
