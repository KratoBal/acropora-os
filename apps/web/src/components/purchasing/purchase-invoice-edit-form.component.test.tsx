import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PurchaseInvoiceDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseInvoiceEditForm } from "./purchase-invoice-edit-form";

const api = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/api/purchasing", () => ({ purchasingApi: api }));

const line = (id: string, name: string) => ({
  id,
  sourceDescription: name,
  orderedQuantity: "1",
  actualQuantity: "1",
  unit: "db",
  unitNet: "1000",
  lineNet: "1000",
  syncStatus: "NOT_LINKED" as const,
  projectAllocations: [],
  reservedQuantity: "0",
  warehouseQuantity: "1",
});

const detail = (currency = "HUF"): PurchaseInvoiceDetail =>
  ({
    id: "pi-1",
    documentNumber: "BE-1",
    supplierInvoiceNumber: "SK-17",
    source: currency === "HUF" ? "HU_MANUAL" : "EU",
    status: "POSTED",
    supplierId: "s",
    supplierName: "Szlovák beszállító",
    currency,
    invoiceDate: "2026-10-08T00:00:00.000Z",
    isPaid: false,
    totalNet: "2000",
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
    warehouseId: "w",
    lines: [line("l1", "Első"), line("l2", "Második")],
  }) as PurchaseInvoiceDetail;

describe("A rögzített számla javítása (Luca, 2026-10-08)", () => {
  beforeEach(() => {
    api.update.mockReset();
  });

  it("csak a változott sor nevét küldi, a többi mezővel együtt", async () => {
    api.update.mockResolvedValue(detail());
    const onSaved = vi.fn();
    render(
      <PurchaseInvoiceEditForm
        token="t"
        detail={detail()}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/könyvelői csomag hónapját/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Kelte"), {
      target: { value: "2026-10-07" },
    });
    // the date's two side effects, said where it is changed
    expect(screen.getByText(/könyvelői csomag hónapját/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Kelte"), {
      target: { value: "2026-10-08" },
    });
    fireEvent.change(screen.getByLabelText("2. tétel neve a számlán"), {
      target: { value: "Második, pontosan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Javítás mentése" }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0]![2]).toEqual({
      supplierInvoiceNumber: "SK-17",
      invoiceDate: "2026-10-08",
      dueDate: null,
      isPaid: false,
      note: null,
      lines: [{ id: "l2", sourceDescription: "Második, pontosan" }],
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("devizás számlán a kelte zárt, és nem is küldi", async () => {
    api.update.mockResolvedValue(detail("EUR"));
    render(
      <PurchaseInvoiceEditForm
        token="t"
        detail={detail("EUR")}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("Kelte") as HTMLInputElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Javítás mentése" }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0]![2]).not.toHaveProperty("invoiceDate");
  });

  it("a szerver elutasítását kiírja", async () => {
    api.update.mockImplementation(() =>
      Promise.reject(
        new Error(
          "Ennél a beszállítónál már van ilyen számlaszámú rögzített számla.",
        ),
      ),
    );
    render(
      <PurchaseInvoiceEditForm
        token="t"
        detail={detail()}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Javítás mentése" }));
    expect(await screen.findByText(/már van ilyen számlaszámú/)).toBeTruthy();
  });
});
