import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasProductImportRow } from "@acropora/types";

import { BRAND_DICTIONARY, SOURCE_BRAND_NAMES } from "./brand-dictionary.js";
import {
  containsTokenPhrase,
  normalizeBrandText,
  startsWithTokenPhrase,
} from "./brand-normalizer.js";
import { BrandResolutionEngine } from "./brand-resolution.engine.js";
import {
  BRAND_RESOLUTION_THRESHOLDS,
  BRAND_RESOLUTION_VERSIONS,
} from "./brand-resolution.config.js";
import { summarizeBrandResolution } from "./brand-resolution.report.js";

const row = (
  overrides: Partial<UnasProductImportRow> = {},
): UnasProductImportRow => ({
  sourceRowNumber: 2,
  sku: "GEN-001",
  name: "Általános akváriumi termék",
  rawPayload: { source: "synthetic" },
  ...overrides,
});

describe("brand normalization and dictionary", () => {
  it("normalizes Unicode, case, whitespace and punctuation deterministically", () => {
    assert.equal(normalizeBrandText("  ÁQUA---Médic™  "), "aqua medic");
    assert.equal(normalizeBrandText("RedSea"), normalizeBrandText("REDSEA"));
  });

  it("resolves aliases while preserving the 49-name source universe", () => {
    const result = new BrandResolutionEngine().resolve(
      row({ brandName: "Aqua Medic" }),
    );
    assert.equal(SOURCE_BRAND_NAMES.length, 49);
    assert.equal(BRAND_DICTIONARY.length, 48);
    assert.equal(result.selectedBrandName, "AquaMedic");
    assert.equal(result.status, "RESOLVED");
  });

  it("rejects generic category tokens and substring false positives", () => {
    const result = new BrandResolutionEngine().resolve(
      row({ name: "Titanium csavar", primaryCategoryPath: "Termékek|Pumpa" }),
    );
    assert.equal(containsTokenPhrase("Titanium csavar", "ATI"), false);
    assert.equal(result.status, "UNRESOLVED");
  });

  /**
   * AZ ELVALASZTO-VARIANS. A katalogus es a szotar ugyanazt a markat mas
   * irasmoddal irja, es a normalizalas a kotojelet SZOKOZRE csereli, nem
   * torli -- ezert a "Mag-Float" alakbol "mag float" lesz, a szotari
   * "Magfloat" alakbol "magfloat", es a ketto sosem talalkozik.
   *
   * Merve a 09-03-as UNAS exporton, 1893 termeknev ellen: ot marka, 98
   * termek all igy (Mag-Float 11, AquaMedic 34, RedSea 24, Aqualight 18,
   * Polyplab 11).
   *
   * A KET IRANY KULON ALLITAS, mert kulon is el tud romlani: az egyik a
   * kotojeles nevet meri a szotar egybeirt alakjahoz, a masik a forditottjat.
   */
  it("a kotojeles termeknev egyezik a szotar egybeirt aliasaval", () => {
    assert.equal(
      containsTokenPhrase("Mag-Float Mini mágneses algakaparó", "Magfloat"),
      true,
    );
  });

  it("az egybeirt termeknev egyezik a szotar szokozos aliasaval", () => {
    assert.equal(
      containsTokenPhrase("AquaMedic EcoDrift áramoltatóvezérlő", "Aqua Medic"),
      true,
    );
  });

  /**
   * ES EZ A HATAR, AMIERT AZ OSSZEFUZES NEM TOMORITES.
   *
   * Ha egyszeruen elhagynank a szokozoket mindket oldalon es reszszot
   * keresnenk, a tokenhatar elveszne. Ugyanazon a merésen az a valtozat 175
   * talalatot ad 98 helyett, es a tobblet nagy resze pontosan ilyen: az "ATI"
   * rasimul az "aqua illumin-ATI-on" belsejere, a "D-D" a "Jeco-DD-mp" alakra.
   *
   * A ket assert ugyanannak az egy szabalynak ket pelda-esete, tehat egy
   * rontas mindkettot elviszi. Nem kulon allitas: kulon rontasuk nincs.
   */
  it("az osszefuzes teljes tokenekbol epul, tehat a reszszo tovabbra sem talal", () => {
    assert.equal(
      containsTokenPhrase("Aqua Illumination Prime HD LED panel", "ATI"),
      false,
    );
    assert.equal(
      containsTokenPhrase("Jecod DMP-30 áramoltató 15.000l/h", "D-D"),
      false,
    );
  });

  /**
   * A NEV-PREFIX PONTSZAM KULON UT, ES KULON IS ROMLIK EL: a
   * `startsWithTokenPhrase` sajat hivassal dolgozik, tehat a
   * `containsTokenPhrase` javitasa onmagaban nem hozza magaval.
   *
   * A masodik assert a horgony: a prefix csak a nev ELEJEN all, kulonben egy
   * "prefix" pontszam jarna olyan nevnek, ami nem a markaval kezdodik.
   */
  it("a nev-prefix ut is latja az elvalaszto-varianst, es csak az elejen", () => {
    assert.equal(
      startsWithTokenPhrase("Mag-Float Mini mágneses algakaparó", "Magfloat"),
      true,
    );
    assert.equal(
      startsWithTokenPhrase("algakaparó Mag-Float Mini", "Magfloat"),
      false,
    );
  });

  /**
   * ES A MOTOR SZINTJEN: a mert 98 termekbol 21 olyan, aminek MA egyetlen
   * jeloltje sincs (aqua-light 17, magfloat 4). Ezek a javitas utan
   * REVIEW_REQUIRED allapotba kerulnek, vagyis van mit felulvizsgalni --
   * addig az UNRESOLVED azt jelentette, hogy nincs mit.
   */
  it("a kotojeles termeknev a nev-agon jeloltte teszi a markat", () => {
    const result = new BrandResolutionEngine().resolve(
      row({ name: "Mag-Float Mini mágneses algakaparó" }),
    );
    assert.equal(result.candidates[0]?.brandKey, "magfloat");
    assert.equal(result.confidence, 68);
    assert.equal(result.status, "REVIEW_REQUIRED");
  });
});

