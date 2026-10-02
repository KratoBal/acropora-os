import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ProductQualityQueuePage, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JevCatalogQualityPage } from "./jev-catalog-quality-page";
import { catalogQueueState, queueRowHref } from "./jev-catalog-quality";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const api = vi.hoisted(() => ({ qualityQueue: vi.fn() }));

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/products", () => ({ productApi: api }));

function session(
  role: Session["user"]["role"],
  navigation?: Session["navigation"],
): Session {
  return {
    id: "s",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u",
      email: "teszt@example.invalid",
      displayName: "Teszt Kolléga",
      nickname: null,
      role,
      customerId: null,
      supplierId: null,
    },
    ...(navigation ? { navigation } : {}),
  };
}

/** The menu as a server serves it to a pilot user with the switch on. */
const SERVED: Session["navigation"] = [
  { id: "products", surfaces: ["web", "mobile"] },
  { id: "product-data-quality", surfaces: ["web"] },
];

const SUMMARY = {
  all: 2,
  critical: 1,
  conflict: 1,
  missing: 1,
  suggestion: 0,
  verified: 0,
};

/** Invented rows only. */
function page(
  over: Partial<ProductQualityQueuePage> = {},
): ProductQualityQueuePage {
  return {
    availability: "review",
    filter: "all",
    rows: [
      {
        productId: "p-1",
        productName: "Kitalált pumpa",
        field: "flowRate",
        tier: "C",
        status: "CONFLICTING_SOURCES",
        lastCheckedAt: "2026-10-02T21:00:00.000Z",
      },
      {
        productId: "p-2",
        productName: "Kitalált adalék",
        field: "ean",
        tier: "C",
        status: "MISSING",
        lastCheckedAt: "2026-10-02T21:00:00.000Z",
      },
    ],
    nextCursor: null,
    summary: SUMMARY,
    checkedProducts: 2,
    ...over,
  };
}

beforeEach(() => {
  api.qualityQueue.mockReset();
});

// MI PIROSÍT: ha a kikapcsolt vagy próba-listán kívüli felhasználónál kérés
// menne ki, vagy nyugodt üres állapotot mondana; ha a hiba üres táblának
// látszana; ha a szűrő nem a szerverhez menne; ha az indítás vagy az export
// engedélyezett lenne; ha jog nélkül is megnyílna.
describe("JevCatalogQualityPage", () => {
  it("a menüben nem kiszolgált kapcsoló: nem kér semmit, és nem elérhetőt mond", async () => {
    auth.session = session("OWNER");
    render(<JevCatalogQualityPage />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "A katalógus adatminőség-ellenőrzése jelenleg nem elérhető.",
    );
    expect(api.qualityQueue).not.toHaveBeenCalled();
  });

  it("a szerver off-ot mond (nincs a próba-listán): nem elérhető", async () => {
    auth.session = session("OWNER", SERVED);
    api.qualityQueue.mockResolvedValue(
      page({ availability: "off", rows: [], checkedProducts: 0 }),
    );
    render(<JevCatalogQualityPage />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "jelenleg nem elérhető",
    );
  });

  it("tárolt ellenőrzés nélkül ezt mondja ki, nem azt, hogy minden rendben", async () => {
    auth.session = session("VIEWER", SERVED);
    api.qualityQueue.mockResolvedValue(
      page({ rows: [], checkedProducts: 0, summary: { ...SUMMARY, all: 0 } }),
    );
    render(<JevCatalogQualityPage />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "nincs tárolt JEV ellenőrzés",
    );
    expect(
      screen.queryByText("Nem találtunk ellenőrzést igénylő termékadatot."),
    ).not.toBeInTheDocument();
  });

  it("a sorok a tárolt ellenőrzésből; az ütközés a mező nézetére, a többi az ellenőrzésre visz", async () => {
    auth.session = session("OWNER", SERVED);
    api.qualityQueue.mockResolvedValue(page());
    render(<JevCatalogQualityPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Kitalált pumpa")).toBeInTheDocument();
    const links = within(table)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "/products/p-1/adatellenorzes/flowRate",
      "/products/p-2/adatellenorzes",
    ]);
    expect(api.qualityQueue).toHaveBeenCalledWith("token-1", "all", null);
  });

  it("a szűrő a szerverhez megy", async () => {
    auth.session = session("OWNER", SERVED);
    api.qualityQueue.mockResolvedValue(page());
    render(<JevCatalogQualityPage />);
    await screen.findByRole("table");
    api.qualityQueue.mockResolvedValue(page({ filter: "conflict", rows: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Ütközés" }));
    await waitFor(() =>
      expect(api.qualityQueue).toHaveBeenLastCalledWith(
        "token-1",
        "conflict",
        null,
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Ebben a szűrőben nincs tétel.",
    );
  });

  it("a kérés hibája riasztás szövegben, nem üres tábla", async () => {
    auth.session = session("OWNER", SERVED);
    api.qualityQueue.mockRejectedValue(new Error("nem érhető el"));
    render(<JevCatalogQualityPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Az adatok jelenleg nem frissíthetők.",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("a következő lapot a kapott kurzorral kéri, és hozzáfűzi", async () => {
    auth.session = session("OWNER", SERVED);
    api.qualityQueue.mockResolvedValueOnce(page({ nextCursor: "c-2" }));
    render(<JevCatalogQualityPage />);
    await screen.findByRole("table");
    api.qualityQueue.mockResolvedValueOnce(
      page({
        rows: [
          {
            ...page().rows[1]!,
            productId: "p-3",
            productName: "Kitalált harmadik",
          },
        ],
        nextCursor: null,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Továbbiak betöltése" }),
    );
    expect(await screen.findByText("Kitalált harmadik")).toBeInTheDocument();
    expect(api.qualityQueue).toHaveBeenLastCalledWith("token-1", "all", "c-2");
    expect(screen.getByText("Kitalált pumpa")).toBeInTheDocument();
  });

  it("az indítás és az export letiltva, az okuk szövegben", async () => {
    auth.session = session("OWNER", SERVED);
    api.qualityQueue.mockResolvedValue(page());
    render(<JevCatalogQualityPage />);
    await screen.findByRole("table");
    expect(
      screen.getByRole("button", { name: "Új ellenőrzés indítása" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Az ellenőrzést egyelőre kézzel, a szerveren indítjuk."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("products.view nélkül nem nyílik meg, és nem kér semmit", () => {
    auth.session = session("SERVICE", SERVED);
    render(<JevCatalogQualityPage />);
    expect(
      screen.getByText("Nincs hozzáférésed a termékekhez"),
    ).toBeInTheDocument();
    expect(api.qualityQueue).not.toHaveBeenCalled();
  });

  it("az állapot és a sor-hivatkozás szabálya", () => {
    const on = new Set(["jev-product-enrichment"] as const);
    expect(catalogQueueState(new Set())).toBe("unavailable");
    expect(catalogQueueState(on, { kind: "loading" })).toBe("loading");
    expect(catalogQueueState(on, { kind: "error" })).toBe("error");
    expect(catalogQueueState(on, { kind: "ready", page: page() })).toBe("rows");
    expect(queueRowHref(page().rows[1]!)).toBe("/products/p-2/adatellenorzes");
  });
});
