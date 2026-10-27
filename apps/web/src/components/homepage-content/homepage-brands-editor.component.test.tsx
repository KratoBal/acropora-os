import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HomepageBrand } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomepageBrandsEditor } from "./homepage-brands-editor";
import { previewRecord } from "./homepage-preview-protocol";

/*
  "MÁRKÁK" IN THE HOME PAGE ADMIN (Balázs, 2026-10-27). What turns these red: a
  move that does not hand back the whole list in the new order; a brand already
  listed offered again; an added brand without its logo (the logo is on the
  detail, not on the search hit); a switched-off brand dropped from the list or
  not marked; a cap on the number of brands; the preview sending a never-set
  list, or a switched-off brand.
*/
const brands = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/api/brands", () => ({ brandsApi: brands }));

const brand = (
  id: string,
  over: Partial<HomepageBrand> = {},
): HomepageBrand => ({
  id,
  name: `Márka ${id}`,
  slug: `marka-${id}`,
  logoUrl: `https://cdn.example.hu/${id}.png`,
  shown: true,
  ...over,
});
const hit = (id: string) => ({
  id,
  name: `Márka ${id}`,
  normalizedName: id,
  slug: `marka-${id}`,
  isActive: true,
  aliases: [],
  externalMappings: [],
  usage: { productCount: 7, reviewReferenceCount: 0 },
  createdAt: "2026-10-27T00:00:00Z",
  updatedAt: "2026-10-27T00:00:00Z",
});

beforeEach(() => {
  brands.list.mockReset().mockResolvedValue({ items: [] });
  brands.detail.mockReset();
});

describe("HomepageBrandsEditor", () => {
  it("a move hands back the whole list in the new order", () => {
    const onChange = vi.fn();
    render(
      <HomepageBrandsEditor
        token="t"
        brands={[brand("a"), brand("b"), brand("c")]}
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(
      screen.getByRole("button", { name: /^Márka c áthelyezése/ }),
      { key: "ArrowUp" },
    );
    expect(onChange.mock.calls[0]?.[0].map((b: HomepageBrand) => b.id)).toEqual(
      ["a", "c", "b"],
    );
  });

  it("removes one; a switched-off brand keeps its place and says it is left out", () => {
    const onChange = vi.fn();
    render(
      <HomepageBrandsEditor
        token="t"
        brands={[brand("a"), brand("b", { shown: false, logoUrl: null })]}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByText(
        "Nincs logó: a neve látszik · Kikapcsolt márka: a sávban nem jelenik meg",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Márka a eltávolítása" }),
    );
    expect(onChange.mock.calls[0]?.[0].map((b: HomepageBrand) => b.id)).toEqual(
      ["b"],
    );
  });

  it("adds a searched brand with its logo from the detail; a listed brand is not offered again; no cap", async () => {
    const onChange = vi.fn();
    const many = Array.from({ length: 40 }, (_, i) => brand(`m${i}`));
    brands.list.mockResolvedValue({ items: [hit("m3"), hit("uj")] });
    brands.detail.mockResolvedValue({
      ...hit("uj"),
      logoUrl: "https://cdn.example.hu/uj.png",
    });
    render(
      <HomepageBrandsEditor token="t" brands={many} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Márka keresése a logósávhoz"), {
      target: { value: "ma" },
    });
    const offer = await screen.findByRole("button", { name: /^Márka uj/ });
    expect(
      screen.queryByRole("button", { name: /^Márka m3 7 termék/ }),
    ).toBeNull();
    expect(brands.list.mock.calls[0]?.[1].get("status")).toBe("ACTIVE");
    fireEvent.click(offer);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0]?.[0] as HomepageBrand[];
    expect(next.length).toBe(41);
    expect(next[40]).toEqual({
      id: "uj",
      name: "Márka uj",
      slug: "marka-uj",
      logoUrl: "https://cdn.example.hu/uj.png",
      shown: true,
    });
  });

  it("a never-set list says the shop keeps its names", () => {
    render(
      <HomepageBrandsEditor token="t" brands={null} onChange={() => {}} />,
    );
    expect(screen.getByText("Nincs kijelölt márka.")).toBeTruthy();
  });
});

describe("previewRecord: the logo strip", () => {
  const base = { texts: {}, slides: null, blocks: null, footer: null };
  it("sends no list while it was never set, and only the shown brands' slugs in order once it is", () => {
    expect("featured_brand_handles" in previewRecord(base)).toBe(false);
    expect(
      "featured_brand_handles" in previewRecord({ ...base, brands: null }),
    ).toBe(false);
    expect(
      previewRecord({
        ...base,
        brands: [brand("b"), brand("x", { shown: false }), brand("a")],
      }).featured_brand_handles,
    ).toEqual(["marka-b", "marka-a"]);
    expect(
      previewRecord({ ...base, brands: [] }).featured_brand_handles,
    ).toEqual([]);
  });
});
