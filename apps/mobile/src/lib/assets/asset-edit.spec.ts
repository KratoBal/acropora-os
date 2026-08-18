import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assetEditFormFrom,
  buildAssetPatch,
  hasAssetChanges,
  type EditableAsset,
} from "./asset-edit";

const asset: EditableAsset = {
  updatedAt: "2026-08-18T20:00:00.000Z",
  status: "ACTIVE",
  criticality: "NORMAL",
  manufacturer: "Eheim",
  model: "2078",
  serialNumber: "SN-1",
  inventoryNumber: undefined,
  description: undefined,
  notes: "Halk.",
};

describe("assetEditFormFrom", () => {
  it("turns absent values into empty fields, not into the word undefined", () => {
    const form = assetEditFormFrom(asset);
    assert.equal(form.inventoryNumber, "");
    assert.equal(form.description, "");
    assert.equal(form.manufacturer, "Eheim");
    assert.equal(form.status, "ACTIVE");
  });
});

describe("buildAssetPatch", () => {
  it("sends nothing but the guard when nothing changed", () => {
    const patch = buildAssetPatch(asset, assetEditFormFrom(asset));
    assert.deepEqual(patch, { expectedUpdatedAt: asset.updatedAt });
  });

  it("always carries the timestamp the server checks against", () => {
    // Without it the server cannot tell a fresh edit from one that was
    // written on top of somebody else's work.
    const form = { ...assetEditFormFrom(asset), model: "2080" };
    assert.equal(
      buildAssetPatch(asset, form).expectedUpdatedAt,
      "2026-08-18T20:00:00.000Z",
    );
  });

  it("sends only the field that changed", () => {
    const form = { ...assetEditFormFrom(asset), model: "2080" };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      model: "2080",
    });
  });

  it("clears an emptied field with null rather than an empty string", () => {
    const form = { ...assetEditFormFrom(asset), notes: "" };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      notes: null,
    });
  });

  it("does not treat added whitespace as a change", () => {
    const form = { ...assetEditFormFrom(asset), manufacturer: "  Eheim  " };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
    });
  });

  it("trims what it does send", () => {
    const form = { ...assetEditFormFrom(asset), serialNumber: "  SN-2  " };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      serialNumber: "SN-2",
    });
  });

  it("leaves an already-empty field alone instead of clearing it again", () => {
    // `description` was absent to begin with. Sending `null` for it would
    // be a write nobody asked for, and a write is what loses a conflict.
    const form = { ...assetEditFormFrom(asset), description: "   " };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
    });
  });

  it("carries a changed status and criticality", () => {
    const form = {
      ...assetEditFormFrom(asset),
      status: "IN_REPAIR" as const,
      criticality: "HIGH" as const,
    };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      status: "IN_REPAIR",
      criticality: "HIGH",
    });
  });

  it("sends several changes at once", () => {
    const form = {
      ...assetEditFormFrom(asset),
      model: "2080",
      notes: "Cserélt tömítés.",
      status: "OUT_OF_SERVICE" as const,
    };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      model: "2080",
      notes: "Cserélt tömítés.",
      status: "OUT_OF_SERVICE",
    });
  });
});

describe("hasAssetChanges", () => {
  it("is false for an untouched form", () => {
    assert.equal(hasAssetChanges(asset, assetEditFormFrom(asset)), false);
  });

  it("is false when the only edit was whitespace", () => {
    const form = { ...assetEditFormFrom(asset), model: " 2078 " };
    assert.equal(hasAssetChanges(asset, form), false);
  });

  it("is true as soon as one field differs", () => {
    const form = { ...assetEditFormFrom(asset), notes: "" };
    assert.equal(hasAssetChanges(asset, form), true);
  });
});
