import { fireEvent, render, screen, within } from "@testing-library/react";
import type {
  Session,
  WebshopOrderListItem,
  WebshopOrderListResponse,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopOrdersListPage } from "./webshop-orders-list-page";

/*
  WEBSHOP / RENDELÉSEK LISTA. MI PIROSÍT: a sor nem a Figma adatait mutatja
  (#szám, jelek, „Stripe · Zárolva”, „Számlára vár”, státusz és kora); az
  elavult sor nincs kiemelve; a számláló nem szűr, vagy a második kattintás
  nem veszi le; a jelölőnégyzet megnyitja a rendelést; a rendezés nem vált
  irányt; hibánál nincs „Újra”, üres szűrésnél nincs „Szűrés törlése”; jog
  nélkül betölt.
*/
const api = vi.hoisted(() => ({ list: vi.fn() }));
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/webshop/rendelesek",
  useSearchParams: () => nav.params,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/webshop-orders", () => ({ webshopOrdersApi: api }));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-pilot" }),
}));

const session = (role: "OWNER" | "SERVICE"): Session => ({
  id: "s",
  token: "token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "u",
    email: "u@acropora.local",
    displayName: "Felhasználó",
    role,
    customerId: null,
    supplierId: null,
  },
});

const order = (
  over: Partial<WebshopOrderListItem> = {},
): WebshopOrderListItem => ({
  id: "order_38",
  displayId: 38,
  createdAt: "2026-10-05T11:21:00.000Z",
  total: 24900,
  currency: "HUF",
  customer: {
    name: "Nagy Emese",
    email: "emese@example.hu",
    phone: "+36 30 555 0137",
    isNew: true,
    unsuccessfulOrderCount: 0,
    hasOtherOpenOrder: true,
    guest: false,
  },
  shipping: {
    method: "Foxpost csomagpont",
    pickupPoint: "FOXPOST Allee",
    pointKind: null,
    storePickup: false,
  },
  payment: {
    method: "Stripe",
    state: "AUTHORIZED",
    holdExpiresAt: null,
    holdWarning: null,
  },
  invoiceNumber: null,
  status: {
    code: "confirmed",
    label: "Visszaigazolva",
    changedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    stale: false,
  },
  stage: "invoice",
  relatedOrder: null,
  ...over,
});

const response = (
  items: WebshopOrderListItem[],
  over: Partial<WebshopOrderListResponse> = {},
): WebshopOrderListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
  counters: { processing: 3, invoice: 5, dispatch: 4, pickup: 2, stale: 1 },
  shippingMethods: ["Foxpost csomagpont"],
  paymentMethods: ["Stripe"],
  truncated: false,
  ...over,
});

beforeEach(() => {
  auth.session = session("OWNER");
  nav.params = new URLSearchParams();
  nav.push.mockReset();
  nav.replace.mockReset();
  api.list.mockReset();
});

const row = async (name: RegExp) => screen.findByRole("row", { name });

