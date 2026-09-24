import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSET_CRITICALITY_LABELS,
  ASSET_CRITICALITY_OPTIONS,
  ASSET_CRITICALITY_ORDER,
} from "./asset-criticality";
import { recordLiteralFromSource } from "../testing/record-literal-from-source";

describe("a kritikusság-nevek modulja", () => {
  it("a sorrend minden kritikusságot pontosan egyszer sorol fel", () => {
    assert.deepEqual(
      [...ASSET_CRITICALITY_ORDER].sort(),
      Object.keys(ASSET_CRITICALITY_LABELS).sort(),
      "a választó sorrendje és a címke-tábla eltért egymástól",
    );
    assert.equal(
      new Set(ASSET_CRITICALITY_ORDER).size,
      ASSET_CRITICALITY_ORDER.length,
    );
  });

  it("a választó a címke-táblából veszi a szöveget, a sorrend szerint", () => {
    assert.deepEqual(
      ASSET_CRITICALITY_OPTIONS,
      ASSET_CRITICALITY_ORDER.map((value) => ({
        value,
        label: ASSET_CRITICALITY_LABELS[value],
      })),
    );
    assert.equal(ASSET_CRITICALITY_OPTIONS[0]?.label, "Alacsony");
    assert.equal(ASSET_CRITICALITY_OPTIONS.at(-1)?.label, "Kritikus");
  });
});

/**
 * A MOBIL EZT A TÁBLÁT NEM IMPORTÁLHATJA A `packages/types`-BÓL, tehát a
 * betűre-egyezést forrásszöveg-olvasással kell ellenőrizni. Lásd
 * `asset-status.spec.ts` ugyanezt a mintát.
 */
describe("a kritikusság-nevek egyeznek a packages/types forrásával", () => {
  it("a mobil tábla betűre ugyanaz, mint az assetCriticalityLabel", () => {
    const kozos = recordLiteralFromSource(
      "../../packages/types/src/asset-management.ts",
      "assetCriticalityLabel",
    );
    assert.deepEqual(ASSET_CRITICALITY_LABELS, kozos);
  });
});
