import { cleanup, render, screen, within } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assetColumnsFor,
  ASSET_COLUMNS,
  ASSET_TABLE_MIN_WIDTH,
  ASSET_TABLE_MIN_WIDTH_WITHOUT_HIERARCHY,
  PilotAssetListPage,
} from "./pilot-asset-list-page";

/*
  AZ ESZKÖZLISTA ELRENDEZÉSE (Picasso 3.5, acrobot 61933). MI PIROSÍT: ha a Hierarchia oszlop akkor is áll, amikor az oldal minden
  sora önálló eszköz, vagy eltűnik, amikor van szülő vagy részegység; ha a szűrők két sorba törnek szét a Nyomtatás és az Excel
  miatt (azok külön csoportban, jobbra állnak); ha az oldalméret-választó visszakerül a szűrősorba; ha az eszközkód és a matricakód
  újra halvány kis betű.
*/
const state = vi.hoisted(() => ({ session: null as Session | null }));
const api = vi.hoisted(() => ({
  list: vi.fn(),
  categories: vi.fn(),
  units: vi.fn(),
}));

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: state.session }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/szerviz/eszkozok",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/api/assets", () => ({
  assetsApi: {
    list: (...args: unknown[]) => api.list(...args),
    exportXlsx: vi.fn(),
  },
}));
vi.mock("@/lib/api/asset-categories", () => ({
  assetCategoriesApi: { list: (...args: unknown[]) => api.categories(...args) },
}));
vi.mock("@/lib/api/suppliers", () => ({
  suppliersApi: { units: (...args: unknown[]) => api.units(...args) },
}));

type Row = Parameters<typeof assetColumnsFor>[0][number];

function row(over: Partial<Row> = {}): Row {
  return {
    id: "a1",
    name: "Kompresszor",
    assetNumber: "ESZK-2026-0001",
    partnerInternalCode: null,
    labelCode: "MAT-0042",
    owner: { type: "SUPPLIER", id: "s1", displayName: "Fánk Kft." },
    unit: null,
    address: null,
    category: "Levegőztetés",
    manufacturer: "Gyártó",
    model: "K-1",
    parent: null,
    childCount: 0,
    status: "ACTIVE",
    ...over,
  } as unknown as Row;
}

function listOf(items: Row[]) {
  return {
    items,
    pagination: {
      page: 1,
      pageSize: 25,
      totalItems: items.length,
      totalPages: 1,
    },
    counts: {},
  };
}

beforeEach(() => {
  state.session = {
    id: "s1",
    token: "t1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u1",
      email: "feri@example.invalid",
      displayName: "Feri",
      role: "ADMIN",
      customerId: null,
      supplierId: null,
    },
  };
  for (const fn of Object.values(api)) fn.mockReset();
  api.categories.mockResolvedValue({ items: [] });
  api.units.mockResolvedValue({ items: [] });
});
afterEach(() => cleanup());

