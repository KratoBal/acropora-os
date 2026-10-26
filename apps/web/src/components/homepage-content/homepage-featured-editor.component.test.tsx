import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomepageFeaturedEditor } from "./homepage-featured-editor";

/*
  "EGYEDI KORALLOK" IN THE HOME PAGE ADMIN (2b-2). What turns these red: a
  reorder that sends anything but the full marked list in the new order; a
  removal or an addition that does not go to the marker endpoint; a product
  already in the band offered again; a thirteenth product addable; the name,
  image or price taken from anywhere but the server's list; a failed change
  that leaves a stale list on the screen.
*/
const api = vi.hoisted(() => ({
  featured: vi.fn(),
  setFeatured: vi.fn(),
  orderFeatured: vi.fn(),
}));
const products = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/homepage-content", () => ({ homepageContentApi: api }));
vi.mock("@/lib/api/products", () => ({ productApi: products }));

const row = (id: string, over: Record<string, unknown> = {}) => ({
  productId: id,
  name: `Korall ${id}`,
  sortOrder: 0,
  imageUrl: `https://cdn.example.hu/${id}.jpg`,
  grossPrice: "12990",
  ...over,
});

beforeEach(() => {
  api.featured.mockReset().mockResolvedValue([row("a"), row("b"), row("c")]);
  api.setFeatured.mockReset();
  api.orderFeatured.mockReset();
  products.list.mockReset().mockResolvedValue({ items: [] });
});

describe("HomepageFeaturedEditor", () => {
  it("shows the band from the server, the first as the large card, with its price", async () => {
    render(<HomepageFeaturedEditor token="t" onProjection={() => {}} />);
    expect(await screen.findByText("Korall a")).toBeTruthy();
    expect(screen.getByText("Nagy kártya · 12 990 Ft")).toBeTruthy();
  });

  it("a move sends the whole marked list in the new order, and tells what the shop did", async () => {
    const onProjection = vi.fn();
    api.orderFeatured.mockResolvedValue({
      list: [row("a"), row("c"), row("b")],
      projection: "sent",
    });
    render(<HomepageFeaturedEditor token="t" onProjection={onProjection} />);
    fireEvent.keyDown(
      await screen.findByRole("button", { name: /^Korall c áthelyezése/ }),
      { key: "ArrowUp" },
    );
    await waitFor(() =>
      expect(api.orderFeatured).toHaveBeenCalledWith("t", ["a", "c", "b"]),
    );
    await waitFor(() => expect(onProjection).toHaveBeenCalledWith("sent"));
  });

  it("removes and adds through the marker; a marked product is not offered again", async () => {
    api.setFeatured.mockResolvedValue({
      featured: false,
      list: [row("b"), row("c")],
      projection: "off",
    });
    products.list.mockResolvedValue({
      items: [
        { id: "a", name: "Korall a", primarySku: null },
        { id: "d", name: "Korall d", primarySku: "K-4" },
      ],
    });
    render(<HomepageFeaturedEditor token="t" onProjection={() => {}} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Korall a eltávolítása" }),
    );
    await waitFor(() =>
      expect(api.setFeatured).toHaveBeenCalledWith("t", "a", false),
    );
    api.featured.mockResolvedValue([row("b"), row("c")]);
    fireEvent.change(
      screen.getByLabelText("Termék keresése az Egyedi korallokhoz"),
      { target: { value: "korall" } },
    );
    const hit = await screen.findByRole("button", { name: /Korall d/ });
    expect(screen.queryByRole("button", { name: /^Korall b$/ })).toBeNull();
    api.setFeatured.mockResolvedValue({
      featured: true,
      list: [row("b"), row("c"), row("d")],
      projection: "off",
    });
    fireEvent.click(hit);
    await waitFor(() =>
      expect(api.setFeatured).toHaveBeenLastCalledWith("t", "d", true),
    );
  });

  it("with twelve products no new one can be added", async () => {
    api.featured.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => row(`p${i}`)),
    );
    render(<HomepageFeaturedEditor token="t" onProjection={() => {}} />);
    const box = (await screen.findByLabelText(
      "Termék keresése az Egyedi korallokhoz",
    )) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/Elérted a 12 terméket/)).toBeTruthy();
  });

  it("a refused change says so and reloads the server's list", async () => {
    api.orderFeatured.mockRejectedValue(
      new Error("A kijelölt termékek közben változtak; töltsd újra a listát."),
    );
    render(<HomepageFeaturedEditor token="t" onProjection={() => {}} />);
    fireEvent.keyDown(
      await screen.findByRole("button", { name: /^Korall b áthelyezése/ }),
      { key: "ArrowDown" },
    );
    expect(await screen.findByText(/közben változtak/)).toBeTruthy();
    await waitFor(() => expect(api.featured).toHaveBeenCalledTimes(2));
  });
});
