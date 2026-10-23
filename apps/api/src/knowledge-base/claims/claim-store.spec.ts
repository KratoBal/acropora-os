import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { VocabularyRow } from "@acropora/knowledge-base";

import { ClaimStoreService } from "./claim-store.controller.js";
import {
  ClaimStoreInputError,
  claimEvidenceLevel,
  claimTitle,
  labelsFrom,
  parseLayer,
  quantityLabel,
  type LevelRow,
} from "./claim-store.js";
import { ClaimStoreNotFound } from "./claim-store.repository.js";

/**
 * THE CLAIM STORE (S5, Figma 3:229). The title and the level are derived, so
 * these pin the derivation: a raw enum must never reach the screen, and a
 * contradiction must cap the level.
 */
const row = (
  r: Partial<VocabularyRow> & Pick<VocabularyRow, "kind" | "key" | "forms">,
): VocabularyRow => ({
  status: "APPROVED",
  version: 1,
  ...r,
});

const approved = [
  row({ kind: "EFFECT", key: "CALCIFICATION", forms: ["kalcifikáció"] }),
  row({ kind: "TAXON", key: "ACROPORA", forms: ["Acropora"] }),
  row({ kind: "EFFECT", key: "OLD", forms: ["régi hatás"], status: "RETIRED" }),
];
const working = [
  ...approved,
  row({
    kind: "EFFECT",
    key: "MICROBIOMECOMPOSITION",
    forms: ["mikrobiom-összetétel"],
    status: "DRAFT",
  }),
];
const labels = labelsFrom(approved, working);
const noQuantity = { min: null, max: null, unit: null, basis: null };

describe("claim store: layer filter", () => {
  it("takes the four layers or none", () => {
    assert.equal(parseLayer(undefined), null);
    assert.equal(parseLayer(""), null);
    assert.equal(parseLayer("SCIENTIFIC"), "SCIENTIFIC");
    assert.equal(parseLayer("OWN_CONCLUSION"), "OWN_CONCLUSION");
  });
  it("refuses an unknown layer instead of listing everything", () => {
    assert.throws(() => parseLayer("scientific"), ClaimStoreInputError);
    assert.throws(() => parseLayer(["SCIENTIFIC"]), ClaimStoreInputError);
  });
});

describe("claim store: labels", () => {
  it("labels an approved key", () => {
    assert.equal(labels("EFFECT", "CALCIFICATION"), "Kalcifikáció");
  });
  it("labels a key that is only in the draft, never the raw enum (acrobot 35807)", () => {
    assert.equal(
      labels("EFFECT", "MICROBIOMECOMPOSITION"),
      "Mikrobiom-összetétel",
    );
  });
  it("shows a retired or unknown key as itself", () => {
    assert.equal(labels("EFFECT", "OLD"), "OLD");
    assert.equal(labels("EFFECT", "NOPE"), "NOPE");
  });
});

describe("claim store: quantity and title", () => {
  it("writes a range with its basis, in Hungarian number format", () => {
    assert.equal(
      quantityLabel({ min: "0.1", max: "0.3", unit: "mg/l", basis: "PO4" }),
      "0,1–0,3 mg/l PO₄",
    );
    assert.equal(
      quantityLabel({ min: "2", max: "2", unit: "µmol/l", basis: null }),
      "2 µmol/l",
    );
    assert.equal(
      quantityLabel({ min: "0.5", max: null, unit: "mg/l", basis: "P" }),
      "≥ 0,5 mg/l P",
    );
    assert.equal(
      quantityLabel({ min: null, max: "1", unit: "mg/l", basis: null }),
      "≤ 1 mg/l",
    );
    assert.equal(quantityLabel(noQuantity), null);
  });
  it("builds the title from the effect label, the direction and the quantity", () => {
    assert.equal(
      claimTitle(
        "CALCIFICATION",
        "DECREASE",
        { min: "1", max: "3", unit: "µmol/l", basis: "PO4" },
        labels,
      ),
      "Kalcifikáció: csökken, 1–3 µmol/l PO₄ mellett",
    );
    assert.equal(
      claimTitle("MICROBIOMECOMPOSITION", "NONE", noQuantity, labels),
      "Mikrobiom-összetétel: nem változik",
    );
  });
});

describe("claim store: evidence level", () => {
  const exp = (sourceId: string, over: Partial<LevelRow> = {}): LevelRow => ({
    sourceId,
    stance: "SUPPORTS",
    studyType: "CONTROLLED_LAB",
    controlled: true,
    sampleSize: 6,
    ...over,
  });
  it("two controlled experiments agree", () => {
    assert.equal(
      claimEvidenceLevel([exp("a"), exp("b")], []).level,
      "CONSISTENT_EXPERIMENTS",
    );
  });
  it("a contradicting claim's source caps it at OBSERVATIONAL", () => {
    assert.equal(
      claimEvidenceLevel([exp("a"), exp("b")], ["c"]).level,
      "OBSERVATIONAL",
    );
  });
  it("its own CONTRADICTS row caps it too, and is no support", () => {
    assert.equal(
      claimEvidenceLevel([exp("a"), exp("c", { stance: "CONTRADICTS" })], [])
        .level,
      "OBSERVATIONAL",
    );
  });
  it("a modelling source is a single report; no study type is no level", () => {
    assert.equal(
      claimEvidenceLevel([exp("a", { studyType: "MODELLING" })], []).level,
      "SINGLE_REPORT",
    );
    assert.equal(
      claimEvidenceLevel([exp("a", { studyType: null })], []).level,
      null,
    );
  });
});

describe("claim store: service errors", () => {
  const service = new ClaimStoreService({
    list: async () => ({
      claims: [],
      total: 0,
      layers: {
        SCIENTIFIC: 0,
        HOBBY_EXPERIENCE: 0,
        MANUFACTURER: 0,
        OWN_CONCLUSION: 0,
      },
    }),
    detail: async (id: string) => {
      throw new ClaimStoreNotFound(id);
    },
  });
  it("an unknown layer is a 400 with its code", async () => {
    await assert.rejects(
      service.list("NOPE"),
      (e: unknown) =>
        e instanceof BadRequestException &&
        (e.getResponse() as { code: string }).code === "BAD_LAYER",
    );
  });
  it("the empty store is a list, not an error", async () => {
    const r = await service.list(undefined);
    assert.deepEqual(r.claims, []);
    assert.equal(r.total, 0);
  });
  it("a missing claim is a 404", async () => {
    await assert.rejects(service.detail("x"), NotFoundException);
  });
});
