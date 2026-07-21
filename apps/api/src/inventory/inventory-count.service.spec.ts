import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InventoryCountDetail } from "@acropora/types";

import type { UnasApiClient } from "../imports/unas/unas-api.client.js";
import type { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import type { InventoryCountXlsx } from "./inventory-count-xlsx.js";
import type {
  InventoryCountLinePushResult,
  InventoryCountRepository,
} from "./inventory-count.repository.js";
import { InventoryCountService } from "./inventory-count.service.js";

function baseDetail(
  overrides: Partial<InventoryCountDetail> = {},
): InventoryCountDetail {
  return {
    id: "count-1",
    countNumber: "LELTAR-1",
    status: "UPLOADED",
    warehouseId: "warehouse-1",
    warehouseName: "Fő raktár",
    startedByName: "Teszt Felhasználó",
    createdAt: "2026-07-21T10:00:00.000Z",
    uploadedAt: "2026-07-21T11:00:00.000Z",
    correctedAt: null,
    lines: [
      {
        id: "line-1",
        variantId: "variant-1",
        sku: "REEF-SALT-01",
        productName: "Reef Salt",
        expectedQty: "12",
        countedQty: "10",
        differenceQty: "-2",
        syncStatus: "PENDING",
        syncError: null,
      },
      {
        id: "line-2",
        variantId: "variant-2",
        sku: "PUMP-XL",
        productName: "Reef Pumpa XL",
        expectedQty: "3",
        countedQty: "3",
        differenceQty: "0",
        syncStatus: "PENDING",
        syncError: null,
      },
    ],
    ...overrides,
  };
}

function buildService(options: {
  detail: InventoryCountDetail;
  setStock?: (
    ...args: Parameters<UnasApiClient["setStock"]>
  ) => ReturnType<UnasApiClient["setStock"]>;
  applyCorrection?: InventoryCountRepository["applyCorrection"];
  updateLineCount?: InventoryCountRepository["updateLineCount"];
}) {
  const repository = {
    findById: async () => options.detail,
    applyCorrection:
      options.applyCorrection ??
      (async (
        id: string,
        _actorUserId: string,
        pushResults: Map<string, InventoryCountLinePushResult>,
      ) => ({
        detail: options.detail,
        movementNumber: "KORR-1",
        successCount: [...pushResults.values()].filter(
          (result) => result.status === "OK",
        ).length,
        failedCount: [...pushResults.values()].filter(
          (result) => result.status === "FAILED",
        ).length,
      })),
    updateLineCount: options.updateLineCount ?? (async () => options.detail),
  } as unknown as InventoryCountRepository;
  const xlsx = {} as InventoryCountXlsx;
  const unasApi = {
    setStock:
      options.setStock ??
      (async () => ({ externalId: "1", sku: "REEF-SALT-01" })),
  } as unknown as UnasApiClient;
  const unasAuth = {
    getToken: async () => "token",
  } as unknown as UnasAuthService;
  return new InventoryCountService(repository, xlsx, unasApi, unasAuth);
}

describe("InventoryCountService.applyCorrection", () => {
  it("refuses to apply a count that hasn't been uploaded yet", async () => {
    const service = buildService({ detail: baseDetail({ status: "DRAFT" }) });
    await assert.rejects(() => service.applyCorrection("count-1", "user-1"));
  });

  it("refuses to apply a count that was already corrected", async () => {
    const service = buildService({
      detail: baseDetail({ status: "CORRECTED" }),
    });
    await assert.rejects(() => service.applyCorrection("count-1", "user-1"));
  });

  it("refuses to apply while any line is still uncounted", async () => {
    const detail = baseDetail();
    detail.lines[0]!.countedQty = null;
    detail.lines[0]!.differenceQty = null;
    const service = buildService({ detail });
    await assert.rejects(() => service.applyCorrection("count-1", "user-1"));
  });

  it("only pushes setStock for lines whose counted quantity differs", async () => {
    const pushedSkus: string[] = [];
    const service = buildService({
      detail: baseDetail(),
      setStock: async (_token, request) => {
        pushedSkus.push(request.sku);
        return { externalId: "1", sku: request.sku };
      },
    });

    await service.applyCorrection("count-1", "user-1");

    assert.deepEqual(pushedSkus, ["REEF-SALT-01"]);
  });

  it("keeps going and reports a per-line failure when a UNAS push fails", async () => {
    let capturedResults: Map<string, InventoryCountLinePushResult> | undefined;
    const detail = baseDetail();
    detail.lines.push({
      id: "line-3",
      variantId: "variant-3",
      sku: "FILTER-99",
      productName: "Szűrő",
      expectedQty: "5",
      countedQty: "7",
      differenceQty: "2",
      syncStatus: "PENDING",
      syncError: null,
    });
    const service = buildService({
      detail,
      setStock: async (_token, request) => {
        if (request.sku === "REEF-SALT-01") {
          throw new Error("UNAS_TIMEOUT");
        }
        return { externalId: "1", sku: request.sku };
      },
      applyCorrection: async (id, actorUserId, pushResults) => {
        capturedResults = pushResults;
        return {
          detail,
          movementNumber: "KORR-1",
          successCount: [...pushResults.values()].filter(
            (result) => result.status === "OK",
          ).length,
          failedCount: [...pushResults.values()].filter(
            (result) => result.status === "FAILED",
          ).length,
        };
      },
    });

    const result = await service.applyCorrection("count-1", "user-1");

    assert.equal(capturedResults?.get("line-1")?.status, "FAILED");
    assert.equal(capturedResults?.get("line-1")?.errorMessage, "UNAS_TIMEOUT");
    assert.equal(capturedResults?.get("line-3")?.status, "OK");
    assert.equal(result.successCount, 1);
    assert.equal(result.failedCount, 1);
  });
});

describe("InventoryCountService.updateLineCount", () => {
  it("refuses to edit a line once the count has been corrected", async () => {
    const service = buildService({
      detail: baseDetail({ status: "CORRECTED" }),
    });
    await assert.rejects(() => service.updateLineCount("count-1", "line-1", 5));
  });

  it("throws when the line does not belong to the count", async () => {
    const service = buildService({ detail: baseDetail() });
    await assert.rejects(() =>
      service.updateLineCount("count-1", "line-missing", 5),
    );
  });

  it("rejects a negative counted quantity", async () => {
    const service = buildService({ detail: baseDetail() });
    await assert.rejects(() =>
      service.updateLineCount("count-1", "line-1", -1),
    );
  });

  it("persists the new counted quantity for the matching line", async () => {
    let captured: [string, string, string] | undefined;
    const service = buildService({
      detail: baseDetail(),
      updateLineCount: async (id, lineId, countedQty) => {
        captured = [id, lineId, countedQty];
        return baseDetail();
      },
    });

    await service.updateLineCount("count-1", "line-1", 14);

    assert.deepEqual(captured, ["count-1", "line-1", "14"]);
  });
});
