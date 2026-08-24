import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProductDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductAuthorityCard } from "./product-authority-card";

const api = vi.hoisted(() => ({ takeCatalogAuthority: vi.fn() }));

vi.mock("@/lib/api/products", () => ({ productApi: api }));

const product = (
  catalogAuthority: ProductDetail["catalogAuthority"],
): ProductDetail =>
  ({
    id: "product-1",
    name: "Reef Pump",
    catalogAuthority,
    origin: "UNAS",
  }) as unknown as ProductDetail;

function renderCard(
  catalogAuthority: ProductDetail["catalogAuthority"],
  canTransfer = true,
) {
  const onTransferred = vi.fn();
  render(
    <ProductAuthorityCard
      token="token-1"
      product={product(catalogAuthority)}
      canTransfer={canTransfer}
      onTransferred={onTransferred}
    />,
  );
  return onTransferred;
}

beforeEach(() => {
  api.takeCatalogAuthority.mockReset();
});

describe("ProductAuthorityCard", () => {
  /**
   * The consequence, not the question. What makes this transfer dangerous is
   * not that something is deleted but that something goes QUIET afterwards:
   * a correction made in UNAS stops arriving, and nothing reports it. A
   * dialog that only asks "are you sure" would hide exactly that.
   */
  it("names what stops happening before taking the master data over", async () => {
    api.takeCatalogAuthority.mockResolvedValue(product("ACROPORA"));
    const onTransferred = renderCard("UNAS");

    fireEvent.click(screen.getByRole("button", { name: "Törzsadat átvétele" }));

    expect(screen.getByText(/nem érkezik meg/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Átvesszük a törzsadatot" }),
    );

    await waitFor(() =>
      expect(api.takeCatalogAuthority).toHaveBeenCalledWith(
        "token-1",
        "product-1",
      ),
    );
    expect(onTransferred).toHaveBeenCalled();
  });

  /**
   * The half a single test would miss: the confirmation is a real gate, not
   * decoration. Opening it and backing out must leave the product where it
   * was, because this transfer has no way back.
   */
  it("takes nothing over when the confirmation is dismissed", () => {
    renderCard("UNAS");

    fireEvent.click(screen.getByRole("button", { name: "Törzsadat átvétele" }));
    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));

    expect(api.takeCatalogAuthority).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Törzsadat átvétele" }),
    ).toBeTruthy();
  });

  /**
   * Without the permission the card still explains who owns the product. The
   * absence of the button must not be the only signal, or a reader cannot
   * tell "not allowed" from "already ours".
   */
  it("still says who owns the product when the transfer is not allowed", () => {
    renderCard("UNAS", false);

    expect(screen.getByText("UNAS webshop")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Törzsadat átvétele" }),
    ).toBeNull();
  });

  it("offers nothing to take over on a product that is already ours", () => {
    renderCard("ACROPORA");

    expect(screen.getByText("Acropora OS")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Törzsadat átvétele" }),
    ).toBeNull();
  });

  /**
   * An unresolved owner is a data state, and saying so is the point: the
   * screen must not present it as a missing permission, because the fix is
   * different.
   */
  it("separates an unknown owner from a missing permission", () => {
    renderCard(null);

    expect(screen.getByText("Ellenőrzendő")).toBeTruthy();
    expect(screen.getByText(/nem jogosultsági/)).toBeTruthy();
  });
});
