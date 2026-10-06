import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AssetListItem, Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssetListPrintPage } from "./asset-list-print-page";

/*
  AZ ESZKÖZLISTA NYOMTATÓBARÁT NÉZETE (kártya 323e9b38). MI PIROSÍT: a
  nézet nem a teljes szűrt halmazt kéri (lapozással, vagy más szűrőkkel); a
  fejlécből hiányzik a szűrők leírása vagy a darabszám; a sorok nem a közös
  sor; a lap nem nyomtat magától, vagy kétszer nyomtat; a hiba elveszik;
  jog nélkül is mutatna valamit.
*/
const state = vi.hoisted(() => ({
  session: null as Session | null,
  query: "status=IN_PLACE&search=lámpa&page=2&pageSize=50",
}));
const api = vi.hoisted(() => ({ exportItems: vi.fn(), categories: vi.fn() }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: state.session }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("@/lib/api/assets", () => ({
  assetsApi: { exportItems: (...args: unknown[]) => api.exportItems(...args) },
}));
vi.mock("@/lib/api/asset-categories", () => ({
  assetCategoriesApi: { list: (...args: unknown[]) => api.categories(...args) },
}));

const session = (role: string): Session => ({
  id: "s1",
  token: "t1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "u1",
    email: "feri@example.invalid",
    displayName: "Feri",
    role: role as Session["user"]["role"],
    customerId: null,
    supplierId: null,
  },
});

const asset = {
  id: "a1",
  assetNumber: "ESZ-0001",
  name: "LED lámpa",
  kind: "EQUIPMENT",
  status: "ACTIVE",
  criticality: "NORMAL",
  owner: {
    type: "CUSTOMER",
    id: "c1",
    code: "V1",
    displayName: "Fővárosi Állatkert",
  },
  address: { id: "ad1", formatted: "1146 Budapest, Állatkerti krt. 6-12." },
  unit: {
    id: "un1",
    code: "BIO",
    name: "Biodóm",
    path: ["Állatkert", "Biodóm"],
  },
  category: "Világítás",
  manufacturer: "Astral Pool",
  model: "LumiPlus",
  labelCode: "ACR-000123",
  childCount: 0,
} as unknown as AssetListItem;

let print: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state.session = session("SERVICE");
  state.query = "status=IN_PLACE&search=lámpa&page=2&pageSize=50";
  api.exportItems.mockReset().mockResolvedValue({ items: [asset] });
  api.categories.mockReset().mockResolvedValue({ items: [] });
  print = vi.fn();
  Object.defineProperty(window, "print", { value: print, configurable: true });
});
afterEach(() => cleanup());

describe("AssetListPrintPage", () => {
  it("asks for the whole filtered set, and prints a header with the filters, the count and the rows", async () => {
    render(<AssetListPrintPage />);
    const table = await screen.findByRole("table");
    const query = api.exportItems.mock.calls[0]![1] as URLSearchParams;
    expect(query.get("search")).toBe("lámpa");
    expect(query.get("status")).toBe("IN_PLACE");
    expect(query.has("page")).toBe(false);
    expect(query.has("pageSize")).toBe(false);
    const filters = screen.getByTestId("asset-print-filters");
    expect(filters.textContent).toContain("Állapot: Beépített");
    expect(filters.textContent).toContain("Keresés: „lámpa”");
    expect(screen.getByTestId("asset-print-count").textContent).toBe(
      "1 eszköz",
    );
    expect(screen.getByText(/Nyomtatva:/)).toBeTruthy();
    const cells = within(table)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(cells).toContain("ACR-000123");
    expect(cells).toContain("Állatkert / Biodóm (BIO)");
    expect(cells).toContain("1146 Budapest, Állatkerti krt. 6-12.");
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it("the page is set to A4 landscape for print, and the buttons do not print", async () => {
    const { container } = render(<AssetListPrintPage />);
    await screen.findByRole("table");
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toMatch(/@page\s*\{\s*size:\s*A4 landscape/);
    expect(css).toMatch(/\.asset-print-actions\s*\{\s*display:\s*none/);
  });

  it("a refusal (too many to print) is shown, and nothing prints", async () => {
    api.exportItems.mockRejectedValue(
      new Error("A szűrés több mint 5000 eszközt hoz. Szűkítsd a listát."),
    );
    render(<AssetListPrintPage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Szűkítsd/);
    expect(print).not.toHaveBeenCalled();
  });

  it("without service.view it asks nothing and shows no list", async () => {
    state.session = session("SALES");
    render(<AssetListPrintPage />);
    expect(screen.getByText(/nincs jogod/)).toBeTruthy();
    expect(api.exportItems).not.toHaveBeenCalled();
  });
});
