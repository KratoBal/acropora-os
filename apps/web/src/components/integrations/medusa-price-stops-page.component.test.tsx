import { render, screen } from "@testing-library/react";
import {
  hasPermission,
  PERMISSIONS,
  USER_ROLES,
  type MedusaPriceStopsView,
  type MedusaPriceStopView,
  type Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { MedusaPriceStopsPage } from "./medusa-price-stops-page";
import {
  PRICE_STOP_KIND_HINTS,
  PRICE_STOP_KIND_LABELS,
  priceStopKindHint,
  priceStopKindLabel,
} from "./medusa-price-stop-labels";

/*
  AZ ÁR-MEGÁLLÁSOK LAPJA (task t-20261117-arstop-web). WHAT TURNS IT RED: a stop's SKU, name or problem missing; a person's data state shown in the
  same tone as a run failure; an unknown kind hidden or given an invented text; a product that is gone dropped from the table; the empty, loading,
  error, cut or no-permission state wrong; the API asked without the right; a known kind without its Hungarian label.
*/
const api = vi.hoisted(() => ({ get: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/medusa-price-stops", () => ({ medusaPriceStopsApi: api }));

const session = (role: Session["user"]["role"]): Session => ({
  id: `session-${role}`,
  token: `token-${role}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: role,
    email: `${role.toLowerCase()}@acropora.local`,
    displayName: role,
    role,
    customerId: null,
    supplierId: null,
  },
});

const stop = (
  over: Partial<MedusaPriceStopView> = {},
): MedusaPriceStopView => ({
  productId: "p1",
  skus: ["ACR-1"],
  name: "Teszt termék",
  failedAt: "2026-11-17T17:44:00.000Z",
  kinds: [{ kind: "own-price-missing", needsPerson: true }],
  reasons: ["ACR-1: MEGÁLLT (own-price-missing) üres"],
  reasonCut: false,
  ...over,
});

const list = (
  stops: MedusaPriceStopView[],
  over: Partial<MedusaPriceStopsView> = {},
): MedusaPriceStopsView => ({
  total: stops.length,
  needingPerson: stops.filter((s) => s.kinds.some((k) => k.needsPerson)).length,
  truncated: false,
  stops,
  ...over,
});

describe("MedusaPriceStopsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = session("OWNER");
    api.get.mockResolvedValue(list([stop()]));
  });

  it("shows the SKU, the name, the problem in Hungarian, the hint and the summary", async () => {
    render(<MedusaPriceStopsPage />);
    expect(await screen.findByText("Teszt termék")).toBeTruthy();
    expect(screen.getAllByText("ACR-1").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Nincs saját eladási ár megadva").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Add meg a változat saját bruttó eladási árát (a változat az ok szövegében, a cikkszámánál áll).",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("price-stops-summary").textContent).toBe(
      "1 megállt termék, ebből 1 vár emberi döntésre.",
    );
    expect(api.get).toHaveBeenCalledWith("token-OWNER", expect.anything());
  });

  it("shows a person's data state and a run failure in DIFFERENT tones, and says the grey one retries by itself", async () => {
    api.get.mockResolvedValue(
      list([
        stop({
          productId: "a",
          skus: ["A-1"],
          name: "Emberi",
          kinds: [{ kind: "own-price-missing", needsPerson: true }],
        }),
        stop({
          productId: "b",
          skus: ["B-1"],
          name: "Futási",
          kinds: [{ kind: "medusa-write-failed", needsPerson: false }],
        }),
      ]),
    );
    render(<MedusaPriceStopsPage />);
    await screen.findByText("Futási");
    const person = screen.getAllByText("Nincs saját eladási ár megadva")[0]!;
    const run = screen.getAllByText("A bolt írása nem sikerült")[0]!;
    expect(person.className).toContain("amber");
    expect(run.className).toContain("grey");
    expect(
      screen.getAllByText(
        "A szürke jelzés nem árbeviteli hiba: a vetítés újrapróbálja, de ha az ok a bolt beállítása vagy a kapcsolat, az újrapróba magától nem javítja.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("shows the shop setting stop as a person's work: amber, with the Medusa price settings hint, not the grey retry note", async () => {
    api.get.mockResolvedValue(
      list([
        stop({ kinds: [{ kind: "tax-inclusive-not-set", needsPerson: true }] }),
      ]),
    );
    render(<MedusaPriceStopsPage />);
    const badge = (
      await screen.findAllByText(
        "A bolt régiójában nincs bruttó árképzés beállítva",
      )
    )[0]!;
    expect(badge.className).toContain("amber");
    expect(
      screen.getAllByText(
        "A Medusa ár-beállításán (adóval együtt értett ár) kell javítani, nem a termékeken.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(/A szürke jelzés nem árbeviteli hiba/),
    ).toBeNull();
  });

  it("shows an unknown kind as it is, with no invented text", async () => {
    api.get.mockResolvedValue(
      list([
        stop({ kinds: [{ kind: "valami-uj-fajta", needsPerson: false }] }),
      ]),
    );
    render(<MedusaPriceStopsPage />);
    expect(
      (await screen.findAllByText("valami-uj-fajta")).length,
    ).toBeGreaterThan(0);
  });

  it("keeps a product whose row is gone: no SKU, a plain statement", async () => {
    api.get.mockResolvedValue(list([stop({ skus: [], name: null })]));
    render(<MedusaPriceStopsPage />);
    expect(
      (await screen.findAllByText("A termék sora már nincs meg")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("nincs").length).toBeGreaterThan(0);
  });

  it("shows the stored reason text: the hint points at it for the variant's SKU", async () => {
    api.get.mockResolvedValue(
      list([
        stop({
          skus: ["M-1", "M-2"],
          reasons: ["M-2: MEGÁLLT (own-price-missing) üres"],
        }),
      ]),
    );
    render(<MedusaPriceStopsPage />);
    expect(
      (await screen.findAllByText("M-2: MEGÁLLT (own-price-missing) üres"))
        .length,
    ).toBeGreaterThan(0);
  });

  it("the hints say no more than the code: the UNAS price is given in the UNAS, the own price is the variant's, a fractional or unrepresentable price is fixed at its source", () => {
    expect(priceStopKindHint("mirror-price-missing")).toBe(
      "A termék UNAS-beli bruttó ára hiányzik: a UNAS-ban kell megadni, a következő import áthozza.",
    );
    expect(priceStopKindHint("own-price-missing")).toContain("változat");
    expect(priceStopKindHint("price-not-whole-forint")).toContain(
      "ábrázolhatatlanul nagy",
    );
    expect(priceStopKindHint("price-not-whole-forint")).toContain("forrásánál");
    // the word "bolt" means the Medusa shop on this page: no hint sends a person there to enter a price
    for (const hint of Object.values(PRICE_STOP_KIND_HINTS))
      expect(hint).not.toMatch(/\bboltnak\b/);
  });

  it("lists every SKU of a product with several variants", async () => {
    api.get.mockResolvedValue(list([stop({ skus: ["M-1", "M-2"] })]));
    render(<MedusaPriceStopsPage />);
    await screen.findByText("Teszt termék");
    expect(screen.getAllByText("M-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("M-2").length).toBeGreaterThan(0);
  });

  it("says a cut stored reason is cut", async () => {
    api.get.mockResolvedValue(
      list([
        stop({
          reasonCut: true,
          kinds: [{ kind: "truncated", needsPerson: false }],
        }),
      ]),
    );
    render(<MedusaPriceStopsPage />);
    expect(
      (
        await screen.findAllByText(
          "A tárolt ok csonka: az utolsó üzenet vége hiányozhat.",
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it("shows the empty state when nothing is stopped", async () => {
    api.get.mockResolvedValue(list([]));
    render(<MedusaPriceStopsPage />);
    expect(await screen.findByText("Nincs megállt termék")).toBeTruthy();
  });

  it("says the list is cut when the server cut it", async () => {
    api.get.mockResolvedValue(list([stop()], { total: 700, truncated: true }));
    render(<MedusaPriceStopsPage />);
    expect(
      await screen.findByText(/A lista csonka: 1 sor látszik a 700-ból/),
    ).toBeTruthy();
  });

  it("shows an error, not an empty list, when the API fails", async () => {
    api.get.mockRejectedValue(new Error("hálózati hiba"));
    render(<MedusaPriceStopsPage />);
    expect(
      await screen.findByText("Az ár-megállások listája nem tölthető be."),
    ).toBeTruthy();
    expect(screen.queryByText("Nincs megállt termék")).toBeNull();
  });

  it("names a refused permission as such", async () => {
    api.get.mockRejectedValue(new ApiError("Forbidden", 403));
    render(<MedusaPriceStopsPage />);
    expect(
      await screen.findByText("Ehhez a laphoz nincs jogosultságod."),
    ).toBeTruthy();
  });

  it("does not even ask the API for a role without the inventory right", async () => {
    const without = USER_ROLES.find(
      (role) => !hasPermission({ role }, PERMISSIONS.INVENTORY_VIEW),
    );
    expect(
      without,
      "a role without INVENTORY_VIEW is needed for this test",
    ).toBeTruthy();
    auth.session = session(without!);
    render(<MedusaPriceStopsPage />);
    expect(
      await screen.findByText("Ehhez a laphoz nincs jogosultságod."),
    ).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("keeps the server's order (a person's work first): the rows appear as given", async () => {
    api.get.mockResolvedValue(
      list([
        stop({
          productId: "h",
          skus: ["H-1"],
          name: "Elsőként",
          kinds: [{ kind: "own-price-missing", needsPerson: true }],
        }),
        stop({
          productId: "r",
          skus: ["R-1"],
          name: "Másodikként",
          kinds: [{ kind: "medusa-read-failed", needsPerson: false }],
        }),
      ]),
    );
    render(<MedusaPriceStopsPage />);
    await screen.findByText("Másodikként");
    const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    const first = rows.findIndex((text) => text.includes("Elsőként"));
    const second = rows.findIndex((text) => text.includes("Másodikként"));
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
  });
});

describe("the price stop labels", () => {
  // the kinds the server can name (medusa-price-sync.ts priceFailureKind and the pricing policy); an unknown one is shown raw
  const KNOWN_KINDS = [
    "own-price-missing",
    "price-not-whole-forint",
    "mirror-price-missing",
    "mirror-row-missing",
    "authority-unknown",
    "price-negative",
    "ambiguous-price",
    "foreign-currency-price-present",
    "ambiguous-variant",
    "medusa-read-failed",
    "medusa-write-failed",
    "write-not-visible",
    "prices-not-returned",
    "variant-lookup-truncated",
    "tax-inclusive-not-set",
    "no-product-link",
    "variant-not-found",
    "variant-identity-chain-broken",
    "run-threw",
    "run-failed",
    "truncated",
    "other",
  ];

  it("every known kind has its Hungarian label, and an unknown kind comes back as it is", () => {
    for (const kind of KNOWN_KINDS)
      expect(PRICE_STOP_KIND_LABELS[kind], kind).toBeTruthy();
    expect(priceStopKindLabel("valami-uj-fajta")).toBe("valami-uj-fajta");
  });

  it("a hint exists only for a kind with a label, and an unknown kind has none", () => {
    for (const kind of Object.keys(PRICE_STOP_KIND_HINTS))
      expect(PRICE_STOP_KIND_LABELS[kind], kind).toBeTruthy();
    expect(priceStopKindHint("valami-uj-fajta")).toBeNull();
    expect(priceStopKindHint("own-price-missing")).toBeTruthy();
  });
  it("links the product's name to its product page, with the id encoded, and nowhere else (t-20261118-arstop-link)", async () => {
    auth.session = session("OWNER");
    api.get.mockResolvedValue(
      list([
        stop({ productId: "p 1/x", skus: ["A-1"], name: "Egy termék" }),
        stop({ productId: "p2", skus: ["B-1"], name: null }),
      ]),
    );
    const { container } = render(<MedusaPriceStopsPage />);
    const link = await screen.findByRole("link", { name: "Egy termék" });
    expect(link.getAttribute("href")).toBe("/products/p%201%2Fx");
    // a product whose row is gone has no page: no link, and the sentence stays
    expect(screen.getByText("A termék sora már nincs meg")).toBeTruthy();
    expect(container.querySelectorAll("tbody a")).toHaveLength(1);
  });

  it("the link sits inside the long cell, so the phone card layout rule still reaches it", async () => {
    auth.session = session("OWNER");
    api.get.mockResolvedValue(list([stop({ name: "Linkelt termék" })]));
    render(<MedusaPriceStopsPage />);
    const link = await screen.findByRole("link", { name: "Linkelt termék" });
    expect(link.closest("[data-stop-long]")).not.toBeNull();
  });

  it("marks the long cells for the phone card: the problem and the name of every row, and no other cell", async () => {
    auth.session = session("OWNER");
    api.get.mockResolvedValue(
      list([
        stop({ productId: "a", skus: ["A-1"], name: "Egy" }),
        stop({ productId: "b", skus: ["B-1"], name: null }),
      ]),
    );
    const { container } = render(<MedusaPriceStopsPage />);
    await screen.findByText("Egy");
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    for (const row of Array.from(rows)) {
      const cells = Array.from(row.querySelectorAll("td"));
      // sku, name, problem, since: only the name and the problem hold long text
      expect(
        cells.map(
          (cell) => cell.querySelector(":scope > [data-stop-long]") !== null,
        ),
      ).toEqual([false, true, true, false]);
    }
  });

  it("lets exactly the marked cells wrap on a phone, with a rule that lives on this page's wrapper and not on the shared table", async () => {
    auth.session = session("OWNER");
    api.get.mockResolvedValue(list([stop()]));
    const { container } = render(<MedusaPriceStopsPage />);
    await screen.findByText("Teszt termék");
    const wrapper = container.querySelector(
      '[class*="has(>[data-stop-long])"]',
    );
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector("table")).not.toBeNull();
    expect(wrapper!.className).toContain(
      "max-md:[&_td:has(>[data-stop-long])]:flex-wrap",
    );
    // the shared table's own root carries no such rule
    expect(
      wrapper!.querySelector("table")!.parentElement!.className,
    ).not.toContain("data-stop-long");
  });
});