describe("brand resolver strategies", () => {
  const engine = new BrandResolutionEngine();

  it("treats a known explicit UNAS brand as the strongest evidence", () => {
    const result = engine.resolve(row({ brandName: "Tunze" }));
    assert.equal(result.status, "RESOLVED");
    assert.equal(result.confidence, 100);
    assert.equal(result.candidates[0]?.evidence[0]?.source, "EXPLICIT_BRAND");
    assert.equal(result.candidates[0]?.evidence[0]?.rawValue, "Tunze");
  });

  it("requires review for an unknown explicit value", () => {
    const result = engine.resolve(row({ brandName: "Unknown Industries" }));
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.ok(result.reviewReasons.includes("UNKNOWN_EXPLICIT_BRAND"));
    assert.equal(result.evidence[0]?.rawValue, "Unknown Industries");
    assert.equal(result.evidence[0]?.score, 0);
  });

  it("uses primary and alternative category paths", () => {
    const primary = engine.resolve(
      row({ primaryCategoryPath: "Termékek|Tunze" }),
    );
    const alternative = engine.resolve(
      row({ alternativeCategoryPaths: ["Termékek|Eheim"] }),
    );
    assert.equal(
      primary.candidates[0]?.evidence[0]?.source,
      "PRIMARY_CATEGORY",
    );
    assert.equal(
      alternative.candidates[0]?.evidence[0]?.source,
      "ALTERNATIVE_CATEGORY",
    );
  });

  it("uses token-boundary and name-prefix evidence", () => {
    const prefix = engine.resolve(row({ name: "Tunze Stream 3 pumpa" }));
    const token = engine.resolve(row({ name: "Pumpa Tunze Stream 3 modell" }));
    assert.equal(prefix.confidence, 68);
    assert.equal(token.confidence, 50);
    assert.equal(prefix.status, "REVIEW_REQUIRED");
  });

  it("uses configured manufacturer and SKU prefixes", () => {
    const manufacturer = engine.resolve(
      row({ manufacturerPartNumber: "TUNZE-6150.000" }),
    );
    const sku = engine.resolve(row({ sku: "EHEIM-1234" }));
    assert.equal(manufacturer.status, "RESOLVED");
    assert.equal(manufacturer.confidence, 82);
    assert.equal(sku.status, "RESOLVED");
    assert.equal(sku.confidence, 78);
  });

  it("aggregates evidence when multiple sources support one brand", () => {
    const result = engine.resolve(
      row({
        name: "Tunze Stream pumpa",
        primaryCategoryPath: "Termékek|Tunze",
      }),
    );
    assert.equal(result.status, "RESOLVED");
    assert.equal(result.confidence, 100);
    assert.deepEqual(result.candidates[0]?.sources, [
      "PRIMARY_CATEGORY",
      "PRODUCT_NAME",
    ]);
  });

  it("routes conflicting sources and multiple name brands to review", () => {
    const sourceConflict = engine.resolve(
      row({ brandName: "Tunze", name: "Eheim szűrő" }),
    );
    const compatible = engine.resolve(
      row({ name: "Tunze adapter Eheim szűrőhöz" }),
    );
    assert.equal(sourceConflict.status, "REVIEW_REQUIRED");
    assert.ok(sourceConflict.reviewReasons.includes("SOURCE_CONFLICT"));
    assert.ok(compatible.reviewReasons.includes("MULTIPLE_BRANDS_IN_NAME"));
  });
});

