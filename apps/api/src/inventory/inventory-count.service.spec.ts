import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InventoryCountDetail } from "@acropora/types";

import type { InventoryCountXlsx } from "./inventory-count-xlsx.js";
import type { InventoryCountRepository } from "./inventory-count.repository.js";
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
  applyCorrection?: InventoryCountRepository["applyCorrection"];
  updateLineCount?: InventoryCountRepository["updateLineCount"];
}) {
  const repository = {
    findById: async () => options.detail,
    applyCorrection:
      options.applyCorrection ??
      (async () => ({
        detail: options.detail,
        movementNumber: "KORR-1",
        successCount: options.detail.lines.length,
        failedCount: 0,
      })),
    updateLineCount: options.updateLineCount ?? (async () => options.detail),
  } as unknown as InventoryCountRepository;
  const xlsx = {} as InventoryCountXlsx;
  // No UnasApiClient/UnasAuthService dependency anymore - the service can no
  // longer reach UNAS synchronously at all (that's the point: the
  // constructor literally has no way to). See InventoryCountService's own
  // constructor signature.
  return new InventoryCountService(repository, xlsx);
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

  it("delegates directly to the repository once the guard checks pass, with no UNAS push in between", async () => {
    let capturedArgs: [string, string] | undefined;
    const detail = baseDetail();
    const service = buildService({
      detail,
      applyCorrection: async (id, actorUserId) => {
        capturedArgs = [id, actorUserId];
        return {
          detail,
          movementNumber: "KORR-1",
          successCount: 2,
          failedCount: 0,
        };
      },
    });

    const result = await service.applyCorrection("count-1", "user-1");

    assert.deepEqual(capturedArgs, ["count-1", "user-1"]);
    assert.equal(result.movementNumber, "KORR-1");
    assert.equal(result.successCount, 2);
    assert.equal(result.failedCount, 0);
  });

  it("propagates a repository-level conflict (e.g. a detected concurrent double-apply) instead of swallowing it", async () => {
    const service = buildService({
      detail: baseDetail(),
      applyCorrection: async () => {
        throw new Error(
          "A leltár korrekciója közben egy másik feldolgozás már lekönyvelte ezt a leltárt.",
        );
      },
    });

    await assert.rejects(
      () => service.applyCorrection("count-1", "user-1"),
      /már lekönyvelte/,
    );
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
