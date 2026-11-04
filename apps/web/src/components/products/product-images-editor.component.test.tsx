import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductImageSummary } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductImagesEditor } from "./product-images-editor";

const api = vi.hoisted(() => ({
  setImageAlt: vi.fn(),
  setImageOrder: vi.fn(),
}));

vi.mock("@/lib/api/products", () => ({ productApi: api }));

/*
  A KÉPEK ALT-SZÖVEGE ÉS SORRENDJE (T4.1-D3, 4. szelet). MI PIROSÍT: ha az alt mentése nem a kép saját azonosítójával
  megy; ha változatlan altnál is menthető; ha a sorrend-csere nem a teljes, pontos permutációt küldi; ha az első kép
  előrébb vagy az utolsó hátrébb tehető; ha mentés után nem kér újratöltést.
*/
const images: ProductImageSummary[] = [
  { id: "img-1", url: "/a.jpg", sortOrder: 0, altText: null, title: null },
  {
    id: "img-2",
    url: "/b.jpg",
    sortOrder: 1,
    altText: "Oldalnézet",
    title: null,
  },
  { id: "img-3", url: "/c.jpg", sortOrder: 2, altText: null, title: null },
];

function renderEditor() {
  const onSaved = vi.fn();
  render(
    <ProductImagesEditor
      productId="product-1"
      productName="Acropora millepora"
      images={images}
      token="token-1"
      onSaved={onSaved}
    />,
  );
  return onSaved;
}

beforeEach(() => {
  api.setImageAlt.mockReset().mockResolvedValue({});
  api.setImageOrder.mockReset().mockResolvedValue({});
});

describe("ProductImagesEditor", () => {
  it("saves one image's alt text, and only once it changed", async () => {
    const onSaved = renderEditor();
    const save = screen.getAllByRole("button", { name: "Alt mentése" });
    expect(save[1]).toBeDisabled();
    fireEvent.change(screen.getByLabelText("2. kép alt-szövege"), {
      target: { value: "Felülnézet" },
    });
    expect(save[1]).toBeEnabled();
    fireEvent.click(save[1]!);
    await waitFor(() =>
      expect(api.setImageAlt).toHaveBeenCalledWith(
        "token-1",
        "product-1",
        "img-2",
        "Felülnézet",
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("moves an image and sends the whole order", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "3. kép előrébb" }));
    await waitFor(() =>
      expect(api.setImageOrder).toHaveBeenCalledWith("token-1", "product-1", [
        "img-1",
        "img-3",
        "img-2",
      ]),
    );
  });

  it("keeps the first image from moving up and the last from moving down", () => {
    renderEditor();
    expect(
      screen.getByRole("button", { name: "1. kép előrébb" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "3. kép hátrébb" }),
    ).toBeDisabled();
  });
});
