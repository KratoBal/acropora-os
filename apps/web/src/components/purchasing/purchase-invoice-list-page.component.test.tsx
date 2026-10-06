import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { PurchaseInvoiceListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PurchaseInvoiceListPage,
  purchaseInvoiceListQuery,
} from "./purchase-invoice-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn(), sync: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

// a lap a Direction F óta `PilotThemeRoot` alatt áll (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/beszerzes",
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
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/purchasing", () => ({ purchasingApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

function response(page: number): PurchaseInvoiceListResponse {
  return {
    items: [
      {
        id: "invoice-1",
        documentNumber: "BESZ-2026-001",
        supplierInvoiceNumber: "SZ-1",
        source: "HU_MANUAL",
        status: "DRAFT",
        supplierId: "supplier-1",
        supplierName: "Aqua Kereskedés Kft.",
        currency: "HUF",
        invoiceDate: "2026-08-19",
        isPaid: false,
        totalNet: "10000",
        createdAt: "2026-08-19T10:00:00.000Z",
        updatedAt: "2026-08-19T10:00:00.000Z",
        hasPdf: false,
      },
    ],
    pagination: { page, pageSize: 25, totalItems: 60, totalPages: 3 },
  };
}

/**
 * Ugyanaz a mérés, mint az eszközlistán: a lapozás nem mehet a szűrő-ágon,
 * mert az a végén mindig `page=1`-et ír. A javítás előtti alakkal ez az
 * eset bukik - a "Következő" a 2. oldalról az elsőre visz vissza.
 */
describe("PurchaseInvoiceListPage paging", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(2));
    api.sync.mockReset().mockResolvedValue({});
  });

  it("moves to the next page instead of returning to the first", async () => {
    render(<PurchaseInvoiceListPage />);
    await screen.findByText("BESZ-2026-001");

    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő" }),
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("page")).toBe("3");
  });
});

/*
  DIRECTION F (Balázs Beszerzés-briefje, 2026-09-30, 5. pont). MI PIROSÍT: ha
  a forrás vagy a fizetési állapot nem kerül az URL-be (és így a kérésbe), ha
  a szűrő-váltás a 3. oldalon hagyja a listát, ha a "Szűrők törlése" valamelyik
  szűrőt ott felejti, ha a fülek aktív jelölése elcsúszik, vagy ha az összeg
  fejléce és cellája máshová igazodik.
*/
describe("PurchaseInvoiceListPage Direction F", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=3&search=SZ");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(3));
  });

  const lastQuery = () =>
    new URLSearchParams(
      String(navigation.replace.mock.calls.at(-1)?.[0]).split("?")[1],
    );

  it("the source and payment filters go into the query and back to page 1", async () => {
    render(<PurchaseInvoiceListPage />);
    await screen.findByText("BESZ-2026-001");

    fireEvent.change(screen.getByRole("combobox", { name: "Forrás" }), {
      target: { value: "HU_NAV" },
    });
    expect(lastQuery().get("source")).toBe("HU_NAV");
    expect(lastQuery().get("page")).toBe("1");
    expect(lastQuery().get("search")).toBe("SZ");

    fireEvent.change(
      screen.getByRole("combobox", { name: "Fizetési állapot" }),
      { target: { value: "open" } },
    );
    expect(lastQuery().get("payment")).toBe("open");
  });

  it("the filters reach the request", async () => {
    navigation.params = new URLSearchParams("source=EU&payment=paid");
    render(<PurchaseInvoiceListPage />);
    await screen.findByText("BESZ-2026-001");
    const query = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(query.get("source")).toBe("EU");
    expect(query.get("payment")).toBe("paid");
  });

  it("'Szűrők törlése' clears the search, the source and the payment", async () => {
    navigation.params = new URLSearchParams(
      "page=2&search=SZ&source=EU&payment=paid",
    );
    render(<PurchaseInvoiceListPage />);
    await screen.findByText("BESZ-2026-001");

    fireEvent.click(screen.getByRole("button", { name: "Szűrők törlése" }));
    const query = lastQuery();
    expect(query.get("search")).toBeNull();
    expect(query.get("source")).toBeNull();
    expect(query.get("payment")).toBeNull();
    expect(query.get("page")).toBe("1");
  });

  it("without a filter there is no 'Szűrők törlése' (control)", async () => {
    navigation.params = new URLSearchParams("page=1");
    render(<PurchaseInvoiceListPage />);
    await screen.findByText("BESZ-2026-001");
    expect(screen.queryByRole("button", { name: "Szűrők törlése" })).toBeNull();
  });

  it("the tabs link the purchasing pages, the list is the current one", async () => {
    render(<PurchaseInvoiceListPage />);
    await screen.findByText("BESZ-2026-001");
    const tabs = within(
      screen.getByRole("navigation", { name: "Beszerzés oldalai" }),
    ).getAllByRole("link");
    expect(
      tabs.map((tab) => [
        tab.textContent,
        tab.getAttribute("href"),
        tab.getAttribute("aria-current"),
      ]),
    ).toEqual([
      ["Beszerzések", "/beszerzes", "page"],
      ["Várható beérkezések", "/beszerzes/varhato", null],
      ["NAV számla lekérés", "/beszerzes/nav-szamlak", null],
    ]);
  });

  it("the amount is right-aligned in the header and in the cell alike", async () => {
    render(<PurchaseInvoiceListPage />);
    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const cells = within(within(table).getAllByRole("row")[1]!).getAllByRole(
      "cell",
    );
    const right = (element: HTMLElement) =>
      element.className.split(" ").includes("text-right");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Bizonylatszám",
      "Beszállító",
      "Számlaszám",
      "Kelte",
      "Összeg",
      "Fizetve",
      "Forrás",
    ]);
    expect(headers.map(right)).toEqual(cells.map(right));
    expect(right(headers[4]!)).toBe(true);
  });
});

