import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  HUSBANDRY_VERSION,
  husbandryMetadata,
  projectHusbandryEnabled,
  type HusbandrySourceRow,
} from "./medusa-husbandry.js";
import { isOwnedMetadataKey } from "./medusa-metadata-merge.js";

/*
  WHAT TURNS THESE RED (V2.2 S3, card d2fc06e7): a block that goes out unverified, or for a product that is not a live animal;
  a null fact or an empty list sent as a value; a size sent without what it measures; an internal field (the source, who
  verified, the Hungarian name) in the text; a different key order for the same facts (the projection would rewrite an unchanged
  key); a verified block with nothing to say that still sends a key; the switch that is on for anything but exactly `true`; the
  key not being an owned one (a withdrawn block would stay in the shop).
*/
const VERIFIED = new Date("2026-11-10T10:30:00.000Z");

function row(overrides: Partial<HusbandrySourceRow> = {}): HusbandrySourceRow {
  return {
    careDifficulty: null,
    minLiter: null,
    medenceErettsegHonap: null,
    elhelyezesZona: null,
    reefSafe: null,
    reefSafeIndok: null,
    socialKeeping: null,
    aggression: [],
    korallevo: null,
    gerinctelenevo: null,
    feedingType: [],
    etetesGyakorisag: null,
    eloEleseg: null,
    fenyIgeny: null,
    aramlasIgeny: null,
    meretMax: null,
    meretDimenzio: null,
    szarmazas: null,
    kinekNem: null,
    ellenorizveAt: VERIFIED,
    ...overrides,
  };
}

const parsed = (value: string | null) =>
  JSON.parse(value ?? "null") as Record<string, unknown> | null;

describe("a tartási blokk kulcsa", () => {
  it("csak ellenőrzött blokk megy ki; ellenőrzés nélkül, sor nélkül és érvénytelen időnél semmi", () => {
    const facts = { careDifficulty: "HALADO" };
    assert.notEqual(husbandryMetadata(row(facts), "FISH"), null);
    assert.equal(
      husbandryMetadata(row({ ...facts, ellenorizveAt: null }), "FISH"),
      null,
    );
    assert.equal(husbandryMetadata(null, "FISH"), null);
    assert.equal(husbandryMetadata(undefined, "FISH"), null);
    assert.equal(
      husbandryMetadata(
        row({ ...facts, ellenorizveAt: new Date("nem-datum") }),
        "FISH",
      ),
      null,
    );
  });

  it("csak élő állatra megy ki: ismeretlen fajtánál (nem élő állat, vagy több gyökér alatt) semmi", () => {
    assert.equal(
      husbandryMetadata(row({ careDifficulty: "HALADO" }), null),
      null,
    );
  });

  it("a fajta és az ellenőrzés napja a szövegben áll, napként (nem időpont, nem személy)", () => {
    const out = parsed(
      husbandryMetadata(row({ careDifficulty: "KOZEPES" }), "CORAL"),
    )!;
    assert.equal(out.v, HUSBANDRY_VERSION);
    assert.equal(out.kind, "coral");
    assert.equal(out.verified_on, "2026-11-10");
    assert.equal(
      parsed(
        husbandryMetadata(row({ careDifficulty: "KOZEPES" }), "INVERTEBRATE"),
      )!.kind,
      "invertebrate",
    );
    assert.equal(
      parsed(husbandryMetadata(row({ careDifficulty: "KOZEPES" }), "FISH"))!
        .kind,
      "fish",
    );
  });

  it("a null tény és az üres lista kimarad, a hamis és a nulla érték kimegy (az is válasz)", () => {
    const out = parsed(
      husbandryMetadata(
        row({
          careDifficulty: "KONNYU",
          korallevo: false,
          eloEleseg: false,
          medenceErettsegHonap: 0,
          kinekNem: "   ",
        }),
        "FISH",
      ),
    )!;
    assert.deepEqual(Object.keys(out), [
      "v",
      "kind",
      "verified_on",
      "difficulty",
      "maturity_months",
      "coral_eater",
      "live_food",
    ]);
    assert.equal(out.coral_eater, false);
    assert.equal(out.live_food, false);
    assert.equal(out.maturity_months, 0);
  });

  it("a méret csak a mértékével együtt megy ki, a szám szám, nem szöveg", () => {
    const withBoth = parsed(
      husbandryMetadata(
        row({
          meretMax: "25.50",
          meretDimenzio: "KARFESZTAVOLSAG",
          minLiter: { toString: () => "300" },
        }),
        "FISH",
      ),
    )!;
    assert.deepEqual(withBoth.max_size, {
      value: 25.5,
      dimension: "KARFESZTAVOLSAG",
    });
    assert.equal(withBoth.min_liter, 300);
    assert.equal(
      husbandryMetadata(row({ meretMax: 25 }), "FISH"),
      null,
      "a size with no dimension is not a size, and nothing else was said",
    );
    assert.equal(
      husbandryMetadata(row({ meretDimenzio: "TESTHOSSZ" }), "FISH"),
      null,
    );
  });

  it("ugyanaz a tény ugyanaz a szöveg, a kulcsok rögzített sorrendben (a vetítés nem ír újra változatlan kulcsot)", () => {
    const a = husbandryMetadata(
      row({
        socialKeeping: "PARBAN",
        reefSafe: "IGEN",
        careDifficulty: "HALADO",
        aggression: ["BEKES"],
        feedingType: ["ALGAEVO"],
      }),
      "FISH",
    );
    const b = husbandryMetadata(
      row({
        feedingType: ["ALGAEVO"],
        aggression: ["BEKES"],
        careDifficulty: "HALADO",
        reefSafe: "IGEN",
        socialKeeping: "PARBAN",
      }),
      "FISH",
    );
    assert.equal(a, b);
    assert.deepEqual(Object.keys(parsed(a)!), [
      "v",
      "kind",
      "verified_on",
      "difficulty",
      "reef_safe",
      "social",
      "aggression",
      "feeding",
    ]);
  });

  it("belső mező nem kerül ki: a forrás, az ellenőrző, a magyar név, a nemzetség", () => {
    const withInternals = {
      ...row({ careDifficulty: "HALADO" }),
      forrasTipus: "gyártó",
      forrasHivatkozas: "https://example.invalid/belso",
      ellenorizteUserId: "user-9",
      magyarNev: "Szarvkorall",
      genus: "Acropora",
    } as HusbandrySourceRow;
    const text = husbandryMetadata(withInternals, "CORAL")!;
    for (const secret of [
      "gyártó",
      "example.invalid",
      "user-9",
      "Szarvkorall",
      "Acropora",
      "forras",
      "ellenorizte",
    ])
      assert.equal(text.includes(secret), false, secret);
  });

  it("a szöveges tények szóköz nélkül mennek ki", () => {
    const out = parsed(
      husbandryMetadata(
        row({
          kinekNem: "  Kis medencébe nem ajánljuk. ",
          reefSafeIndok: " Nem bántja. ",
        }),
        "FISH",
      ),
    )!;
    assert.equal(out.not_for, "Kis medencébe nem ajánljuk.");
    assert.equal(out.reef_safe_reason, "Nem bántja.");
  });
});

