import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PurchaseInvoiceDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseInvoiceCancelForm } from "./purchase-invoice-cancel-form";

const api = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("@/lib/api/purchasing", () => ({ purchasingApi: api }));

const detail = {
  id: "pi-1",
  documentNumber: "BE-1",
  supplierInvoiceNumber: "SK-17",
  source: "HU_MANUAL",
  status: "POSTED",
  supplierId: "s",
  supplierName: "Beszállító",
  currency: "HUF",
  invoiceDate: "2026-10-08T00:00:00.000Z",
  isPaid: false,
  totalNet: "2000",
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
  warehouseId: "w",
  lines: [],
} as PurchaseInvoiceDetail;

describe("A rögzített számla sztornója (acrobot 28092)", () => {
  beforeEach(() => {
    api.cancel.mockReset();
  });

  it("ok nélkül nem küldhető, az okot levágva küldi", async () => {
    const cancelled = { ...detail, status: "CANCELLED" as const };
    api.cancel.mockResolvedValue(cancelled);
    const onCancelled = vi.fn();
    render(
      <PurchaseInvoiceCancelForm
        token="t"
        detail={detail}
        onCancelled={onCancelled}
        onClose={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Sztornózás" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("A sztornó oka"), {
      target: { value: "  Rossz szállítóra rögzítve  " },
    });
    fireEvent.click(button);
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(cancelled));
    expect(api.cancel).toHaveBeenCalledWith("t", "pi-1", {
      reason: "Rossz szállítóra rögzítve",
    });
  });

  it("a szerver elutasítását kiírja, és nem zárja be az űrlapot", async () => {
    api.cancel.mockRejectedValue(
      new Error("Kifizetett számla nem sztornózható."),
    );
    const onCancelled = vi.fn();
    render(
      <PurchaseInvoiceCancelForm
        token="t"
        detail={detail}
        onCancelled={onCancelled}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("A sztornó oka"), {
      target: { value: "Fizetve" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sztornózás" }));
    expect(
      await screen.findByText("Kifizetett számla nem sztornózható."),
    ).toBeTruthy();
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