/**
 * AZ ELGEPELT ALAKOK, TERMEKNEVENKENT NEVESITVE.
 *
 * MIERT OT KULON ALLITAS, ES NEM EGY CIKLUS OT ERTEKKEL: egy ciklus EGY allitas.
 * Ha egyetlen alias hianyzik, az is elbukik -- de nem mondja meg, MELYIK. Ot kulon
 * allitasnal a kalibracio kimenete nev szerint megnevezi a hianyzot.
 *
 * A nevek a 09-03-as UNAS export VALODI terméknevei, nem kitalalt peldak.
 */
describe("brand typo aliases measured on the 09-03 export", () => {
  const engine = new BrandResolutionEngine();

  it("a Korallen-zuht irasmod a Korallen-Zucht markara oldodik", () => {
    const result = engine.resolve(
      row({ name: "Korallen-zuht Coral Snow 500 ml" }),
    );
    assert.equal(result.candidates[0]?.brandKey, "korallen-zucht");
  });

  it("az Aqua Mdic irasmod az AquaMedic markara oldodik", () => {
    const result = engine.resolve(
      row({ name: "Aqua Mdic DC Runner 1.1 lahabzó motor" }),
    );
    assert.equal(result.candidates[0]?.brandKey, "aquamedic");
  });

  it("a Fauna Marine irasmod a Fauna Marin markara oldodik", () => {
    const result = engine.resolve(
      row({ name: "Fauna Marine DIY Reactor artemia keltető" }),
    );
    assert.equal(result.candidates[0]?.brandKey, "fauna-marin");
  });

  it("a Groteh irasmod a Grotech markara oldodik", () => {
    const result = engine.resolve(
      row({ name: "Groteh szűrőanyag tartó zsák 4 colos" }),
    );
    assert.equal(result.candidates[0]?.brandKey, "grotech");
  });

  it("a Coral Essential irasmod a Coral Essentials markara oldodik", () => {
    const result = engine.resolve(
      row({
        name: "Coral Essential - Coral Power FW Dip - korallfürdető szer",
      }),
    );
    assert.equal(result.candidates[0]?.brandKey, "coral-essentials");
  });

  /**
   * A KONTROLL BEKOTESE A TESZTSORBA.
   *
   * A kuszob-kalibracio szerint ket betu tavolsagon az `Ecotech` es a `Grotech`
   * egymas elgepelesenek latszik, holott ket valodi marka. A katalogus ezt elo is
   * allitotta: ket betus savval a Grotech nevek 62 termeken futottak volna az
   * Ecotech ala, az Ecotech nevek 26-on a Grotech ala.
   *
   * Ez az allitas azert all itt, hogy ha valaki kesobb tagitani akarja a kuszobot,
   * NE csendben tegye: ez a sor szol.
   */
  it("az ecotech nev NEM oldodik fel Grotech-re -- a ket betus sav kontrollja", () => {
    const result = engine.resolve(
      row({ name: "Ecotech Marine Vectra VL2 felnyomó szivattyú" }),
    );
    assert.equal(result.candidates[0]?.brandKey, "ecotech");
    assert.equal(
      result.candidates.some((candidate) => candidate.brandKey === "grotech"),
      false,
    );
  });
});

describe("brand scoring and report", () => {
  const engine = new BrandResolutionEngine();

  it("uses stable tie-breaks and records all versions", () => {
    const first = engine.resolve(row({ name: "Adapter ATI Tunze lámpához" }));
    const second = engine.resolve(row({ name: "Adapter ATI Tunze lámpához" }));
    assert.deepEqual(second, first);
    assert.equal(first.candidates[0]?.brandKey, "ati");
    assert.equal(first.reviewReasons.includes("CLOSE_CANDIDATES"), true);
    assert.equal(first.configVersion, BRAND_RESOLUTION_VERSIONS.config);
  });

  it("keeps decision score and margin thresholds centralized", () => {
    assert.deepEqual(BRAND_RESOLUTION_THRESHOLDS, {
      resolved: 75,
      review: 40,
      minimumMargin: 20,
      highConfidence: 75,
      mediumConfidence: 50,
      lowConfidence: 1,
    });
  });

  it("produces consistent summary totals for missing explicit brands", () => {
    const rows = [
      row({ sourceRowNumber: 2, sku: "TUNZE-1" }),
      row({ sourceRowNumber: 3, sku: "GEN-2", name: "Eheim szűrő" }),
      row({ sourceRowNumber: 4, sku: "GEN-3" }),
      row({ sourceRowNumber: 5, sku: "GEN-4", brandName: "Tunze" }),
    ];
    const summary = summarizeBrandResolution(rows, engine.resolveAll(rows));
    assert.equal(summary.productsMissingExplicitBrand, 3);
    assert.equal(
      summary.resolved + summary.reviewRequired + summary.unresolved,
      3,
    );
    assert.equal(summary.resolved, 1);
    assert.equal(summary.reviewRequired, 1);
    assert.equal(summary.unresolved, 1);
  });
});