/*
  AZ URL ÉS A KÉRÉS (stage, 2026-09-30, acrobot): a kézzel írt
  "/beszerzes?q=hertlein" 400-at kapott, mert a lap az URL minden paraméterét
  továbbadta, és az API a "q"-t nem ismeri. MI PIROSÍT: ha egy ismeretlen
  paraméter megint átmegy, ha a "q" nem keresésként érkezik, vagy ha a beírt
  keresés a "q"-t az URL-ben hagyja.
*/
describe("PurchaseInvoiceListPage query from the URL", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(1));
  });

  it("forwards only the known fields; q is the search's other name", () => {
    const query = purchaseInvoiceListQuery(
      new URLSearchParams("q=hertlein&foo=1&source=EU&page=2"),
    );
    expect(Object.fromEntries(query)).toEqual({
      page: "2",
      pageSize: "25",
      search: "hertlein",
      source: "EU",
    });
    // search wins over q
    expect(
      purchaseInvoiceListQuery(new URLSearchParams("q=a&search=b")).get(
        "search",
      ),
    ).toBe("b");
  });

  it("a ?q= link lists with the search and fills the search box", async () => {
    navigation.params = new URLSearchParams("q=hertlein&foo=1");
    render(<PurchaseInvoiceListPage />);
    await screen.findByText("BESZ-2026-001");
    const sent = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(sent.get("search")).toBe("hertlein");
    expect(sent.has("q")).toBe(false);
    expect(sent.has("foo")).toBe(false);
    expect(
      screen.getByRole("textbox", { name: "Számla keresése" }),
    ).toHaveValue("hertlein");
  });

  it("typing a new search writes search and drops q from the URL", async () => {
    navigation.params = new URLSearchParams("q=hertlein");
    render(<PurchaseInvoiceListPage />);
    await screen.findByText("BESZ-2026-001");
    fireEvent.change(screen.getByRole("textbox", { name: "Számla keresése" }), {
      target: { value: "tropic" },
    });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const url = new URLSearchParams(
      String(navigation.replace.mock.calls.at(-1)?.[0]).split("?")[1],
    );
    expect(url.get("search")).toBe("tropic");
    expect(url.has("q")).toBe(false);
  });
});
