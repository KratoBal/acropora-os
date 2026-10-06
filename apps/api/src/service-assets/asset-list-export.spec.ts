import assert from "node:assert/strict";
import { describe, it } from "node:test";

import ExcelJS from "exceljs";
import { UnprocessableEntityException } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants.js";
import {
  ASSET_EXPORT_HEADERS,
  ASSET_EXPORT_MAX,
  assetExportCells,
  type AssetListItem,
  type AuthenticatedUser,
} from "@acropora/types";

import { buildAssetListXlsx } from "./asset-list-xlsx.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsService } from "./service-assets.service.js";
import type { AssetListQueryDto } from "./dto/asset.dto.js";

/*
  AZ ESZKÖZLISTA NYOMTATÁSA ÉS EXCELJE (kártya 323e9b38). MI PIROSÍT:
  - az export nem a KÉRDEZŐ hatókörével kér (egy partner többet kapna, mint
    a listán), vagy elhagyja a hozzárendelt egységeit;
  - a határ fölött csendben levágja a halmazt ahelyett, hogy szűkítést kérne;
  - az Excel oszlopai vagy sorai nem a közös sor (`assetExportCells`);
  - az „export” útvonal a `:id` UTÁN áll, és egy eszköz azonosítójaként fut be.
*/
const internal = {
  id: "user-1",
  email: "szerviz@example.invalid",
  displayName: "Szervizes",
  role: "SERVICE",
  customerId: null,
  supplierId: null,
} as AuthenticatedUser;
const partner = {
  ...internal,
  id: "partner-user",
  role: "PARTNER_SERVICE",
  customerId: "customer-1",
} as AuthenticatedUser;

const item = (over: Partial<AssetListItem> = {}): AssetListItem =>
  ({
    id: "asset-1",
    assetNumber: "ESZ-0001",
    name: "LED lámpa",
    kind: "EQUIPMENT",
    status: "ACTIVE",
    criticality: "NORMAL",
    owner: {
      type: "CUSTOMER",
      id: "customer-1",
      code: "V1",
      displayName: "Fővárosi Állatkert",
    },
    address: { id: "a1", formatted: "1146 Budapest, Állatkerti krt. 6-12." },
    unit: {
      id: "u1",
      code: "BIO",
      name: "Biodóm",
      path: ["Állatkert", "Biodóm"],
    },
    category: "Világítás",
    manufacturer: "Astral Pool",
    model: "LumiPlus",
    serialNumber: "SN-42",
    labelCode: "ACR-000123",
    childCount: 0,
    ...over,
  }) as AssetListItem;

const service = (
  listAll: (...args: unknown[]) => Promise<AssetListItem[] | null>,
) => {
  const calls: unknown[][] = [];
  const repository = {
    assignedUnitIds: async () => ["unit-a", "unit-b"],
    listAll: async (...args: unknown[]) => {
      calls.push(args);
      return listAll(...args);
    },
  };
  return {
    calls,
    service: new ServiceAssetsService(repository as never, {} as never),
  };
};

const query = {
  status: "IN_PLACE",
  search: "lámpa",
} as unknown as AssetListQueryDto;

describe("asset list export", () => {
  it("asks with the CALLER's scope and assigned units, like the list, up to the limit", async () => {
    const asPartner = service(async () => [item()]);
    await asPartner.service.exportItems(query, partner);
    assert.deepEqual(asPartner.calls[0], [
      query,
      { kind: "customer", customerId: "customer-1" },
      ["unit-a", "unit-b"],
      ASSET_EXPORT_MAX,
    ]);

    const asInternal = service(async () => [item()]);
    await asInternal.service.exportItems(query, internal);
    assert.deepEqual(asInternal.calls[0]!.slice(1), [
      { kind: "internal" },
      [],
      ASSET_EXPORT_MAX,
    ]);
  });

  it("over the limit it refuses in Hungarian instead of cutting the list", async () => {
    const tooMany = service(async () => null);
    await assert.rejects(
      tooMany.service.exportItems(query, internal),
      (error: unknown) =>
        error instanceof UnprocessableEntityException &&
        /Szűkítsd a listát/.test(error.message),
    );
  });

  it("the Excel has the shared header and each asset's shared row", async () => {
    const assets = [
      item(),
      item({
        id: "asset-2",
        name: "Szivattyú",
        labelCode: undefined,
        unit: undefined,
      }),
    ];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await buildAssetListXlsx(assets)) as never);
    const sheet = workbook.worksheets[0]!;
    const row = (n: number) =>
      (sheet.getRow(n).values as unknown[])
        .slice(1)
        .map((value) => (value ?? "") as string);
    assert.deepEqual(row(1), [...ASSET_EXPORT_HEADERS]);
    assert.deepEqual(row(2), assetExportCells(assets[0]!));
    assert.deepEqual(row(3), assetExportCells(assets[1]!));
    assert.equal(sheet.rowCount, 3);
  });

  it("the export routes are registered before ':id', so 'export' is never taken for an asset id", () => {
    const paths = Object.getOwnPropertyNames(ServiceAssetsController.prototype)
      .map((name) => {
        const handler = (
          ServiceAssetsController.prototype as unknown as Record<
            string,
            unknown
          >
        )[name];
        return typeof handler === "function"
          ? (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined)
          : undefined;
      })
      .filter((path): path is string => typeof path === "string");
    const at = (path: string) => paths.indexOf(path);
    assert.ok(at("export") > -1 && at("export.xlsx") > -1, paths.join(", "));
    assert.ok(at(":id") > -1, paths.join(", "));
    assert.ok(at("export") < at(":id"));
    assert.ok(at("export.xlsx") < at(":id"));
  });
});
