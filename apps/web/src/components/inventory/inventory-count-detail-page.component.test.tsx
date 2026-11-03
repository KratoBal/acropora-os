import { fireEvent, render, screen } from "@testing-library/react";
import type {
  InventoryCountLineDetail,
  InventoryCountStatus,
} from "@acropora/types";
import { PilotDataTable } from "@acropora/ui";
import { describe, expect, it, vi } from "vitest";

import {
  COUNT_LINE_TABLE_MIN_WIDTH,
  countLineColumns,
  isPendingLine,
  lineDifference,
} from "./inventory-count-detail-page";

/*
  A LELTÁR TÉTELTÁBLÁJA A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). MI PIROSÍT: ha egy
  oszlop elveszti a feliratát (telefonon a cella felirat nélkül maradna), ha a "UNAS szinkron" oszlop
  a nem korrigált leltárra is kikerül, ha a számláló mező a nem kezelőnek is megjelenik, vagy ha az
  eltérés a begépelt értéktől függetlenül marad, és ha a fix szélességek összege nem fér a tábla
  minimális szélességébe.
*/
function line(
  overrides: Partial<InventoryCountLineDetail> = {},
): InventoryCountLineDetail {
  return {
    id: "line-1",
    variantId: "variant-1",
    sku: "SKU-1",
    productName: "Teszt termék",
    expectedQty: "10",
    countedQty: null,
    differenceQty: null,
    syncStatus: "PENDING",
    syncError: null,
    ...overrides,
  };
}

function renderTable({
  status = "UPLOADED",
  canManage = true,
  lines = [line()],
  lineDrafts = {},
  saveLineCount = vi.fn(),
  setDraft = vi.fn(),
}: {
  status?: InventoryCountStatus;
  canManage?: boolean;
  lines?: InventoryCountLineDetail[];
  lineDrafts?: Record<string, string>;
  saveLineCount?: (lineId: string, raw: string) => void;
  setDraft?: (lineId: string, value: string) => void;
} = {}) {
  return render(
    <PilotDataTable
      columns={countLineColumns({
        status,
        canManage,
        lineDrafts,
        savingLineId: null,
        setDraft,
        saveLineCount,
      })}
      rows={lines}
      rowKey={(row) => row.id}
      rowTestId="count-line-row"
      minWidth={COUNT_LINE_TABLE_MIN_WIDTH}
    />,
  );
}

describe("countLineColumns", () => {
  it("labels every cell with its column for the phone card view", () => {
    renderTable();
    const row = screen.getAllByTestId("count-line-row")[0]!;
    const labels = [...row.querySelectorAll("td")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(labels).toEqual([
      "Cikkszám",
      "Termék",
      "Jelenlegi",
      "Leltározott",
      "Eltérés",
    ]);
  });

  it("adds the UNAS sync column only for a corrected count", () => {
    const corrected = renderTable({
      status: "CORRECTED",
      lines: [
        line({ countedQty: "9", syncStatus: "FAILED", syncError: "hiba" }),
      ],
    });
    expect(screen.getByText("UNAS szinkron")).toBeTruthy();
    expect(screen.getByText("Hiba")).toBeTruthy();
    expect(screen.getByText("hiba")).toBeTruthy();
    corrected.unmount();
    renderTable({ status: "UPLOADED" });
    expect(screen.queryByText("UNAS szinkron")).toBeNull();
  });

  it("marks an uncounted line next to its SKU, only after the upload", () => {
    const uploaded = renderTable({ status: "UPLOADED" });
    expect(screen.getByText("Nincs megszámolva")).toBeTruthy();
    uploaded.unmount();
    renderTable({ status: "DRAFT" });
    expect(screen.queryByText("Nincs megszámolva")).toBeNull();
  });

  it("offers the count input to a manager only", () => {
    const manager = renderTable({ canManage: true });
    expect(screen.getByLabelText("Leltározott mennyiség – SKU-1")).toBeTruthy();
    manager.unmount();
    renderTable({ canManage: false });
    expect(screen.queryByLabelText("Leltározott mennyiség – SKU-1")).toBeNull();
  });

  it("types into the draft and saves on blur", () => {
    const setDraft = vi.fn();
    const saveLineCount = vi.fn();
    renderTable({ setDraft, saveLineCount });
    const input = screen.getByLabelText("Leltározott mennyiség – SKU-1");
    fireEvent.change(input, { target: { value: "7" } });
    expect(setDraft).toHaveBeenCalledWith("line-1", "7");
    fireEvent.blur(input, { target: { value: "7" } });
    expect(saveLineCount).toHaveBeenCalledWith("line-1", "7");
  });

  it("shows the live difference of a typed draft", () => {
    renderTable({ lineDrafts: { "line-1": "7" } });
    expect(screen.getByText("-3")).toBeTruthy();
  });

  it("keeps the fixed widths inside the table minimum", () => {
    for (const status of ["UPLOADED", "CORRECTED"] as const) {
      const sum = countLineColumns({
        status,
        canManage: true,
        lineDrafts: {},
        savingLineId: null,
        setDraft: vi.fn(),
        saveLineCount: vi.fn(),
      })
        .map((column) => Number.parseInt(column.width ?? "0", 10))
        .reduce((a, b) => a + b, 0);
      expect(sum).toBeLessThanOrEqual(COUNT_LINE_TABLE_MIN_WIDTH);
    }
  });
});

describe("lineDifference and isPendingLine", () => {
  it("follows a valid draft only for a pending line", () => {
    expect(lineDifference(line(), "12", true)).toEqual({
      label: "2",
      value: 2,
    });
    expect(lineDifference(line(), "abc", true).label).toBe("—");
    expect(
      lineDifference(
        line({ countedQty: "9", differenceQty: "-1" }),
        "12",
        false,
      ),
    ).toEqual({ label: "-1", value: -1 });
  });

  it("calls a line pending only after the upload and without a count", () => {
    expect(isPendingLine("DRAFT", line())).toBe(false);
    expect(isPendingLine("UPLOADED", line())).toBe(true);
    expect(isPendingLine("UPLOADED", line({ countedQty: "1" }))).toBe(false);
  });
});