describe("WebshopOrdersListPage", () => {
  it("shows a row the way the design does, and marks the stale one", async () => {
    api.list.mockResolvedValue(
      response([
        order(),
        order({
          id: "order_37",
          displayId: 37,
          status: {
            code: "stocking",
            label: "Készletezés alatt",
            changedAt: new Date(Date.now() - 12 * 3_600_000).toISOString(),
            stale: true,
          },
        }),
      ]),
    );
    render(createElement(WebshopOrdersListPage));

    const fresh = await row(/#38 megnyitása$/);
    expect(within(fresh).getByText("#38")).toBeTruthy();
    expect(within(fresh).getByText("Nagy Emese")).toBeTruthy();
    expect(within(fresh).getByTitle("Új vásárló")).toBeTruthy();
    expect(
      within(fresh).getByTitle("Van másik nyitott rendelése"),
    ).toBeTruthy();
    expect(within(fresh).getByText("24 900 Ft")).toBeTruthy();
    expect(
      within(fresh).getByText("Foxpost csomagpont · FOXPOST Allee"),
    ).toBeTruthy();
    expect(within(fresh).getByText("Stripe · Zárolva")).toBeTruthy();
    expect(within(fresh).getByText("Számlára vár")).toBeTruthy();
    expect(within(fresh).getByText("Visszaigazolva")).toBeTruthy();
    expect(within(fresh).getByText("4 órája")).toBeTruthy();
    expect(fresh.className).not.toContain("bg-pilot-amber-50");

    const stale = await row(/#37 megnyitása, elavult/);
    expect(stale.className).toContain("!bg-pilot-amber-50");
    expect(within(stale).getByText("12 órája · elavult")).toBeTruthy();

    const counters = screen.getByRole("group", {
      name: "Feldolgozási számlálók",
    });
    expect(
      within(counters).getByRole("button", { name: /Számlára vár\s*5/ }),
    ).toBeTruthy();
  });

  it("an expiring card hold is named in the payment column (lejáró zárolás)", async () => {
    api.list.mockResolvedValue(
      response([
        order({
          payment: {
            method: "Stripe",
            state: "AUTHORIZED",
            holdExpiresAt: "2026-10-07T10:00:00.000Z",
            holdWarning: "soon",
          },
        }),
        order({
          id: "order_39",
          displayId: 39,
          payment: {
            method: "Stripe",
            state: "AUTHORIZED",
            holdExpiresAt: "2026-10-04T10:00:00.000Z",
            holdWarning: "expired",
          },
        }),
      ]),
    );
    render(createElement(WebshopOrdersListPage));
    expect(
      await screen.findByText("A zárolás 2 napon belül lejár"),
    ).toBeTruthy();
    expect(screen.getByText("A zárolás lejárt")).toBeTruthy();
  });

  it("a GLS order names its kind: ParcelShop, automata, házhoz (GLS prompt, point 11)", async () => {
    api.list.mockResolvedValue(
      response([
        order({
          shipping: {
            method: "GLS csomagpont",
            pickupPoint: "Mammut",
            pointKind: "parcel-shop",
            storePickup: false,
          },
        }),
        order({
          id: "order_39",
          displayId: 39,
          shipping: {
            method: "GLS csomagpont",
            pickupPoint: "Allee automata",
            pointKind: "parcel-locker",
            storePickup: false,
          },
        }),
        order({
          id: "order_40",
          displayId: 40,
          shipping: {
            method: "GLS házhozszállítás",
            pickupPoint: null,
            pointKind: null,
            storePickup: false,
          },
        }),
      ]),
    );
    render(createElement(WebshopOrdersListPage));
    expect(await screen.findByText("GLS ParcelShop · Mammut")).toBeTruthy();
    expect(screen.getByText("GLS automata · Allee automata")).toBeTruthy();
    expect(screen.getByText("GLS házhoz")).toBeTruthy();
  });

  it("a counter filters, and the same counter clicked again clears it", async () => {
    api.list.mockResolvedValue(response([order()]));
    const { rerender } = render(createElement(WebshopOrdersListPage));
    fireEvent.click(
      await screen.findByRole("button", { name: /Számlára vár\s*5/ }),
    );
    expect(nav.replace).toHaveBeenLastCalledWith(
      "/webshop/rendelesek?stage=invoice",
    );

    nav.params = new URLSearchParams("stage=invoice");
    rerender(createElement(WebshopOrdersListPage));
    const active = await screen.findByRole("button", {
      name: /Számlára vár\s*5/,
    });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(active);
    expect(nav.replace).toHaveBeenLastCalledWith("/webshop/rendelesek");
  });

  it("the checkbox selects without opening the order; the row opens it", async () => {
    api.list.mockResolvedValue(response([order()]));
    render(createElement(WebshopOrdersListPage));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Kijelölés: #38" }),
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByText("1 rendelés · 1 kijelölve")).toBeTruthy();
    fireEvent.click(await row(/#38 megnyitása$/));
    expect(nav.push).toHaveBeenCalledWith("/webshop/rendelesek/order_38");
  });

  it("a sortable header sorts, and a second click turns the direction", async () => {
    api.list.mockResolvedValue(response([order()]));
    const { rerender } = render(createElement(WebshopOrdersListPage));
    fireEvent.click(
      await screen.findByRole("button", { name: "Rendezés: Összeg" }),
    );
    expect(nav.replace).toHaveBeenLastCalledWith(
      "/webshop/rendelesek?sort=total&direction=desc",
    );
    nav.params = new URLSearchParams("sort=total&direction=desc");
    rerender(createElement(WebshopOrdersListPage));
    fireEvent.click(
      await screen.findByRole("button", { name: "Rendezés: Összeg" }),
    );
    expect(nav.replace).toHaveBeenLastCalledWith(
      "/webshop/rendelesek?sort=total&direction=asc",
    );
  });

  it("a load error offers Újra, and Újra loads again", async () => {
    api.list.mockRejectedValueOnce(
      new Error("A webshop nem adta ki a rendeléseket (HTTP 502)."),
    );
    api.list.mockResolvedValue(response([order()]));
    render(createElement(WebshopOrdersListPage));
    expect(
      await screen.findByText(
        "A webshop nem adta ki a rendeléseket (HTTP 502).",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Újra" }));
    expect(await row(/#38 megnyitása$/)).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("no match under a filter offers to clear it; no order at all says so", async () => {
    nav.params = new URLSearchParams("status=closed&q=xyz&view=all");
    api.list.mockResolvedValue(response([]));
    const { unmount } = render(createElement(WebshopOrdersListPage));
    fireEvent.click(
      await screen.findByRole("button", { name: "Szűrés törlése" }),
    );
    expect(nav.replace).toHaveBeenLastCalledWith(
      "/webshop/rendelesek?view=all",
    );
    unmount();

    nav.params = new URLSearchParams("view=all");
    render(createElement(WebshopOrdersListPage));
    expect(await screen.findByText("Még nincs webshop rendelés")).toBeTruthy();
  });

  it("without orders.view it loads nothing and says why", async () => {
    auth.session = session("SERVICE");
    render(createElement(WebshopOrdersListPage));
    expect(
      await screen.findByText("Nincs hozzáférésed a rendelésekhez"),
    ).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });
});
