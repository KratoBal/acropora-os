import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ProductListResponse, Session } from "@acropora/types";
import { createElement, useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductListPage } from "./product-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  categoryOptions: vi.fn(),
  brandOptions: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/products",
  useRouter: () => navigation,
  useSearchParams: () =>
    useSyncExternalStore(
      (listener) => {
        navigation.listeners.add(listener);
        return () => navigation.listeners.delete(listener);
      },
      () => navigation.params,
      () => navigation.params,
    ),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api/products", () => ({ productApi: api }));

const ownerSession: Session = {
  id: "session-owner",
  token: "token-owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
  },
};

const populatedResponse: ProductListResponse = {
  items: [
    {
      id: "product-1",
      name: "Red Sea ReefMat 500",
      productType: "PHYSICAL",
      isActive: true,
      archivedAt: null,
      primarySku: "RS-RM500",
      brand: { id: "brand-1", name: "Red Sea" },
      primaryCategory: {
        id: "category-1",
        name: "Szűréstechnika",
        isPrimary: true,
        sortOrder: 0,
      },
      thumbnail: {
        id: "image-1",
        url: "https://example.test/reefmat.jpg",
        sortOrder: 0,
        altText: "ReefMat 500",
        title: null,
      },
      unasListing: {
        channel: "UNAS",
        externalStatus: "3",
        isPublished: true,
        slug: "reefmat-500",
        productUrl: null,
        seoTitle: null,
        backorderAllowed: false,
      },
    },
  ],
  pagination: {
    page: 1,
    pageSize: 25,
    totalItems: 51,
    totalPages: 3,
  },
};

function emptyResponse(page = 1): ProductListResponse {
  return {
    items: [],
    pagination: { page, pageSize: 25, totalItems: 0, totalPages: 0 },
  };
}

function setUrl(query = "") {
  navigation.params = new URLSearchParams(query);
  navigation.listeners.forEach((listener) => listener());
}

beforeEach(() => {
  auth.session = ownerSession;
  navigation.params = new URLSearchParams();
  navigation.listeners.clear();
  navigation.replace.mockReset();
  navigation.push.mockReset();
  navigation.replace.mockImplementation((url) => {
    setUrl(url.split("?")[1] ?? "");
  });
  api.list.mockReset();
  api.categoryOptions
    .mockReset()
    .mockResolvedValue([
      { id: "category-1", label: "Technika / Szűréstechnika" },
    ]);
  api.brandOptions
    .mockReset()
    .mockResolvedValue([{ id: "brand-1", label: "Red Sea" }]);
});

describe("ProductListPage", () => {
  it("kezdetben skeleton loading állapotot jelenít meg", () => {
    api.list.mockReturnValue(new Promise(() => undefined));

    render(createElement(ProductListPage));

    expect(screen.getByLabelText("Terméklista betöltése")).toBeInTheDocument();
  });

  it("megjeleníti a betöltött terméklista fő táblázatmezőit", async () => {
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Red Sea ReefMat 500")).toBeInTheDocument();
    expect(screen.getByText("RS-RM500")).toBeInTheDocument();
    expect(
      screen.getByRole("table").querySelector("tbody")?.textContent,
    ).toContain("Red Sea");
    expect(screen.getByText("Szűréstechnika")).toBeInTheDocument();
    expect(
      screen.getByRole("table").querySelector("tbody")?.textContent,
    ).toContain("Aktív");
    expect(screen.getByText("UNAS · kód: 3")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ReefMat 500" })).toHaveAttribute(
      "src",
      "https://example.test/reefmat.jpg",
    );
  });

  it("üres katalógus állapotot jelenít meg", async () => {
    api.list.mockResolvedValue(emptyResponse());

    render(createElement(ProductListPage));

    expect(await screen.findByText("A katalógus még üres")).toBeInTheDocument();
  });

  it("szűrés után nincs találat állapotot ad és törli a szűrőket", async () => {
    navigation.params = new URLSearchParams("q=nincs&page=4");
    api.list.mockResolvedValue(emptyResponse());

    render(createElement(ProductListPage));

    expect(await screen.findByText("Nincs találat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Szűrők törlése" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/products", {
      scroll: false,
    });
  });

  it("API-hibát jelenít meg és retry-ra új lekérést indít", async () => {
    api.list
      .mockRejectedValueOnce(new Error("A katalógus API nem elérhető."))
      .mockResolvedValueOnce(populatedResponse);

    render(createElement(ProductListPage));

    expect(
      await screen.findByText("A terméklista nem tölthető be"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Újrapróbálás" }));
    expect(await screen.findByText("Red Sea ReefMat 500")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("lapozáskor frissíti az URL-t", async () => {
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    fireEvent.click(await screen.findByRole("button", { name: "Következő" }));
    expect(navigation.replace).toHaveBeenCalledWith("/products?page=2", {
      scroll: false,
    });
  });

  it.each([
    ["Aktivitási állapot", "active", "active=true"],
    ["Kategória", "category-1", "categoryId=category-1"],
    ["Márka", "brand-1", "brandId=brand-1"],
  ])(
    "a(z) %s szűrő változásakor page=1-re áll",
    async (label, value, query) => {
      navigation.params = new URLSearchParams("page=3");
      api.list.mockResolvedValue({
        ...populatedResponse,
        pagination: { ...populatedResponse.pagination, page: 3 },
      });

      render(createElement(ProductListPage));
      const select = await screen.findByRole("combobox", { name: label });
      if (label !== "Aktivitási állapot") {
        await waitFor(() => expect(select).toContainHTML(`value=\"${value}\"`));
      }
      fireEvent.change(select, { target: { value } });

      expect(navigation.replace).toHaveBeenLastCalledWith(
        `/products?${query}`,
        { scroll: false },
      );
    },
  );

  it("a keresést debounce után adja át a tipizált API-rétegnek", async () => {
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(api.list).toHaveBeenCalledTimes(1);
    await waitFor(
      () =>
        expect(api.list).toHaveBeenLastCalledWith(
          "token-owner",
          expect.objectContaining({ search: "reef", page: 1 }),
        ),
      { timeout: 1_000 },
    );
  });

  it("termékre kattintva megőrzi a szűrt lista URL-jét returnTo paraméterként", async () => {
    navigation.params = new URLSearchParams("q=reef&page=3");
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    expect(navigation.push).toHaveBeenCalledWith(
      `/products/product-1?returnTo=${encodeURIComponent("q=reef&page=3")}`,
    );
  });

  it("a Részletek gomb is átadja a returnTo paramétert és nem lapoz újra a sorra", async () => {
    navigation.params = new URLSearchParams("categoryId=category-1");
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    fireEvent.click(await screen.findByRole("button", { name: "Részletek" }));

    expect(navigation.push).toHaveBeenCalledWith(
      `/products/product-1?returnTo=${encodeURIComponent("categoryId=category-1")}`,
    );
  });

  it("szűrők nélkül nem ad hozzá returnTo paramétert", async () => {
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    expect(navigation.push).toHaveBeenCalledWith("/products/product-1");
  });

  it("products.view jogosultság nélkül megtagadja a hozzáférést", () => {
    auth.session = null;

    render(createElement(ProductListPage));

    expect(
      screen.getByText("Nincs hozzáférésed a termékkatalógushoz"),
    ).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });
});
