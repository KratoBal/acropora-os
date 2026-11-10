import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProductHusbandryFacts } from "@acropora/types";

import {
  husbandryWriteErrors,
  missingHusbandryFields,
  normalizedHusbandryTexts,
} from "./product-husbandry.js";

/*
  WHAT TURNS THESE RED (V2.2, card d2fc06e7): the first step given to an Acropora genus, or to a row with no genus; a
  forbidden word let through in a block text; a verification without a source; a required field not named when it is
  missing, or named when it is filled; the wrong space rule for a kind (fish: litres, coral: zone, invertebrate: either);
  a text that is only spaces counted as filled.
*/

function emptyFacts(): ProductHusbandryFacts {
  return {
    magyarNev: null,
    genus: null,
    species: null,
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
    forrasTipus: null,
    forrasHivatkozas: null,
  };
}

function completeFacts(): ProductHusbandryFacts {
  return {
    magyarNev: "Teszt faj",
    genus: "Zebrasoma",
    species: "flavescens",
    careDifficulty: "KOZEPES",
    minLiter: "300",
    medenceErettsegHonap: 6,
    elhelyezesZona: null,
    reefSafe: "IGEN",
    reefSafeIndok: "Nem bántja a korallokat.",
    socialKeeping: "EGYEDUL",
    aggression: ["TERULETVEDO"],
    korallevo: false,
    gerinctelenevo: false,
    feedingType: ["ALGAEVO"],
    etetesGyakorisag: "naponta",
    eloEleseg: false,
    fenyIgeny: "NEM_ERTELMEZHETO",
    aramlasIgeny: "KOZEPES",
    meretMax: "20",
    meretDimenzio: "TESTHOSSZ",
    szarmazas: "VADFOGAS",
    kinekNem: "Kis medencébe nem ajánljuk.",
    forrasTipus: "szakirodalom",
    forrasHivatkozas: "https://example.invalid/forras",
  };
}

describe("a tartási blokk írási szabályai", () => {
  it("Acropora nemzetségre az 1-es fokozat nem adható, kis- és nagybetűtől függetlenül", () => {
    for (const genus of ["Acropora", "acropora", "  ACROPORA "]) {
      const errors = husbandryWriteErrors(
        {
          patch: { careDifficulty: "KONNYU", genus },
          current: emptyFacts(),
        },
        false,
      );
      assert.equal(errors.length, 1, genus);
      assert.match(errors[0]!, /Acropora/);
    }
  });

  it("nemzetség nélkül az 1-es fokozat nem adható: a szabály nem alkalmazható, tehát nem megy át", () => {
    const errors = husbandryWriteErrors(
      { patch: { careDifficulty: "KONNYU" }, current: emptyFacts() },
      false,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /nemzetség/);
  });

  it("más nemzetségre az 1-es fokozat adható, és a tárolt nemzetséget is látja a javítás", () => {
    assert.deepEqual(
      husbandryWriteErrors(
        {
          patch: { careDifficulty: "KONNYU" },
          current: { ...emptyFacts(), genus: "Zebrasoma" },
        },
        false,
      ),
      [],
    );
    // a tárolt nemzetség Acropora, a javítás csak a fokozatot adja: ez is elutasított
    assert.equal(
      husbandryWriteErrors(
        {
          patch: { careDifficulty: "KONNYU" },
          current: { ...emptyFacts(), genus: "Acropora" },
        },
        false,
      ).length,
      1,
    );
  });

  it("a 2-4. fokozat Acropora-ra adható", () => {
    for (const careDifficulty of ["KOZEPES", "HALADO", "SZAKERTO"] as const)
      assert.deepEqual(
        husbandryWriteErrors(
          {
            patch: { careDifficulty, genus: "Acropora" },
            current: emptyFacts(),
          },
          false,
        ),
        [],
      );
  });

  it("a tiltott szavak kiesnek a blokk szövegeiből, ragozva is", () => {
    for (const text of [
      "Tökéletes kezdőknek",
      "mindenkinek ajánljuk",
      "problémamentes faj",
      "tökéletesen alkalmas",
    ])
      for (const key of [
        "reefSafeIndok",
        "kinekNem",
        "etetesGyakorisag",
      ] as const)
        assert.equal(
          husbandryWriteErrors(
            { patch: { [key]: text }, current: emptyFacts() },
            false,
          ).length,
          1,
          `${key}: ${text}`,
        );
  });

  it("a szó nélküli szöveg átmegy", () => {
    assert.deepEqual(
      husbandryWriteErrors(
        {
          patch: { kinekNem: "Kis medencébe nem ajánljuk." },
          current: emptyFacts(),
        },
        false,
      ),
      [],
    );
  });

  it("az ellenőrzéshez a forrás típusa és hivatkozása is kell, a tárolt érték is számít", () => {
    assert.equal(
      husbandryWriteErrors({ patch: {}, current: emptyFacts() }, true).length,
      2,
    );
    assert.equal(
      husbandryWriteErrors(
        { patch: { forrasTipus: "gyártó" }, current: emptyFacts() },
        true,
      ).length,
      1,
    );
    assert.deepEqual(
      husbandryWriteErrors(
        {
          patch: { forrasHivatkozas: "https://example.invalid/x" },
          current: { ...emptyFacts(), forrasTipus: "gyártó" },
        },
        true,
      ),
      [],
    );
    // csak szóköz nem forrás
    assert.equal(
      husbandryWriteErrors(
        {
          patch: { forrasTipus: "  ", forrasHivatkozas: "x" },
          current: emptyFacts(),
        },
        true,
      ).length,
      1,
    );
  });
});