describe("a Hierarchia oszlop csak akkor áll, ha van mit mondania", () => {
  it("every row standalone: the column is gone and the table minimum shrinks with it", () => {
    const columns = assetColumnsFor([row(), row({ id: "a2" })]);
    expect(columns.map((c) => c.id)).not.toContain("hierarchy");
    expect(columns).toHaveLength(ASSET_COLUMNS.length - 1);
    expect(ASSET_TABLE_MIN_WIDTH_WITHOUT_HIERARCHY).toBeLessThan(
      ASSET_TABLE_MIN_WIDTH,
    );
  });

  it("one part of something, or one with parts, brings the column back", () => {
    const part = row({
      id: "a2",
      parent: { id: "a1", name: "Rendszer" },
    } as Partial<Row>);
    const whole = row({ id: "a3", childCount: 2 } as Partial<Row>);
    expect(assetColumnsFor([row(), part]).map((c) => c.id)).toContain(
      "hierarchy",
    );
    expect(assetColumnsFor([row(), whole]).map((c) => c.id)).toContain(
      "hierarchy",
    );
  });

  it("an empty page keeps the whole column set", () => {
    expect(assetColumnsFor([])).toBe(ASSET_COLUMNS);
  });

  it("the page: no Hierarchia header and no Önálló eszköz text when all rows are standalone, both back with a child", async () => {
    api.list.mockResolvedValue(listOf([row(), row({ id: "a2" })]));
    const first = render(<PilotAssetListPage />);
    await screen.findAllByText("Kompresszor");
    expect(screen.queryByText("Hierarchia")).toBeNull();
    expect(screen.queryByText("Önálló eszköz")).toBeNull();
    first.unmount();

    api.list.mockResolvedValue(
      listOf([row(), row({ id: "a2", childCount: 2 } as Partial<Row>)]),
    );
    render(<PilotAssetListPage />);
    await screen.findAllByText("Kompresszor");
    expect(screen.getAllByText("Hierarchia").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Önálló eszköz").length).toBeGreaterThan(0);
  });
});

describe("a szűrők egy sorban, a Nyomtatás és az Excel jobbra, külön", () => {
  it("the search and the three filters share one bar; Nyomtatás and Excel are their own group on the right", async () => {
    api.list.mockResolvedValue(listOf([row()]));
    render(<PilotAssetListPage />);
    await screen.findAllByText("Kompresszor");
    const search = screen.getByLabelText("Eszköz keresése");
    const bar = search.closest("div.flex-wrap") as HTMLElement;
    expect(bar).not.toBeNull();
    for (const label of ["Eszköztípus", "Kategória", "Kézikönyv"])
      expect(bar.contains(screen.getByLabelText(label))).toBe(true);

    const output = within(bar).getByRole("group", { name: "Lista kimenete" });
    expect(
      within(output).getByRole("button", { name: "Nyomtatás" }),
    ).toBeTruthy();
    expect(within(output).getByRole("button", { name: "Excel" })).toBeTruthy();
    expect(output.className).toContain("sm:ml-auto");
    // the filters are not inside the output group
    expect(output.contains(search)).toBe(false);
  });

  it("the three filters have a fixed width that does not shrink, the search is capped (one row at 1440 px, measured on stage 2026-11-25)", async () => {
    api.list.mockResolvedValue(listOf([row()]));
    render(<PilotAssetListPage />);
    await screen.findAllByText("Kompresszor");
    for (const label of ["Eszköztípus", "Kategória", "Kézikönyv"]) {
      const wrapper = screen.getByLabelText(label).parentElement!;
      expect(wrapper.className).toContain("sm:w-[170px]");
      expect(wrapper.className).toContain("shrink-0");
    }
    const searchBox = screen.getByLabelText("Eszköz keresése").parentElement!;
    expect(searchBox.className).toContain("sm:max-w-[260px]");
  });

  it("the page size is no longer in the filter bar: it sits in the footer with the count", async () => {
    api.list.mockResolvedValue(listOf([row()]));
    render(<PilotAssetListPage />);
    await screen.findAllByText("Kompresszor");
    const bar = screen
      .getByLabelText("Eszköz keresése")
      .closest("div.flex-wrap") as HTMLElement;
    const pageSize = screen.getByLabelText("Hány eszköz egy oldalon");
    expect(bar.contains(pageSize)).toBe(false);
    const footer = screen.getByText("1 / 1 eszköz").parentElement!;
    expect(footer.contains(pageSize)).toBe(true);
  });
});

describe("az eszközkód és a matricakód olvasható", () => {
  it("both are 12 px and darker than the old pale 11 px", async () => {
    api.list.mockResolvedValue(listOf([row()]));
    render(<PilotAssetListPage />);
    const number = (await screen.findAllByText("ESZK-2026-0001"))[0]!;
    expect(number.className).toContain("text-xs");
    expect(number.className).not.toContain("text-[11px]");
    expect(number.className).not.toContain("text-pilot-grey-400");
    const label = screen.getAllByText("MAT-0042")[0]!;
    expect(label.parentElement!.className).toContain("text-xs");
    expect(label.parentElement!.className).not.toContain("text-pilot-grey-400");
    expect(label.parentElement!.className).not.toContain("text-[11px]");
  });
});

// Picasso R9 (acrobot 62497): the lists' one tab shape, the solid green pill; and the asset tabs are real tabs now
describe("the asset list's tabs", () => {
  it("are a tab list, one selected, filled green; the others plain", async () => {
    api.list.mockResolvedValue(listOf([row()]));
    render(<PilotAssetListPage />);
    await screen.findAllByText("Kompresszor");
    const list = screen.getByRole("tablist", { name: "Eszközök szűrése" });
    const tabs = within(list).getAllByRole("tab");
    const selected = tabs.filter(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveClass("bg-pilot-aqua-600", "text-white");
    for (const tab of tabs.filter((tab) => tab !== selected[0])) {
      expect(tab).not.toHaveClass("bg-pilot-aqua-600");
      expect(tab).not.toHaveClass("border-b-2");
    }
  });
});
