import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSET_PHASE_CONNECTION_LABELS,
  ASSET_PHASE_CONNECTION_OPTIONS,
  ASSET_PHASE_CONNECTION_ORDER,
} from "./asset-phase-connection";
import { recordLiteralFromSource } from "../testing/record-literal-from-source";

describe("a bekötés-nevek modulja", () => {
  it("a sorrend minden bekötést pontosan egyszer sorol fel", () => {
    assert.deepEqual(
      [...ASSET_PHASE_CONNECTION_ORDER].sort(),
      Object.keys(ASSET_PHASE_CONNECTION_LABELS).sort(),
    );
    assert.equal(
      new Set(ASSET_PHASE_CONNECTION_ORDER).size,
      ASSET_PHASE_CONNECTION_ORDER.length,
    );
  });

  it("a választó a két kért feliratot adja, ebben a sorrendben", () => {
    assert.deepEqual(
      ASSET_PHASE_CONNECTION_OPTIONS.map((option) => option.label),
      ["I. fázis", "III. fázis"],
    );
  });
});

/** A mobil nem importálhatja a közös csomagot: forrásszövegből egyeztetünk. */
describe("a bekötés-nevek egyeznek a packages/types forrásával", () => {
  it("a mobil tábla betűre ugyanaz, mint az assetPhaseConnectionLabel", () => {
    const kozos = recordLiteralFromSource(
      "../../packages/types/src/asset-management.ts",
      "assetPhaseConnectionLabel",
    );
    assert.deepEqual(ASSET_PHASE_CONNECTION_LABELS, kozos);
  });
});
