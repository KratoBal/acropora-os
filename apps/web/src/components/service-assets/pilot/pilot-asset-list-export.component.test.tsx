import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotAssetListPage } from "./pilot-asset-list-page";

/*
  A NYOMTATÁS ÉS AZ EXCEL GOMBJA A LISTÁN (kártya 323e9b38). MI PIROSÍT: a
  gomb csak a látható oldalt kéri (marad a lapozás), más szűrőkkel kér, mint a
  lista, vagy a letöltés hibája elveszik.
*/
const state = vi.hoisted(() => ({
  session: null as Session | null,
  query: "status=ACTIVE&search=lámpa&page=3&pageSize=50&departmentIds=u1",
}));
const api = vi.hoisted(() => ({
  list: vi.fn(),
  exportXlsx: vi.fn(),
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
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("@/lib/api/assets", () => ({
  assetsApi: {
    list: (...args: unknown[]) => api.list(...args),
    exportXlsx: (...args: unknown[]) => api.exportXlsx(...args),
  },
}));
vi.mock("@/lib/api/asset-categories", () => ({
  assetCategoriesApi: { list: (...args: unknown[]) => api.categories(...args) },
}));
vi.mock("@/lib/api/suppliers", () => ({
  suppliersApi: { units: (...args: unknown[]) => api.units(...args) },
}));

beforeEach(() => {
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
    items: [],
    pagination: { page: 3, pageSize: 50, totalItems: 0, totalPages: 1 },
    counts: {},
  });
  api.categories.mockResolvedValue({ items: [] });
  api.units.mockResolvedValue({ items: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PilotAssetListPage print and Excel", () => {
  it("Excel downloads the whole filtered set: the list's filters, without the paging", async () => {
    api.exportXlsx.mockResolvedValue({
      blob: new Blob(["x"]),
      fileName: "eszkozlista-2026-10-06.xlsx",
    });
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:x"),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    render(<PilotAssetListPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Excel" }));
    await waitFor(() => expect(api.exportXlsx).toHaveBeenCalledTimes(1));
    const [token, query] = api.exportXlsx.mock.calls[0] as [
      string,
      URLSearchParams,
    ];
    expect(token).toBe("t1");
    expect(query.get("status")).toBe("ACTIVE");
    expect(query.get("search")).toBe("lámpa");
    expect(query.get("departmentIds")).toBe("u1");
    expect(query.has("page")).toBe(false);
    expect(query.has("pageSize")).toBe(false);
  });

  it("Nyomtatás opens the print view with the same query", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<PilotAssetListPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Nyomtatás" }));
    const url = new URL(String(open.mock.calls[0]![0]), "http://localhost");
    expect(url.pathname).toBe("/nyomtatas/eszkozok");
    expect(url.searchParams.get("search")).toBe("lámpa");
    expect(url.searchParams.get("departmentIds")).toBe("u1");
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("a refused Excel shows the server's sentence", async () => {
    api.exportXlsx.mockRejectedValue(
      new Error("A szűrés több mint 5000 eszközt hoz. Szűkítsd a listát."),
    );
    render(<PilotAssetListPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Excel" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Szűkítsd/);
  });
});