describe("a kapcsoló", () => {
  it("csak a pontosan `true` kapcsolja be", () => {
    assert.equal(
      projectHusbandryEnabled({ MEDUSA_PROJECT_HUSBANDRY: "true" }),
      true,
    );
    for (const value of ["TRUE", "1", "yes", " true", "false", "", undefined])
      assert.equal(
        projectHusbandryEnabled({ MEDUSA_PROJECT_HUSBANDRY: value }),
        false,
        String(value),
      );
    assert.equal(projectHusbandryEnabled({}), false);
  });
});

describe("a kulcs és a futtató", () => {
  it("a `husbandry` a mi kulcsunk: az összefésülés leveszi, ha elmarad", () => {
    assert.equal(isOwnedMetadataKey("husbandry"), true);
    assert.equal(isOwnedMetadataKey("husbandry_valami"), false);
  });

  const code = (path: string): string =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const runner = code("src/integrations/medusa/medusa-projection.runner.ts");

  it("a futtató a kapcsolóval együtt adja át a szabály válaszát, és a fajtát a kategória-fából veszi", () => {
    assert.match(runner, /husbandry:\s*projectHusbandryEnabled\(env\)/);
    assert.match(
      runner,
      /husbandryMetadata\(\s*product\.datasheet,\s*deriveLivestockKind\(/,
    );
    assert.match(runner, /liveAnimalKindSubtrees\(/);
  });

  it("a futtató kérdése az ellenőrzést kéri, a forrást és az ellenőrzőt NEM", () => {
    const at = runner.indexOf("datasheet: {");
    assert.notEqual(at, -1);
    const select = runner.slice(at, at + 700);
    assert.match(select, /ellenorizveAt:\s*true/);
    assert.match(select, /careDifficulty:\s*true/);
    for (const internal of [
      "forrasTipus",
      "forrasHivatkozas",
      "ellenorizteUserId",
      "magyarNev",
      "genus",
    ])
      assert.equal(select.includes(internal), false, internal);
  });
});
