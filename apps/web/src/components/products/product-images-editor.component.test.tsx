import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductImageSummary } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductImagesEditor } from "./product-images-editor";

const api = vi.hoisted(() => ({
  setImageAlt: vi.fn(),
  setImageOrder: vi.fn(),
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
  downloadImage: vi.fn(),
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
  api.uploadImage.mockReset().mockResolvedValue({});
  api.deleteImage.mockReset().mockResolvedValue({});
  api.downloadImage.mockReset().mockResolvedValue(new Blob(["x"]));
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

  /*
    FELTÖLTÉS ÉS TÖRLÉS (6. szelet). MI PIROSÍT: ha a feltöltés nem a kiválasztott fájlt küldi, vagy utána nem kér
    újratöltést; ha a törlés egy kattintásra, megerősítés nélkül indul, vagy nem a kép saját azonosítójával; ha a
    feltöltött kép (`os-upload:`) a nyers címet kapja `src`-nek a tároló fájlja helyett.
  */
  it("uploads the chosen file and reloads", async () => {
    const onSaved = renderEditor();
    const file = new File(["kep"], "kek.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Kép feltöltése"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(api.uploadImage).toHaveBeenCalledWith(
        "token-1",
        "product-1",
        file,
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("deletes an image only after the second click", async () => {
    const onSaved = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "2. kép törlése" }));
    expect(api.deleteImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Végleges törlés" }));
    await waitFor(() =>
      expect(api.deleteImage).toHaveBeenCalledWith(
        "token-1",
        "product-1",
        "img-2",
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("cancels a delete without a request", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "1. kép törlése" }));
    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));
    expect(api.deleteImage).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "1. kép törlése" }),
    ).toBeInTheDocument();
  });

  it("shows an uploaded image from the store, not from its hash", async () => {
    const createObjectURL = vi.fn(() => "blob:kep-1");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL, revokeObjectURL }),
    );
    render(
      <ProductImagesEditor
        productId="product-1"
        productName="Acropora millepora"
        images={[
          {
            id: "img-up",
            url: "os-upload:abc",
            sortOrder: 0,
            altText: null,
            title: null,
          },
        ]}
        token="token-1"
        onSaved={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Acropora millepora" }),
      ).toHaveAttribute("src", "blob:kep-1"),
    );
    expect(api.downloadImage).toHaveBeenCalledWith(
      "token-1",
      "product-1",
      "img-up",
    );
    vi.unstubAllGlobals();
  });

  it("shows a web image from its url, without a download", () => {
    renderEditor();
    expect(screen.getAllByRole("img")[0]).toHaveAttribute("src", "/a.jpg");
    expect(api.downloadImage).not.toHaveBeenCalled();
  });
});
