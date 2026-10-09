import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  bulkShippingProfiles: vi.fn(),
  categoryOptions: vi.fn(),
  brandOptions: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

// a lap a Direction F óta `PilotThemeRoot` alatt áll (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
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
    customerId: null,
    supplierId: null,
  },
};

// Mirrors what ProductionAuthAdapter actually returns in production: a
// valid, cookie-authenticated session with no client-readable token at
// all (see apps/web/src/lib/auth/production-auth.ts).
const cookieSession: Session = {
  id: "session-cookie",
  token: undefined,
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

const populatedResponse: ProductListResponse = {
  items: [
    {
      id: "product-1",
      name: "Red Sea ReefMat 500",
      productType: "PHYSICAL",
      origin: "UNAS",
      catalogAuthority: "UNAS",
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
      grossPrice: "24900",
      priceSource: "unas" as const,
      saleGrossPrice: "19900",
      stockOnHand: "12",
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
    expect(screen.getByText("UNAS-termék")).toBeInTheDocument();
    expect(
      screen.getByRole("table").querySelector("tbody")?.textContent,
    ).toContain("Aktív");
    expect(screen.getByText(/24.900\s?Ft/)).toBeInTheDocument();
    expect(screen.getByText(/19.900\s?Ft/)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ReefMat 500" })).toHaveAttribute(
      "src",
      "https://example.test/reefmat.jpg",
    );
  });

  it("a helyi terméket külön Acropora OS badge-dzsel jelöli", async () => {
    api.list.mockResolvedValue({
      ...populatedResponse,
      items: [
        {
          ...populatedResponse.items[0]!,
          origin: "LOCAL",
          catalogAuthority: "ACROPORA",
        },
      ],
    });

    render(createElement(ProductListPage));

    expect(
      await screen.findByText("Helyi Acropora OS-termék"),
    ).toBeInTheDocument();
  });

  /*
    A KÉP NÉLKÜLI SOR (Balázs briefje, 2026-09-30, 4. pont): nem mindenhol
    ugyanaz a csomag-ikon, hanem kategória-ikon, márka-monogram, és csak a
    végén a generikus. MI PIROSÍT: ha a kategória útját nem olvassa (a márka-
    levél "Fauna Marin" egyedül nem mond csoportot), ha a monogram a kategória
    elé kerül, vagy ha a kategória nevéből márkát gyárt.
  */
  it("a kép nélküli sor a kategória ikonját, a márka monogramját vagy a generikusat kapja, ebben a sorrendben", async () => {
    const base = populatedResponse.items[0]!;
    api.list.mockResolvedValue({
      ...populatedResponse,
      items: [
        {
          ...base,
          id: "p-icon",
          name: "Fauna Marin Balling Light",
          thumbnail: null,
          brand: { id: "brand-1", name: "Red Sea" },
          primaryCategory: {
            id: "c-fm",
            name: "Fauna Marin",
            isPrimary: true,
            sortOrder: 0,
            path: ["Termékek", "Nyomelemek", "Fauna Marin"],
          },
        },
        {
          ...base,
          id: "p-mono",
          name: "Red Sea ReefDose 4",
          thumbnail: null,
          brand: { id: "brand-1", name: "Red Sea" },
          primaryCategory: {
            id: "c-root",
            name: "Termékek",
            isPrimary: true,
            sortOrder: 0,
            path: ["Termékek"],
          },
        },
        {
          ...base,
          id: "p-generic",
          name: "Maxspect tartó",
          thumbnail: null,
          brand: null,
          primaryCategory: {
            id: "c-mx",
            name: "Maxspect",
            isPrimary: true,
            sortOrder: 0,
            path: ["Termékek", "Maxspect"],
          },
        },
      ],
    });

    render(createElement(ProductListPage));
    await screen.findByText("Fauna Marin Balling Light");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const kinds = rows.map(
      (row) =>
        row
          .querySelector("[data-thumbnail-fallback]")
          ?.getAttribute("data-thumbnail-fallback") ?? "image",
    );
    expect(kinds).toEqual(["icon", "monogram", "generic"]);
    expect(rows[1]).toHaveTextContent("RS");
    // a márkanevű kategóriából nem lesz monogram
    expect(rows[2]).not.toHaveTextContent(/\bMS\b/);
  });

  // stage, 2026-09-30 (acrobot): egy nem betöltődő kép üres négyzet maradt
  // volna. MI PIROSÍT: ha a hibás kép nem esik vissza a kategória-tartalékra.
  it("a nem betöltődő kép a kategória-tartalékra esik vissza, nem marad üres négyzet", async () => {
    const base = populatedResponse.items[0]!;
    api.list.mockResolvedValue({
      ...populatedResponse,
      items: [
        {
          ...base,
          primaryCategory: {
            id: "c-fish",
            name: "Gébek",
            isPrimary: true,
            sortOrder: 0,
            path: ["Halak", "Gébek"],
          },
        },
      ],
    });
    render(createElement(ProductListPage));
    const image = await screen.findByRole("img", { name: "ReefMat 500" });
    const row = image.closest("tr") as HTMLElement;
    expect(row.querySelector("[data-thumbnail-fallback]")).toBeNull();

    fireEvent.error(image);

    expect(screen.queryByRole("img", { name: "ReefMat 500" })).toBeNull();
    expect(
      row
        .querySelector("[data-thumbnail-fallback]")
        ?.getAttribute("data-thumbnail-fallback"),
    ).toBe("icon");
  });

  it("a fejléc és a sor ugyanabból az oszlopból igazodik: a számoszlop mindkettőben jobbra zár", async () => {
    api.list.mockResolvedValue(populatedResponse);
    render(createElement(ProductListPage));
    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const cells = within(within(table).getAllByRole("row")[1]!).getAllByRole(
      "cell",
    );
    // a82ed229: a kijelölő oszlop (products.manage joggal) és a Szállítás
    expect(headers.map((header) => header.textContent)).toEqual([
      "",
      "Termék",
      "SKU",
      "Bruttó ár",
      "Akciós ár",
      "Készlet",
      "Állapot",
      "Szállítás",
      "Művelet",
    ]);
    const right = (element: HTMLElement) =>
      element.className.split(" ").includes("text-right");
    expect(headers.map(right)).toEqual(cells.map(right));
    expect(headers.map(right)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
    ]);
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

    fireEvent.click(
      within(
        await screen.findByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő" }),
    );
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

  it("cookie-alapú production session esetén (token: undefined) is elindulnak a lekérések, nem ragad be loading állapotban", async () => {
    auth.session = cookieSession;
    api.list.mockResolvedValue(populatedResponse);

    render(createElement(ProductListPage));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ page: 1 }),
    );
    expect(api.categoryOptions).toHaveBeenCalledWith("");
    expect(api.brandOptions).toHaveBeenCalledWith("");
  });

  /*
    A SZÁLLÍTÁS A LISTÁN (a82ed229). MI PIROSÍT: a szűrő nem jut el az API-ig; az
    oszlop nem mondja meg a kézi eltérést, vagy a sor nélküli terméket korlátozás
    nélkülinek mutatja; a tömeges sáv rossz kérést küld, vagy nem tölti újra a listát.
  */
  describe("szállítás", () => {
    const szallitassal = (
      shipping: ProductListResponse["items"][number]["shipping"],
    ): ProductListResponse => ({
      ...populatedResponse,
      items: [{ ...populatedResponse.items[0]!, shipping }],
    });

    it("a szűrő az URL-ből az API-ig jut, és a választás az URL-be kerül", async () => {
      setUrl("shipping=HEAVY&shippingDiffers=true");
      api.list.mockResolvedValue(szallitassal(null));
      render(createElement(ProductListPage));
      await screen.findByRole("table");
      expect(api.list.mock.calls[0]?.[1]).toMatchObject({
        shipping: "HEAVY",
        shippingUnasDiffers: true,
      });
      fireEvent.change(screen.getByLabelText("Szállítás"), {
        target: { value: "FOXPOST_FORBIDDEN" },
      });
      expect(navigation.replace.mock.calls.at(-1)?.[0]).toContain(
        "shipping=FOXPOST_FORBIDDEN",
      );
    });

    it("az oszlop a jelzőt és az eltérést mondja; sor nélkül „Nincs kitöltve”", async () => {
      api.list.mockResolvedValue(
        szallitassal({
          pickupOnly: false,
          foxpostForbidden: false,
          isHeavy: true,
          isFrozen: false,
          lockerUnsuitable: false,
          hasManual: true,
          unasDiffers: true,
        }),
      );
      const { unmount } = render(createElement(ProductListPage));
      const sor = within(await screen.findByRole("table")).getAllByRole(
        "row",
      )[1]!;
      expect(sor.textContent).toContain("Nehéz áru");
      expect(sor.textContent).toContain("Eltér a UNAS-tól");
      unmount();
      api.list.mockResolvedValue(szallitassal(null));
      render(createElement(ProductListPage));
      const ujra = within(await screen.findByRole("table")).getAllByRole(
        "row",
      )[1]!;
      expect(ujra.textContent).toContain("Nincs kitöltve");
    });

    it("a kijelölt sorra a tömeges sáv a megnevezett jelzőt kéri, és újratölti a listát", async () => {
      api.list.mockResolvedValue(szallitassal(null));
      api.bulkShippingProfiles.mockResolvedValue({
        updated: 0,
        created: 1,
        missing: [],
      });
      render(createElement(ProductListPage));
      await screen.findByRole("table");
      fireEvent.click(screen.getByLabelText("Red Sea ReefMat 500 kijelölése"));
      const sav = screen.getByRole("region", {
        name: "Tömeges szállítási szerkesztés",
      });
      fireEvent.change(within(sav).getByLabelText("Szállítási művelet"), {
        target: { value: "be:lockerUnsuitable" },
      });
      fireEvent.click(
        within(sav).getByRole("button", { name: "Alkalmaz (1)" }),
      );
      await waitFor(() =>
        expect(api.bulkShippingProfiles).toHaveBeenCalledWith("token-owner", {
          productIds: ["product-1"],
          set: { lockerUnsuitable: true },
        }),
      );
      await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    });
  });
});
