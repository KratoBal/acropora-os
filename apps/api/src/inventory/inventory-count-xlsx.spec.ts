import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InventoryCountDetail } from "@acropora/types";

import { InventoryCountXlsx } from "./inventory-count-xlsx.js";

const detail: InventoryCountDetail = {
  id: "count-1",
  countNumber: "LELTAR-1",
  status: "DRAFT",
  warehouseId: "warehouse-1",
  warehouseName: "Fő raktár",
  startedByName: "Teszt Felhasználó",
  createdAt: "2026-07-21T10:00:00.000Z",
  uploadedAt: null,
  correctedAt: null,
  lines: [
    {
      id: "line-1",
      variantId: "variant-1",
      sku: "REEF-SALT-01",
      productName: "Reef Salt",
      expectedQty: "12",
      countedQty: null,
      differenceQty: null,
      syncStatus: "PENDING",
      syncError: null,
    },
    {
      id: "line-2",
      variantId: "variant-2",
      sku: "PUMP-XL",
      productName: "Reef Pumpa XL",
      expectedQty: "3.5",
      countedQty: null,
      differenceQty: null,
      syncStatus: "PENDING",
      syncError: null,
    },
  ],
};

describe("InventoryCountXlsx", () => {
  it("builds a real xlsx (zip) buffer, not an unresolved promise", async () => {
    const xlsx = new InventoryCountXlsx();
    const buffer = await xlsx.buildTemplate(detail);

    assert.ok(
      Buffer.isBuffer(buffer),
      "buildTemplate must resolve to a Buffer",
    );
    // XLSX files are zip archives; zip files start with the "PK" signature.
    assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  });

  it("pre-fills the counted quantity with the current known quantity, not zero", async () => {
    const xlsx = new InventoryCountXlsx();
    const buffer = await xlsx.buildTemplate(detail);
    const { rows } = await xlsx.parseUpload(buffer);

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.sku, "REEF-SALT-01");
    assert.equal(rows[0]?.countedQty, "12");
    assert.equal(rows[1]?.sku, "PUMP-XL");
    assert.equal(rows[1]?.countedQty, "3.5");
  });

  it("pre-fills with a previously entered count when re-downloading after a partial upload", async () => {
    const partiallyCounted: InventoryCountDetail = {
      ...detail,
      lines: [{ ...detail.lines[0]!, countedQty: "10" }, detail.lines[1]!],
    };
    const xlsx = new InventoryCountXlsx();
    const buffer = await xlsx.buildTemplate(partiallyCounted);
    const { rows } = await xlsx.parseUpload(buffer);

    assert.equal(
      rows.find((row) => row.sku === "REEF-SALT-01")?.countedQty,
      "10",
    );
    assert.equal(rows.find((row) => row.sku === "PUMP-XL")?.countedQty, "3.5");
  });

  it("treats a blank counted-quantity cell as not entered, not as zero", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Leltár");
    sheet.addRow([
      "Cikkszám",
      "Termék",
      "Jelenlegi mennyiség",
      "Leltározott mennyiség",
    ]);
    sheet.addRow(["REEF-SALT-01", "Reef Salt", 12, null]);
    sheet.addRow(["PUMP-XL", "Reef Pumpa XL", 3.5, 5]);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const xlsx = new InventoryCountXlsx();
    const { rows } = await xlsx.parseUpload(buffer);

    // Only the row with an actual value comes back; the blank row is
    // skipped entirely rather than being reported as counted-as-zero.
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sku, "PUMP-XL");
  });

  it("rejects a workbook missing the required columns", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Leltár");
    sheet.addRow(["Valami más oszlop"]);
    sheet.addRow(["x"]);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const xlsx = new InventoryCountXlsx();
    await assert.rejects(() => xlsx.parseUpload(buffer));
  });

  it("rejects a non-numeric counted quantity", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Leltár");
    sheet.addRow([
      "Cikkszám",
      "Termék",
      "Jelenlegi mennyiség",
      "Leltározott mennyiség",
    ]);
    sheet.addRow(["REEF-SALT-01", "Reef Salt", 12, "sok"]);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const xlsx = new InventoryCountXlsx();
    await assert.rejects(() => xlsx.parseUpload(buffer));
  });
});
