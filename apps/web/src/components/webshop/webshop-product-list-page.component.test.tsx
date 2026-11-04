import { render, screen } from "@testing-library/react";
import type { ProductListResponse, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WebshopProductListPage,
  PRODUCT_COLUMNS,
  PRODUCT_TABLE_MIN_WIDTH,
} from "./webshop-product-list-page";

const api = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/webshop/termekek",
  useSearchParams: () => search.params,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/products", () => ({ productApi: api }));
// the shipping column's badge reaches the pilot font (next/font/local), which only Next resolves (CI #2200)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

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

function response(
  items: ProductListResponse["items"],
  totalItems = items.length,
): ProductListResponse {
  return {
    items,
    pagination: {
      page: 1,
      pageSize: 25,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / 25)),
    },
  };
}

const reefSalt: ProductListResponse["items"][number] = {
  id: "product-1",
  name: "Reef Salt 4 kg",
  productType: "PHYSICAL",
  origin: "UNAS",
  catalogAuthority: "UNAS",
  isActive: true,
  archivedAt: null,
  brand: null,
  primaryCategory: null,
  primarySku: "REEF-SALT-01",
  thumbnail: null,
  unasListing: {
    channel: "UNAS",
    externalStatus: "3",
    isPublished: false,
    slug: null,
    productUrl: "https://shop.example/reef-salt",
    seoTitle: null,
    backorderAllowed: false,
  },
  grossPrice: "12700",
  priceSource: "unas" as const,
  saleGrossPrice: null,
  stockOnHand: "6",
};

beforeEach(() => {
  auth.session = ownerSession;
  search.params = new URLSearchParams();
  api.list.mockReset().mockResolvedValue(response([reefSalt]));
});

describe("WebshopProductListPage", () => {
  /**
   * Listed, not published. Nothing writes `isPublished`, so it is false on
   * every row: a filter on it would answer with an empty screen on a shop
   * full of products. Both halves are asserted, because asking for the
   * channel and *also* asking for publication would still look right here.
   */
  it("asks for the products listed on the channel, and not for published ones", async () => {
    render(<WebshopProductListPage />);

    await screen.findByText("Reef Salt 4 kg");

    const query = api.list.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(query.listedOn).toBe("UNAS");
    expect(JSON.stringify(query)).not.toContain("isPublished");
  });

  /**
   * The shop's status codes have no agreed meaning in this repository, and
   * the product page shows the same value unmapped. A label invented on this
   * screen would read as fact.
   */
  // a82ed229, 2b: the shipping filter from the URL reaches the API; the column tells "never looked at" apart
  it("passes the shipping filter from the URL, and shows the shipping column", async () => {
    search.params = new URLSearchParams("szallitas=none");
    api.list.mockResolvedValue(
      response([{ ...reefSalt, shippingFlags: null }]),
    );
    render(<WebshopProductListPage />);
    expect(await screen.findByText("nincs vizsgálva")).toBeInTheDocument();
    const query = api.list.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(query.shipping).toBe("none");
    search.params = new URLSearchParams();
  });

  it("shows the channel status as it arrives, without inventing a meaning", async () => {
    render(<WebshopProductListPage />);

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Webshopban" })).toHaveAttribute(
      "href",
      "https://shop.example/reef-salt",
    );
  });

  it("the fixed column widths leave the name at least 150 px of the table minimum", () => {
    const fixed = PRODUCT_COLUMNS.filter((c) => c.header !== "Név").reduce(
      (acc, c) => acc + Number(/^(\d+)px$/.exec(c.width ?? "")?.[1]),
      0,
    );
    expect(fixed + 150).toBeLessThanOrEqual(PRODUCT_TABLE_MIN_WIDTH);
    expect(
      PRODUCT_COLUMNS.find((c) => c.header === "Név")!.width,
    ).toBeUndefined();
  });

  // The list is the shared table: on the phone every row is a card, each cell labelled with its
  // column, so the price, the stock and the channel status do not disappear at 390 px.
  it("labels every cell with its column for the phone card view", async () => {
    render(<WebshopProductListPage />);
    await screen.findByText("Reef Salt 4 kg");
    const row = screen.getAllByTestId("webshop-product-row")[0]!;
    expect(
      [...row.querySelectorAll("td")].map((td) =>
        td.getAttribute("data-label"),
      ),
    ).toEqual([
      "Név",
      "Cikkszám",
      "Bruttó ár",
      "Készlet",
      "Webshop státusz",
      "Megnyitás",
    ]);
  });

  /**
   * An empty screen has to say which emptiness it is. A search that matched
   * nothing is the reader's to fix; a shop with nothing synchronised is not,
   * and retyping the search would never help.
   */
  it("says the sync may not have run when nothing is listed at all", async () => {
    api.list.mockResolvedValue(response([]));

    render(<WebshopProductListPage />);

    expect(
      await screen.findByText("Egy termék sem szerepel a webshopban"),
    ).toBeInTheDocument();
    expect(screen.getByText(/szinkron/)).toBeInTheDocument();
  });

  it("blames the search, not the sync, when a search matched nothing", async () => {
    search.params = new URLSearchParams({ search: "nincsilyen" });
    api.list.mockResolvedValue(response([]));

    render(<WebshopProductListPage />);

    expect(
      await screen.findByText("Nincs találat erre a keresésre"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Egy termék sem szerepel a webshopban"),
    ).not.toBeInTheDocument();
  });

  it("keeps the catalogue editor out of reach of this screen", async () => {
    render(<WebshopProductListPage />);

    await screen.findByText("Reef Salt 4 kg");

    expect(
      screen.getByRole("link", { name: "Reef Salt 4 kg" }),
    ).toHaveAttribute("href", "/products/product-1");
    expect(
      screen.queryByRole("button", { name: /vonalkód/i }),
    ).not.toBeInTheDocument();
  });
});
