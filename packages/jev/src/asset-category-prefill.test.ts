import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PREFILL_VISIBLE_CATEGORY_CODES,
  isHiddenControl,
  prefillEnabled,
  prefillExposure,
  prefillResolution,
} from "./asset-category-prefill.js";

/*
  A KONTROLL VART ERTEKEIT PYTHON `hashlib` SZAMOLTA (2026-09-28), nem ez a kod:
  sha256("<id>:2")[:8] % 10. A "teszt-27" kontroll, a "teszt-0" nem, es a
  "teszt-27" a 3-as policy-verzioval mar nem kontroll. 10 000 azonosito
  kozul 1026 kontroll (10,3%).
*/
const KONTROLL = "asset-create:web:teszt-27";
const NEM_KONTROLL = "asset-create:web:teszt-0";

describe("a 10%-os rejtett kontroll", () => {
  it("a független számítás szerinti azonosítók", () => {
    assert.equal(isHiddenControl(KONTROLL, 2), true);
    assert.equal(isHiddenControl(NEM_KONTROLL, 2), false);
    assert.equal(isHiddenControl(KONTROLL, 3), false);
  });

  it("stabil: ugyanaz az azonosító ugyanazt adja", () => {
    for (let i = 0; i < 5; i++)
      assert.equal(isHiddenControl(KONTROLL, 2), true);
  });

  it("nagyjából 10%: 10 000 azonosítóból 1026 (mint a Python-számításban)", () => {
    let db = 0;
    for (let i = 0; i < 10_000; i++) if (isHiddenControl(`op-${i}`, 2)) db++;
    assert.equal(db, 1026);
  });
});

describe("a javaslat láthatósága", () => {
  const alap = {
    selectedValue: "cat_lig",
    categoryCode: "LIG",
    confidence: 0.95,
    clientOperationId: NEM_KONTROLL,
    policyVersion: 2,
  };

  it("a 11 validált kategória közül, ≥ 0,90-nel, kontrollon kívül: SHOWN", () => {
    assert.equal(prefillExposure(alap), "SHOWN");
  });

  it("pontosan 0,90 még látható, 0,899 már nem", () => {
    assert.equal(prefillExposure({ ...alap, confidence: 0.9 }), "SHOWN");
    assert.equal(prefillExposure({ ...alap, confidence: 0.899 }), "HIDDEN");
  });

  it("a ritka (nem validált) kategória mindig HIDDEN", () => {
    assert.equal(prefillExposure({ ...alap, categoryCode: "AVS" }), "HIDDEN");
    assert.equal(prefillExposure({ ...alap, categoryCode: null }), "HIDDEN");
  });

  it("NONE, hiányzó választás vagy bizonyosság: HIDDEN", () => {
    assert.equal(prefillExposure({ ...alap, selectedValue: "NONE" }), "HIDDEN");
    assert.equal(prefillExposure({ ...alap, selectedValue: null }), "HIDDEN");
    assert.equal(prefillExposure({ ...alap, confidence: null }), "HIDDEN");
  });

  it("a kontrollba eső űrlap a jogosult javaslatot sem látja", () => {
    assert.equal(
      prefillExposure({ ...alap, clientOperationId: KONTROLL }),
      "HIDDEN",
    );
  });

  it("pontosan a PD-004 szerinti 11 kód", () => {
    assert.deepEqual([...PREFILL_VISIBLE_CATEGORY_CODES].sort(), [
      "CAN",
      "COM",
      "FIB",
      "HEX",
      "HSZ",
      "LIG",
      "MET",
      "PUM",
      "UVF",
      "VAL",
      "VPU",
    ]);
  });
});

describe("a feloldás mentéskor", () => {
  const alap = {
    selectedValue: "cat_lig",
    runProjectionHash: "h1",
    savedProjectionHash: "h1",
  };
  const eset = (
    exposure: "SHOWN" | "HIDDEN",
    savedCategoryId: string | null,
    tobbi: Partial<typeof alap> = {},
  ) => prefillResolution({ ...alap, ...tobbi, exposure, savedCategoryId });

  it("SHOWN: változatlan -> ACCEPTED, más -> OVERRIDDEN, üres -> OVERRIDDEN", () => {
    assert.equal(eset("SHOWN", "cat_lig"), "ACCEPTED");
    assert.equal(eset("SHOWN", "cat_com"), "OVERRIDDEN");
    assert.equal(eset("SHOWN", null), "OVERRIDDEN");
  });

  it("HIDDEN: egyező -> SHADOW_MATCH, más -> SHADOW_MISMATCH", () => {
    assert.equal(eset("HIDDEN", "cat_lig"), "SHADOW_MATCH");
    assert.equal(eset("HIDDEN", "cat_com"), "SHADOW_MISMATCH");
  });

  it("a NONE soha nem egyezik, a kategória nélküli mentéssel sem", () => {
    assert.equal(
      eset("HIDDEN", null, { selectedValue: "NONE" }),
      "SHADOW_MISMATCH",
    );
    assert.equal(
      eset("HIDDEN", "NONE", { selectedValue: "NONE" }),
      "SHADOW_MISMATCH",
    );
  });

  it("ha a vetület a javaslat után változott: STALE, a láthatóságtól függetlenül", () => {
    assert.equal(
      eset("SHOWN", "cat_lig", { savedProjectionHash: "h2" }),
      "STALE",
    );
    assert.equal(
      eset("HIDDEN", "cat_lig", { savedProjectionHash: "h2" }),
      "STALE",
    );
  });
});

describe("a kill switch", () => {
  it("csak a kimondott live nyit", () => {
    assert.equal(prefillEnabled("live"), true);
    assert.equal(prefillEnabled(" live "), true);
    for (const ertek of [undefined, "", "on", "true", "LIVE", "1", "off"])
      assert.equal(prefillEnabled(ertek), false, String(ertek));
  });
});
