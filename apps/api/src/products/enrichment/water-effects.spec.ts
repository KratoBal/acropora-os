import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { productFactsFrom } from "./enrichment-run.store.js";
import { waterEffectsFromCategories } from "./water-effects-category.js";
import { readWaterEffects } from "./water-effects-lexicon.js";

/**
 * A VÍZHATÁS KÉT FORRÁSA (kártya 2b3983e1, D1): a szótár a forrásoldal
 * leírására és a kategória-szabály a UNAS-ágra. MI PIROSÍT: egy tagadott
 * találat számít; egy kódra mindkét irány értéket ad; egy adalék leírásában
 * álló „sea salt” sótartalmat állít; a kategória-szabály rossz szülő alatt is
 * elsül, vagy a márka-alág alatt nem.
 */
describe("a szótár a leírásra", () => {
  it("angol, magyar és német kifejezés, ékezettől és kis-nagybetűtől függetlenül", () => {
    assert.equal(
      readWaterEffects(
        "Raises alkalinity quickly. A calcium supplement for reefs.",
      ).raw,
      "KALCIUM:EMEL;KH:EMEL",
    );
    assert.equal(
      readWaterEffects(
        "Gyorsan EMELI A KALCIUMSZINTET és a magnéziumszintet nem.",
      ).raw,
      "KALCIUM:EMEL",
    );
    assert.equal(
      readWaterEffects("Hochwirksamer Phosphatentferner für Meerwasser.").raw,
      "FOSZFAT:CSOKKENT",
    );
  });

  it("a kivonat a találat körüli nyers szöveg, ékezettel", () => {
    const r = readWaterEffects(
      "Ez a termék gyorsan emeli a kalciumszintet a tengeri akváriumban.",
    );
    assert.match(r.excerpt!, /^KALCIUM:EMEL: .*emeli a kalciumszintet/);
  });

  it("a tagadott találat nem számít, de feljegyződik", () => {
    const r = readWaterEffects(
      "Removes phosphate. Does not lower the pH of your aquarium.",
    );
    assert.equal(r.raw, "FOSZFAT:CSOKKENT");
    assert.equal(r.negated.length, 1);
    assert.match(r.negated[0]!, /^PH:CSOKKENT /);
  });

  it("egy kódra mindkét irány: arra a kódra nincs érték, a többi marad", () => {
    const r = readWaterEffects(
      "Raises alkalinity at first, then lowers alkalinity overnight. Removes nitrate.",
    );
    assert.equal(r.raw, "NITRAT:CSOKKENT");
    assert.deepEqual(r.contradicted, ["KH"]);
  });

  it("ami nem hatás-állítás, nem találat", () => {
    for (const text of [
      "Mix with sea salt before use.",
      "Detoxifies ammonia and chlorine.",
      "A pH buffer for stable values.",
      "Kompatibilis a 40 kHz-es vezérlővel.",
    ])
      assert.equal(readWaterEffects(text).raw, null, text);
  });
});

describe("a kategória-szabály a UNAS-ágra", () => {
  it("a megkötők ága a szülőjével együtt, a hivatkozás az ág", () => {
    assert.deepEqual(
      waterEffectsFromCategories([
        { chain: ["Termékek", "Problémamegoldás", "Foszfátmegkötők"] },
      ]),
      {
        raw: "FOSZFAT:CSOKKENT",
        sourceRef: "unas-category:Problémamegoldás > Foszfátmegkötők",
      },
    );
  });

  it("a márka-alág is számít, és két ág hatása unió", () => {
    assert.equal(
      waterEffectsFromCategories([
        { chain: ["Termékek", "Tengeri só", "Red Sea - Tengeri só"] },
        { chain: ["Termékek", "Vízkezelés", "Szilikát megkötők"] },
      ])?.raw,
      "SOTARTALOM:EMEL;SZILIKAT:CSOKKENT",
    );
  });

  it("szabály nélküli ág, vagy azonos név más szülő alatt: nincs állítás", () => {
    assert.equal(
      waterEffectsFromCategories([
        { chain: ["Termékek", "Nyomelemek", "Triton"] },
        { chain: ["Termékek", "Egyéb", "Foszfátmegkötők"] },
      ]),
      null,
    );
  });

  it("a tény-olvasó a kategória-állítást UNAS_CURRENT forrásként adja", () => {
    const f = productFactsFrom({
      id: "p-1",
      name: "Kitalált megkötő",
      brand: null,
      unasSnapshot: null,
      categories: [
        {
          category: {
            name: "Nitrátmegkötők",
            parent: { name: "Problémamegoldás", parent: { name: "Termékek" } },
          },
        },
      ],
      variants: [],
    });
    assert.equal(f.current.waterParameterEffects, "NITRAT:CSOKKENT");
    assert.deepEqual(f.currentSource?.waterParameterEffects, {
      sourceType: "UNAS_CURRENT",
      sourceRef: "unas-category:Problémamegoldás > Nitrátmegkötők",
    });
  });
});
