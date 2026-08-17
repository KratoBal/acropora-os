import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductBarcodeSummary } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BarcodeEditor } from "./barcode-editor";

const api = vi.hoisted(() => ({
  addBarcode: vi.fn(),
  setPrimaryBarcode: vi.fn(),
  removeBarcode: vi.fn(),
}));

vi.mock("@/lib/api/products", () => ({ productApi: api }));

const barcodes: ProductBarcodeSummary[] = [
  { id: "barcode-1", code: "5901234123457", isPrimary: true },
  { id: "barcode-2", code: "96385074", isPrimary: false },
];

const renderEditor = (canManage = true, items = barcodes) =>
  render(
    <BarcodeEditor
      barcodes={items}
      canManage={canManage}
      onChanged={() => undefined}
      token="token-1"
      variantId="variant-1"
    />,
  );

describe("BarcodeEditor", () => {
  beforeEach(() => {
    api.addBarcode
      .mockReset()
      .mockResolvedValue({ id: "barcode-3", code: "ACRO1", isPrimary: false });
    api.setPrimaryBarcode.mockReset().mockResolvedValue({ items: barcodes });
    api.removeBarcode.mockReset().mockResolvedValue({ items: barcodes });
  });

  it("lists the codes and marks the primary one", () => {
    renderEditor();
    expect(screen.getByText("5901234123457")).toBeInTheDocument();
    expect(screen.getByText("Elsődleges")).toBeInTheDocument();
  });

  it("submits on Enter, because that is what a handheld scanner sends", async () => {
    renderEditor();
    const input = screen.getByLabelText("Új vonalkód");
    fireEvent.change(input, { target: { value: "5998200310010" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(api.addBarcode).toHaveBeenCalledWith("token-1", "variant-1", {
        code: "5998200310010",
      }),
    );
  });

  it("surfaces the server's message instead of a generic failure", async () => {
    api.addBarcode.mockRejectedValue(
      new Error(
        "Ez a vonalkód már a(z) ACR-114 cikkszámú változathoz tartozik.",
      ),
    );
    renderEditor();
    fireEvent.change(screen.getByLabelText("Új vonalkód"), {
      target: { value: "5901234123457" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hozzáadás" }));

    expect(await screen.findByText(/ACR-114/)).toBeInTheDocument();
  });

  it("offers promotion only for the codes that are not primary", () => {
    renderEditor();
    expect(
      screen.getAllByRole("button", { name: "Legyen elsődleges" }),
    ).toHaveLength(1);
  });

  it("shows no write controls without products.manage", () => {
    renderEditor(false);
    expect(screen.queryByLabelText("Új vonalkód")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Törlés" }),
    ).not.toBeInTheDocument();
    // Reading the codes stays available.
    expect(screen.getByText("5901234123457")).toBeInTheDocument();
  });

  it("says so when a variant has no barcode yet", () => {
    renderEditor(true, []);
    expect(screen.getByText("Nincs rögzítve")).toBeInTheDocument();
  });
});
