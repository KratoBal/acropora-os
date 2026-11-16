import { describe, it } from "node:test";

import { assertStrictIsoDates } from "../../testing/strict-iso-date.js";
import {
  AssetListQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
  AssignAssetAquariumDto,
} from "./asset.dto.js";

// An impossible day is a 400, not a silent next month (t-20261115-dto-datum-strict): an asset and its list filter.
describe("strict ISO dates: an asset and its list filter", () => {
  it("AssetListQueryDto: dueBefore", async () => {
    await assertStrictIsoDates(AssetListQueryDto, ["dueBefore"]);
  });
  it("CreateAssetDto: installedAt, purchasedAt, warrantyExpiresAt, lastServicedAt, nextServiceAt", async () => {
    await assertStrictIsoDates(CreateAssetDto, [
      "installedAt",
      "purchasedAt",
      "warrantyExpiresAt",
      "lastServicedAt",
      "nextServiceAt",
    ]);
  });
  it("UpdateAssetDto: installedAt, purchasedAt, warrantyExpiresAt, lastServicedAt, nextServiceAt, expectedUpdatedAt", async () => {
    await assertStrictIsoDates(UpdateAssetDto, [
      "installedAt",
      "purchasedAt",
      "warrantyExpiresAt",
      "lastServicedAt",
      "nextServiceAt",
      "expectedUpdatedAt",
    ]);
  });
  it("AssignAssetAquariumDto: expectedUpdatedAt", async () => {
    await assertStrictIsoDates(AssignAssetAquariumDto, ["expectedUpdatedAt"]);
  });
});
