import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotAssetListPage } from "./pilot-asset-list-page";

/*
  A LISTA RENDEZÉSE AZ OSZLOPFEJEN (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha az Eszköz, a Partner vagy a Státusz fejléce nem a
  saját szerver-mezőjét írja az URL-be (név, elhelyezés, állapot); ha a ciklus (növekvő, csökkenő, alap) elakad; ha a rendezés nem
  nullázza a lapot, vagy elveszíti a szűrőt; ha az URL rendezése nem jut a kérésbe, vagy egy ismeretlen mező igen; ha egy másik oszlop
  (kategória, alegység, hierarchia, gyártó) rendezhetőnek látszik.
*/
const state = vi.hoisted(() => ({
  session: null as Session | null,
  query: "",
}));
const api = vi.hoisted(() => ({
  list: vi.fn(),
  categories: vi.fn(),
  units: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: state.session }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: api.replace }),
  usePathname: () => "/szerviz/eszkozok",
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("@/lib/api/assets", () => ({
  assetsApi: { list: (...args: unknown[]) => api.list(...args) },
}));
vi.mock("@/lib/api/asset-categories", () => ({
  assetCategoriesApi: { list: (...args: unknown[]) => api.categories(...args) },
}));
vi.mock("@/lib/api/suppliers", () => ({
  suppliersApi: { units: (...args: unknown[]) => api.units(...args) },
}));

const item = {
  id: "asset-1",
  name: "Lámpa",
  assetNumber: "ESZK-1",
  owner: { displayName: "Biodóm Kft." },
  status: "ACTIVE",
};

beforeEach(() => {
  state.query = "";
  state.session = {
    id: "s1",
    token: "t1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u1",
      email: "feri@example.invalid",
      displayName: "Feri",
      role: "SERVICE",
      customerId: null,
      supplierId: null,
    },
  };
  for (const fn of Object.values(api)) fn.mockReset();
  api.list.mockResolvedValue({
    items: [item],
    pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    counts: {},
  });
  api.categories.mockResolvedValue({ items: [] });
  api.units.mockResolvedValue({ items: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const lastReplace = () =>
  new URL(api.replace.mock.calls.at(-1)![0] as string, "http://x").searchParams;

describe("PilotAssetListPage sorting", () => {
  it("each sortable header writes its own server field, ascending first, drops the page and keeps the filter", async () => {
    state.query = "status=ACTIVE&page=3";
    render(<PilotAssetListPage />);
    await screen.findAllByTestId("asset-row");
    for (const [name, field] of [
      ["Eszköz", "name"],
      ["Partner", "placement"],
      ["Státusz", "status"],
    ] as const) {
      api.replace.mockReset();
      fireEvent.click(screen.getByRole("button", { name }));
      const url = lastReplace();
      expect(url.get("sort"), name).toBe(field);
      expect(url.get("direction"), name).toBe("asc");
      expect(url.has("page"), name).toBe(false);
      expect(url.get("status"), name).toBe("ACTIVE");
    }
  });

  it("the second click is descending, the third clears the sort", async () => {
    state.query = "sort=status&direction=asc";
    const { unmount } = render(<PilotAssetListPage />);
    await screen.findAllByTestId("asset-row");
    fireEvent.click(screen.getByRole("button", { name: "Státusz" }));
    expect(lastReplace().get("direction")).toBe("desc");
    unmount();

    state.query = "sort=status&direction=desc";
    render(<PilotAssetListPage />);
    await screen.findAllByTestId("asset-row");
    fireEvent.click(screen.getByRole("button", { name: "Státusz" }));
    expect(lastReplace().has("sort")).toBe(false);
    expect(lastReplace().has("direction")).toBe(false);
  });

  it("the URL's sort reaches the request, an unknown one does not", async () => {
    state.query = "sort=placement&direction=desc";
    render(<PilotAssetListPage />);
    await screen.findAllByTestId("asset-row");
    const sent = api.list.mock.calls.at(-1)![1] as URLSearchParams;
    expect(sent.get("sort")).toBe("placement");
    expect(sent.get("direction")).toBe("desc");
    cleanup();

    api.list.mockClear();
    state.query = "sort=category&direction=asc";
    render(<PilotAssetListPage />);
    await screen.findAllByTestId("asset-row");
    const unknown = api.list.mock.calls.at(-1)![1] as URLSearchParams;
    expect(unknown.has("sort")).toBe(false);
    expect(unknown.has("direction")).toBe(false);
  });

  it("only the asset, the partner and the status columns have a sort button", async () => {
    render(<PilotAssetListPage />);
    const table = await screen.findByRole("table");
    const sortable = within(table)
      .getAllByRole("columnheader")
      .filter((header) => within(header).queryByRole("button"))
      .map((header) => header.textContent?.replace(/[⇅↑↓]/g, ""));
    expect(sortable).toEqual(["Eszköz", "Partner", "Státusz"]);
  });
});
