import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";
import type { AssetDetail } from "@acropora/types";

import type { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

const asset = {
  id: "asset-1",
  assetNumber: "ESZK-1",
  qrToken: "550e8400-e29b-41d4-a716-446655440000",
  name: "Fóka felnyomó szivattyú",
  kind: "COMPONENT",
  status: "ACTIVE",
  criticality: "HIGH",
  owner: {
    type: "CUSTOMER",
    id: "customer-1",
    code: "VEVO-1",
    displayName: "Fóka",
  },
  childCount: 0,
  updatedAt: "2026-08-15T10:00:00.000Z",
  ancestors: [],
  children: [],
  events: [],
  documents: [],
  createdAt: "2026-08-15T10:00:00.000Z",
} satisfies AssetDetail;

function repository(
  overrides: Partial<Record<keyof ServiceAssetsRepository, unknown>> = {},
) {
  return {
    detail: async () => asset,
    detailByQrToken: async () => asset,
    validationContext: async () => ({
      customer: { id: "customer-1", isActive: true },
      supplier: null,
      address: null,
      aquarium: null,
      parent: null,
      productVariant: null,
    }),
    basic: async () => ({
      id: "asset-1",
      customerId: "customer-1",
      supplierId: null,
      customerAddressId: null,
      aquariumId: null,
      parentAssetId: null,
      productVariantId: null,
      status: "ACTIVE",
      updatedAt: new Date(asset.updatedAt),
      _count: { childAssets: 0 },
    }),
    wouldCreateCycle: async () => false,
    ...overrides,
  } as unknown as ServiceAssetsRepository;
}

test("rejects a parent asset owned by a different customer", async () => {
  const service = new ServiceAssetsService(
    repository({
      validationContext: async () => ({
        customer: { id: "customer-1", isActive: true },
        supplier: null,
        address: null,
        aquarium: null,
        parent: {
          id: "parent-1",
          customerId: "customer-2",
          supplierId: null,
          customerAddressId: null,
          aquariumId: null,
          status: "ACTIVE",
        },
        productVariant: null,
      }),
    }),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          ownerType: "CUSTOMER",
          ownerId: "customer-1",
          parentAssetId: "parent-1",
          kind: "COMPONENT",
          name: "Szivattyú",
        },
        "user-1",
      ),
    BadRequestException,
  );
});

test("rejects a cyclic parent update before writing", async () => {
  let updateCalled = false;
  const service = new ServiceAssetsService(
    repository({
      wouldCreateCycle: async () => true,
      update: async () => {
        updateCalled = true;
        return asset;
      },
    }),
  );
  await assert.rejects(
    () =>
      service.update(
        "asset-1",
        {
          parentAssetId: "child-1",
          expectedUpdatedAt: asset.updatedAt,
        },
        "user-1",
      ),
    BadRequestException,
  );
  assert.equal(updateCalled, false);
});

test("generates an app deep link QR without exposing database ids", async () => {
  const previous = process.env.ASSET_QR_BASE_URL;
  process.env.ASSET_QR_BASE_URL = "acropora-os://assets/scan";
  try {
    const result = await new ServiceAssetsService(repository()).qrCode(
      "asset-1",
    );
    assert.equal(
      result.value,
      "acropora-os://assets/scan/550e8400-e29b-41d4-a716-446655440000",
    );
    assert.doesNotMatch(result.value, /asset-1/);
    assert.match(result.svg, /^<svg /);
    assert.equal(result.labelSizeMm, 30);
  } finally {
    if (previous === undefined) delete process.env.ASSET_QR_BASE_URL;
    else process.env.ASSET_QR_BASE_URL = previous;
  }
});
