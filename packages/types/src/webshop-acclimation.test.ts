import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WEBSHOP_ACCLIMATION_TEXTS,
  WEBSHOP_LIVESTOCK_KINDS,
  isWebshopLivestockKind,
  webshopAcclimationValue,
  type WebshopAcclimationTexts,
} from "./webshop-acclimation.js";

/*
  AZ AKKLIMATIZACIOS SZAKASZ ERTEKE (V2.6, kartya f4e4832b). MI PIROSIT: ha a
  fajtak sorrendje a rendeles sorrendjet kovetne (ket levelsorrend egy kosarra); ha
  egy fajta szoveg nelkul is hagyna uressort vagy masik fajta szoveget vinne; ha
  az angol level a magyar utmutatot kapna (vagy forditva); ha a kozos fajta ketszer
  szerepelne.
*/
const TEXTS: WebshopAcclimationTexts = {
  hu: {
    FISH: "Hal hu",
    INVERTEBRATE: "  Gerinctelen hu \n",
    CORAL: "Korall hu",
  },
  en: { FISH: "Fish en", CORAL: "Coral en" },
};

describe("the acclimatisation value", () => {
  it("knows the three kinds the shop sends", () => {
    assert.deepEqual(
      [...WEBSHOP_LIVESTOCK_KINDS],
      ["FISH", "INVERTEBRATE", "CORAL"],
    );
    assert.equal(isWebshopLivestockKind("CORAL"), true);
    for (const bad of ["coral", "", "SHRIMP", null, undefined, 1])
      assert.equal(isWebshopLivestockKind(bad), false);
  });

  // the default argument is the shipped table, whatever it holds (empty until the shop's texts arrive)
  it("without a table argument the value comes from the shipped table", () => {
    for (const locale of ["hu", "en"] as const) {
      const expected = WEBSHOP_LIVESTOCK_KINDS.map((kind) =>
        (WEBSHOP_ACCLIMATION_TEXTS[locale][kind] ?? "").trim(),
      )
        .filter((text) => text !== "")
        .join("\n\n");
      assert.equal(
        webshopAcclimationValue([...WEBSHOP_LIVESTOCK_KINDS], locale),
        expected,
      );
    }
  });

  it("an order with no live animal gets no value, whatever the table holds", () => {
    assert.equal(webshopAcclimationValue([], "hu", TEXTS), "");
  });

  it("one text per kind, in the fixed kind order, a repeated kind once, a blank line between", () => {
    assert.equal(
      webshopAcclimationValue(["CORAL", "FISH", "CORAL"], "hu", TEXTS),
      "Hal hu\n\nKorall hu",
    );
    assert.equal(
      webshopAcclimationValue(["CORAL", "INVERTEBRATE", "FISH"], "hu", TEXTS),
      "Hal hu\n\nGerinctelen hu\n\nKorall hu",
    );
  });

  it("a kind with no text adds nothing: no gap, no other kind's advice", () => {
    assert.equal(
      webshopAcclimationValue(["INVERTEBRATE", "CORAL"], "en", TEXTS),
      "Coral en",
    );
    assert.equal(webshopAcclimationValue(["INVERTEBRATE"], "en", TEXTS), "");
  });

  it("each language reads its own table only", () => {
    assert.equal(webshopAcclimationValue(["FISH"], "en", TEXTS), "Fish en");
    assert.equal(webshopAcclimationValue(["FISH"], "hu", TEXTS), "Hal hu");
    const onlyHungarian: WebshopAcclimationTexts = { hu: TEXTS.hu, en: {} };
    assert.equal(webshopAcclimationValue(["FISH"], "en", onlyHungarian), "");
  });

  it("a text of spaces is no text", () => {
    assert.equal(
      webshopAcclimationValue(["FISH"], "hu", {
        hu: { FISH: "   \n " },
        en: {},
      }),
      "",
    );
  });
});
