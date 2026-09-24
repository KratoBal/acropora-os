import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSET_KIND_LABELS,
  ASSET_KIND_OPTIONS,
  ASSET_KIND_ORDER,
} from "./asset-kind";
import { recordLiteralFromSource } from "../testing/record-literal-from-source";

describe("a fajta-nevek modulja", () => {
  it("a sorrend minden fajtát pontosan egyszer sorol fel", () => {
    assert.deepEqual(
      [...ASSET_KIND_ORDER].sort(),
      Object.keys(ASSET_KIND_LABELS).sort(),
      "a választó sorrendje és a címke-tábla eltért egymástól",
    );
    assert.equal(new Set(ASSET_KIND_ORDER).size, ASSET_KIND_ORDER.length);
  });

  it("a választó a címke-táblából veszi a szöveget, a sorrend szerint", () => {
    assert.deepEqual(
      ASSET_KIND_OPTIONS,
      ASSET_KIND_ORDER.map((value) => ({
        value,
        label: ASSET_KIND_LABELS[value],
      })),
    );
    assert.equal(ASSET_KIND_OPTIONS[0]?.label, "Rendszer");
    assert.equal(ASSET_KIND_OPTIONS.at(-1)?.label, "Egyéb");
  });
});

/**
 * A MOBIL EZT A TÁBLÁT NEM IMPORTÁLHATJA A `packages/types`-BÓL, tehát a
 * betűre-egyezést forrásszöveg-olvasással kell ellenőrizni. Lásd
 * `asset-status.spec.ts` ugyanezt a mintát.
 */
describe("a fajta-nevek egyeznek a packages/types forrásával", () => {
  it("a mobil tábla betűre ugyanaz, mint az assetKindLabel", () => {
    const kozos = recordLiteralFromSource(
      "../../packages/types/src/asset-management.ts",
      "assetKindLabel",
    );
    assert.deepEqual(ASSET_KIND_LABELS, kozos);
  });
});
