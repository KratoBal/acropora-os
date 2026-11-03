import { render, screen } from "@testing-library/react";
import { PilotDataTable } from "@acropora/ui";
import type { CashRegisterReceiptListResponse } from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  RECEIPT_COLUMNS,
  RECEIPT_TABLE_MIN_WIDTH,
  receiptStatusLabel,
} from "./billing-receipts-view";

/*
  A NYUGTÁK A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha egy oszlop elveszti a
  feliratát (telefonon a cella felirat nélkül maradna), ha a nyugta sorai nem nyithatók le a számával
  együtt, ha a NAV-figyelmeztetés eltűnik, ha a státuszfelirat egy ágon rossz, vagy ha a rugalmas
  nyugtaszám oszlopnak nem marad 200 px a minimumon.
*/
type Receipt = CashRegisterReceiptListResponse["items"][number];

const receipt = {
  id: "receipt-1",
  receiptNumber: "2820/00001",
  apNumber: "AP-1",
  issuedAt: "2026-11-03T08:32:00.000Z",
  paymentMeans: "CASH+CARD",
  total: "11800",
  cancelled: false,
  kind: "SALE",
  validationCode: "OK",
  lines: [{ quantity: "2", name: "Sózó", sum: "11800", vatCode: "A27" }],
} as unknown as Receipt;

function renderReceipts(rows: Receipt[]) {
  return render(
    <PilotDataTable
      columns={RECEIPT_COLUMNS}
      rows={rows}
      rowKey={(r) => r.id}
      rowTestId="receipt-row"
      minWidth={RECEIPT_TABLE_MIN_WIDTH}
    />,
  );
}

describe("RECEIPT_COLUMNS", () => {
  it("labels every cell with its column for the phone card view", () => {
    renderReceipts([receipt]);
    const row = screen.getAllByTestId("receipt-row")[0]!;
    expect(
      [...row.querySelectorAll("td")].map((td) =>
        td.getAttribute("data-label"),
      ),
    ).toEqual([
      "Nyugtaszám / AP",
      "Kelt",
      "Fizetési mód",
      "Végösszeg",
      "Állapot",
    ]);
  });

  it("keeps the receipt's lines under its number, with the AP number", () => {
    renderReceipts([receipt]);
    expect(screen.getByText("2820/00001").closest("details")).not.toBeNull();
    expect(screen.getByText("AP-1")).toBeTruthy();
    expect(screen.getByText(/2 × Sózó/)).toBeTruthy();
  });

  it("shows the NAV warning only for a WARN receipt", () => {
    const ok = renderReceipts([receipt]);
    expect(screen.queryByText("NAV figyelmeztetés")).toBeNull();
    ok.unmount();
    renderReceipts([{ ...receipt, validationCode: "WARN" } as Receipt]);
    expect(screen.getByText("NAV figyelmeztetés")).toBeTruthy();
  });

  it("keeps the date on one line", () => {
    renderReceipts([receipt]);
    const cell = screen
      .getAllByTestId("receipt-row")[0]!
      .querySelectorAll("td")[1]!;
    expect(cell.className).toContain("whitespace-nowrap");
  });

  it("leaves the flexible receipt number column at least 200 px at the table minimum", () => {
    const sum = RECEIPT_COLUMNS.map((column) =>
      Number.parseInt(column.width ?? "0", 10),
    ).reduce((a, b) => a + b, 0);
    expect(sum + 200).toBeLessThanOrEqual(RECEIPT_TABLE_MIN_WIDTH);
  });
});

describe("receiptStatusLabel", () => {
  it("names every state, a cancelled receipt first", () => {
    expect(receiptStatusLabel({ cancelled: true, kind: "SALE" })).toBe(
      "Törölt",
    );
    expect(receiptStatusLabel({ cancelled: true, kind: "STORNO" })).toBe(
      "Törölt",
    );
    expect(receiptStatusLabel({ cancelled: false, kind: "STORNO" })).toBe(
      "Sztornó",
    );
    expect(receiptStatusLabel({ cancelled: false, kind: "RETURN" })).toBe(
      "Visszáru",
    );
    expect(receiptStatusLabel({ cancelled: false, kind: "SALE" })).toBe(
      "Eladás",
    );
  });
});