describe("a hiányzó kötelező mezők", () => {
  it("üres adatnál mindet megnevezi, a tiltott fokozat-mezőt is, és az ellenőrzést", () => {
    const missing = missingHusbandryFields(emptyFacts(), "FISH", false);
    for (const key of [
      "magyarNev",
      "genus",
      "careDifficulty",
      "medenceErettsegHonap",
      "reefSafe",
      "reefSafeIndok",
      "socialKeeping",
      "aggression",
      "korallevo",
      "gerinctelenevo",
      "feedingType",
      "etetesGyakorisag",
      "eloEleseg",
      "fenyIgeny",
      "aramlasIgeny",
      "meretMax",
      "meretDimenzio",
      "szarmazas",
      "kinekNem",
      "forrasTipus",
      "forrasHivatkozas",
      "minLiter",
      "verification",
    ])
      assert.ok(missing.includes(key), key);
    assert.ok(!missing.includes("elhelyezesZona"));
  });

  it("a teljes hal-adat ellenőrzéssel nem hiányos, ellenőrzés nélkül csak az ellenőrzés hiányzik", () => {
    assert.deepEqual(missingHusbandryFields(completeFacts(), "FISH", true), []);
    assert.deepEqual(missingHusbandryFields(completeFacts(), "FISH", false), [
      "verification",
    ]);
  });

  it("a hamis és a nulla érték kitöltött (a nem igen/nem válasz is válasz), az üres szöveg és az üres lista nem", () => {
    const facts = { ...completeFacts(), korallevo: false, eloEleseg: false };
    assert.deepEqual(missingHusbandryFields(facts, "FISH", true), []);
    assert.deepEqual(
      missingHusbandryFields(
        { ...facts, medenceErettsegHonap: 0 },
        "FISH",
        true,
      ),
      [],
    );
    assert.deepEqual(
      missingHusbandryFields({ ...facts, kinekNem: "   " }, "FISH", true),
      ["kinekNem"],
    );
    assert.deepEqual(
      missingHusbandryFields({ ...facts, aggression: [] }, "FISH", true),
      ["aggression"],
    );
  });

  it("a tér-szabály fajtánként: hal literrel, korall zónával, gerinctelen bármelyikkel", () => {
    const noSpace = {
      ...completeFacts(),
      minLiter: null,
      elhelyezesZona: null,
    };
    assert.deepEqual(missingHusbandryFields(noSpace, "FISH", true), [
      "minLiter",
    ]);
    assert.deepEqual(missingHusbandryFields(noSpace, "CORAL", true), [
      "elhelyezesZona",
    ]);
    assert.deepEqual(missingHusbandryFields(noSpace, "INVERTEBRATE", true), [
      "minLiter",
    ]);
    // a hal zónája nem pótolja a literét, a korall literje nem pótolja a zónáját
    assert.deepEqual(
      missingHusbandryFields(
        { ...noSpace, elhelyezesZona: "ALSO" },
        "FISH",
        true,
      ),
      ["minLiter"],
    );
    assert.deepEqual(
      missingHusbandryFields({ ...noSpace, minLiter: "100" }, "CORAL", true),
      ["elhelyezesZona"],
    );
    // a gerinctelennél bármelyik elég
    assert.deepEqual(
      missingHusbandryFields(
        { ...noSpace, elhelyezesZona: "KOZEPSO" },
        "INVERTEBRATE",
        true,
      ),
      [],
    );
    assert.deepEqual(
      missingHusbandryFields(
        { ...noSpace, minLiter: "50" },
        "INVERTEBRATE",
        true,
      ),
      [],
    );
  });

  it("ismeretlen fajtánál megnevezi a fajtát, és nem tippel tér-szabályt", () => {
    const missing = missingHusbandryFields(
      { ...completeFacts(), minLiter: null },
      null,
      true,
    );
    assert.deepEqual(missing, ["livestockKind"]);
  });
});

describe("a szövegek normalizálása", () => {
  it("levágja a szóközt, az üres szöveg null (törlés), a nem szöveg és a hiányzó kulcs változatlan", () => {
    assert.deepEqual(
      normalizedHusbandryTexts({
        genus: "  Zebrasoma ",
        kinekNem: "   ",
        forrasTipus: "",
        medenceErettsegHonap: 6,
        reefSafeIndok: null,
      }),
      {
        genus: "Zebrasoma",
        kinekNem: null,
        forrasTipus: null,
        medenceErettsegHonap: 6,
        reefSafeIndok: null,
      },
    );
    const untouched = normalizedHusbandryTexts({ careDifficulty: "HALADO" });
    assert.deepEqual(untouched, { careDifficulty: "HALADO" });
    assert.ok(!("genus" in untouched));
  });
});
