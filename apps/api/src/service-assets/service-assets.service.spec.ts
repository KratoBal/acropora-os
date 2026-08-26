import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";
import type { AssetDetail } from "@acropora/types";

import type { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";
import {
  SERVICE_OWNER_WHERE,
  assetOwnerScopeWhere,
} from "./service-assets.types.js";

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

/**
 * A TULAJDONOS-VÁLASZTÓ, és amiért ez a három állítás létezik.
 *
 * A lista korábban MINDEN aktív vevőt és MINDEN aktív partnert visszaadott,
 * tehát az új eszköz űrlap első mezőjében a webshopos vevők jelentek meg
 * (Balázs bejelentése, 2026-08-25). A szűrés maga a tárolóban van, ezért a
 * feltétel külön konstans: adatbázis nélkül is állítható, és pont ez az a sor,
 * amit el lehet rontani.
 */
test("asks for service partners only, and says so in one place", () => {
  assert.deepEqual(SERVICE_OWNER_WHERE, { isActive: true, isService: true });
});

test("keeps the owner an existing asset already has", async () => {
  let asked: unknown = "nem hívták meg";
  const service = new ServiceAssetsService(
    repository({
      owners: async (keep: unknown) => {
        asked = keep;
        return { items: [] };
      },
    }),
  );

  await service.owners({ ownerType: "CUSTOMER", ownerId: "customer-9" });

  assert.deepEqual(asked, { type: "CUSTOMER", id: "customer-9" });
});

test("passes nothing to keep when the caller is creating a new asset", async () => {
  let asked: unknown = "nem hívták meg";
  const service = new ServiceAssetsService(
    repository({
      owners: async (keep: unknown) => {
        asked = keep;
        return { items: [] };
      },
    }),
  );

  await service.owners();

  assert.equal(asked, null);
});

/**
 * A FÉL PÁROS nem értelmezhető, és csendben elhagyva pont azt a sort ejtenénk
 * ki, amiért a hívás történt: a szerkesztő üres mezőt látna a tulajdonos
 * helyén, és nem tudná meg, miért.
 */
test("refuses half of an owner reference instead of ignoring it", () => {
  const service = new ServiceAssetsService(repository());

  // A visszautasítás AZONNAL történik, még a tároló hívása előtt: nem
  // elutasított ígéret, hanem dobott hiba.
  assert.throws(
    () => service.owners({ ownerType: "CUSTOMER" }),
    BadRequestException,
  );
  assert.throws(
    () => service.owners({ ownerId: "customer-9" }),
    BadRequestException,
  );
});

/**
 * A TULAJDONOS FAJTÁJA SZERINTI SZŰKÍTÉS, és amiért KÉT állítás tartozik hozzá.
 *
 * A telefonon a szerelő listája a szerviz-partnerek eszközeié; a webes
 * nyilvántartásé viszont MINDEN eszköz, mert ott a teljesség az érték.
 * Ugyanaz a végpont szolgálja ki a kettőt, tehát a szűrés csak akkor lehet
 * helyes, ha KÉRNI kell -- és az a fontosabbik állítás, hogy kérés nélkül nem
 * történik semmi. Egy teszt, ami csak az új viselkedést méri, nem védi meg
 * azt, amit nem akartunk megváltoztatni.
 */
test("narrows to service partners only when the caller asks for it", () => {
  assert.deepEqual(assetOwnerScopeWhere("SERVICE_PARTNER"), {
    supplier: { is: { isActive: true, isService: true } },
  });
});

test("leaves the list untouched when no scope is given", () => {
  // A WEBES ALAPÉRTELMEZÉS. Üres feltétel: se vevő-tulajdonosú, se nem
  // szerviz-jelölt partneré nem esik ki.
  assert.deepEqual(assetOwnerScopeWhere(undefined), {});
});

/**
 * ÉS UGYANAZ A FELTÉTEL, mint a tulajdonos-választón. Ha a kettő elválna, a
 * szerelő olyan eszközt látna, aminek a gazdáját már nem lehetne kiválasztani
 * -- vagy fordítva, és egyik irányban sem szólna semmi.
 */
test("uses the same condition as the owner picker", () => {
  const scoped = assetOwnerScopeWhere("SERVICE_PARTNER");
  assert.deepEqual(scoped.supplier, { is: { ...SERVICE_OWNER_WHERE } });
});
