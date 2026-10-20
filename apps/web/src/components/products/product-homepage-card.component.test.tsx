import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductHomepageCard } from "./product-homepage-card";

/*
  THE PER-PRODUCT MARKER FOR THE HOME PAGE BAND. What turns these red: a box
  that is checked for a product that is not marked (or the other way round); a
  viewer able to change it; the marker lost when the server answers with an
  error; the projection result not told.
*/
const api = vi.hoisted(() => ({ featured: vi.fn(), setFeatured: vi.fn() }));
vi.mock("@/lib/api/homepage-content", () => ({ homepageContentApi: api }));

const item = (productId: string, sortOrder = 0) => ({
  productId,
  name: `Termék ${productId}`,
  sortOrder,
});

beforeEach(() => {
  api.featured.mockReset().mockResolvedValue([item("p2")]);
  api.setFeatured.mockReset();
});

const box = async () =>
  (await screen.findByLabelText(
    "Egyedi korall a kezdőlapon",
  )) as HTMLInputElement;

describe("ProductHomepageCard", () => {
  it("HP-CARD-STATE: checked only when this product is marked", async () => {
    const { rerender } = render(
      <ProductHomepageCard token="t" productId="p1" canManage />,
    );
    await waitFor(() => expect(api.featured).toHaveBeenCalled());
    expect((await box()).checked).toBe(false);
    rerender(<ProductHomepageCard token="t" productId="p2" canManage />);
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "Egyedi korall a kezdőlapon",
          ) as HTMLInputElement
        ).checked,
      ).toBe(true),
    );
  });

  it("HP-CARD-MARK: marking sends the product and the new state, and tells the projection result", async () => {
    api.setFeatured.mockResolvedValue({
      featured: true,
      list: [item("p2"), item("p1", 1)],
      projection: "sent",
    });
    render(<ProductHomepageCard token="t" productId="p1" canManage />);
    const input = await box();
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(input);
    await waitFor(() =>
      expect(api.setFeatured).toHaveBeenCalledWith("t", "p1", true),
    );
    expect(await screen.findByText(/elküldve a webshopnak/)).toBeTruthy();
    expect((await box()).checked).toBe(true);
    expect(screen.getByText(/Most 2 jelölt/)).toBeTruthy();
  });

  it("HP-CARD-UNMARK: unmarking sends false", async () => {
    api.featured.mockResolvedValue([item("p1")]);
    api.setFeatured.mockResolvedValue({
      featured: false,
      list: [],
      projection: "off",
    });
    render(<ProductHomepageCard token="t" productId="p1" canManage />);
    const input = await box();
    await waitFor(() => expect(input.checked).toBe(true));
    fireEvent.click(input);
    await waitFor(() =>
      expect(api.setFeatured).toHaveBeenCalledWith("t", "p1", false),
    );
    expect(await screen.findByText(/ki van kapcsolva/)).toBeTruthy();
  });

  it("HP-CARD-RIGHTS: a viewer sees the state and cannot change it", async () => {
    render(<ProductHomepageCard token="t" productId="p2" canManage={false} />);
    const input = await box();
    await waitFor(() => expect(input.checked).toBe(true));
    expect(input.disabled).toBe(true);
  });

  it("HP-CARD-ERROR: a refused marker (the band is full) is told and the box does not lie", async () => {
    api.setFeatured.mockRejectedValue(
      new Error("legfeljebb 12 egyedi korall látszik"),
    );
    render(<ProductHomepageCard token="t" productId="p1" canManage />);
    const input = await box();
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(input);
    expect(await screen.findByText(/legfeljebb 12/)).toBeTruthy();
    expect((await box()).checked).toBe(false);
  });
});
