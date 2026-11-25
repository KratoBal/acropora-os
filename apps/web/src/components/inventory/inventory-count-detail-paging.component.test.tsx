import { fireEvent, render, screen } from "@testing-library/react";
import type {
  InventoryCountDetail,
  InventoryCountLineDetail,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COUNT_LINE_PAGE_SIZE,
  countLinesView,
  InventoryCountDetailPage,
} from "./inventory-count-detail-page";

/*
  A LELTÁR TÉTELEI LAPOZVA (picasso képernyő-leltára, kártya 8e09b177): egy 1922 tételes leltár egy lapon 139 000 px volt. MI
  PIROSÍT: ha a lap megint minden sort kirajzol; ha a keresés nem a cikkszámra és a névre szűr; ha a "csak a meg nem számoltak"
  a megszámolt sort is mutatja; ha egy lap a szűrt lista végén túlra mutat (üres lap jönne).
*/
vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);

const api = vi.hoisted(() => ({ detail: vi.fn() }));
vi.mock("@/lib/api/inventory", () => ({ inventoryApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "raktar@acropora.local",
    displayName: "Raktáros",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session }),
}));

const line = (n: number, counted: boolean): InventoryCountLineDetail => ({
  id: `line-${n}`,
  variantId: `variant-${n}`,
  sku: `SKU-${String(n).padStart(4, "0")}`,
  productName: n === 77 ? "Korallsó 20 kg" : `Termék ${n}`,
  expectedQty: "5",
  countedQty: counted ? "5" : null,
  differenceQty: counted ? "0" : null,
  syncStatus: "PENDING",
  syncError: null,
});

// 120 lines, every third one not counted yet
const lines = Array.from({ length: 120 }, (_, i) => line(i + 1, i % 3 !== 0));

const detail: InventoryCountDetail = {
  id: "count-1",
  countNumber: "LELT-2026-001",
  status: "UPLOADED",
  warehouseId: "wh-1",
  warehouseName: "Bolt",
  startedByName: "Raktáros",
  createdAt: "2026-11-25T10:00:00.000Z",
  uploadedAt: "2026-11-25T11:00:00.000Z",
  correctedAt: null,
  lines,
};

beforeEach(() => {
  api.detail.mockReset().mockResolvedValue(detail);
});

describe("countLinesView", () => {
  it("pages, searches the SKU and the name, and keeps only the uncounted on request", () => {
    const first = countLinesView("UPLOADED", lines, {
      search: "",
      pendingOnly: false,
      page: 1,
    });
    expect(first.rows).toHaveLength(COUNT_LINE_PAGE_SIZE);
    expect(first.totalPages).toBe(3);
    expect(
      countLinesView("UPLOADED", lines, {
        search: "",
        pendingOnly: false,
        page: 3,
      }).rows,
    ).toHaveLength(20);
    expect(
      countLinesView("UPLOADED", lines, {
        search: "korallsó",
        pendingOnly: false,
        page: 1,
      }).rows.map((row) => row.id),
    ).toEqual(["line-77"]);
    expect(
      countLinesView("UPLOADED", lines, {
        search: "sku-0012",
        pendingOnly: false,
        page: 1,
      }).rows.map((row) => row.id),
    ).toEqual(["line-12"]);
    const pending = countLinesView("UPLOADED", lines, {
      search: "",
      pendingOnly: true,
      page: 1,
    });
    expect(pending.shown).toBe(40);
    expect(pending.rows.every((row) => row.countedQty === null)).toBe(true);
  });

  it("a page past the end shows the last one there is", () => {
    const view = countLinesView("UPLOADED", lines, {
      search: "",
      pendingOnly: true,
      page: 3,
    });
    expect(view.page).toBe(1);
    expect(view.rows).toHaveLength(40);
  });
});

describe("InventoryCountDetailPage -- a tételek lapozva", () => {
  it("draws one page of lines, and the filter goes back to the first page", async () => {
    render(<InventoryCountDetailPage countId="count-1" />);
    expect(await screen.findAllByTestId("count-line-row")).toHaveLength(
      COUNT_LINE_PAGE_SIZE,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /következő/i })[0]!);
    expect(screen.getByText("SKU-0051")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Csak a meg nem számoltak" }),
    );
    expect(screen.getAllByTestId("count-line-row")).toHaveLength(40);
    expect(screen.getByText("SKU-0001")).toBeTruthy();
    expect(screen.getByText("40 / 120 tétel")).toBeTruthy();
  });
});
