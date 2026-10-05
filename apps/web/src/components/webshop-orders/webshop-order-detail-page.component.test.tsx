import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Session, WebshopOrderDetail } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopOrderDetailPage } from "./webshop-order-detail-page";

/*
  A WEBSHOP RENDELÉS ADATLAPJA, OLVASVA. MI PIROSÍT: a csomag lépés nem mondja,
  hogy előbb a számla kell; az utánvét díja nem külön sor; a zárolt és a
  levonandó összeg nem látszik; a Stripe ID nem másolható; a kapcsolódó
  rendelés nem nyitható; egy még be nem kötött művelet gombként áll
  (Státusz módosítása, ceruza); hibánál nincs „Újra”; jog nélkül betölt.
*/
const api = vi.hoisted(() => ({ detail: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/webshop-orders", () => ({ webshopOrdersApi: api }));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-pilot" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/webshop/rendelesek/order_38",
  useSearchParams: () => new URLSearchParams(),
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

const detail: WebshopOrderDetail = {
  id: "order_38",
  displayId: 38,
  createdAt: "2026-10-05T11:21:00.000Z",
  currency: "HUF",
  status: {
    code: "confirmed",
    label: "Visszaigazolva",
    changedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    stale: false,
  },
  nextStatuses: [{ status: "stocking", label: "Készletezés alatt" }],
  customer: {
    name: "Nagy Emese",
    email: "emese@example.hu",
    phone: "+36 30 555 0137",
    isNew: true,
    guest: false,
  },
  billingAddress: {
    name: "Nagy Emese",
    company: null,
    line: "1117 Budapest, Fehérvári út 24.",
    countryCode: "HU",
    phone: null,
  },
  shippingAddress: null,
  shipping: {
    method: "Foxpost csomagpont",
    storePickup: false,
    carrier: "FOXPOST",
    pickupPoint: {
      id: "HU12345",
      name: "FOXPOST Allee",
      address: "1117 Budapest, Október huszonharmadika u. 8–10.",
    },
  },
  lines: [
    {
      id: "i1",
      title: "Reef Salt Pro 20 kg",
      variantTitle: null,
      sku: "RSP-20",
      quantity: 1,
      unitPrice: 18900,
      total: 18900,
    },
  ],
  totals: {
    subtotal: 18900,
    discount: 0,
    shipping: 1490,
    codFee: 450,
    total: 20840,
  },
  payment: {
    method: "Stripe",
    state: "AUTHORIZED",
    authorized: 20840,
    toCapture: 20840,
    captured: 0,
    refunded: 0,
    stripePaymentIntentId: "pi_3QX8fJ",
  },
  invoiceNumber: null,
  steps: [
    {
      key: "confirm",
      label: "Visszaigazolás",
      detail: "Visszaigazolva",
      state: "done",
    },
    {
      key: "invoice",
      label: "Számla",
      detail: "Számla kiállítása",
      state: "current",
    },
    {
      key: "parcel",
      label: "Csomag",
      detail: "Előbb állítsd ki a számlát",
      state: "blocked",
    },
    {
      key: "delivery",
      label: "Kiszállítás",
      detail: "Levonás a kártyáról",
      state: "todo",
    },
    {
      key: "closed",
      label: "Átvéve / Lezárva",
      detail: "Végállapot",
      state: "todo",
    },
  ],
  relatedOrder: { id: "order_39", displayId: 39, role: "pickup" },
  history: [
    {
      at: "2026-10-05T11:21:00.000Z",
      text: "Rendelés létrejött · Feldolgozásra vár",
    },
  ],
};

beforeEach(() => {
  auth.session = session("OWNER");
  api.detail.mockReset();
});

describe("WebshopOrderDetailPage", () => {
  it("shows the order the way the design does", async () => {
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));

    expect(await screen.findByRole("heading", { name: "#38" })).toBeTruthy();
    expect(
      screen.getByText("Visszaigazolva", { selector: "span.rounded-full" }),
    ).toBeTruthy();

    const steps = screen.getByRole("list", { name: "Feldolgozási lépések" });
    const parcel = within(steps).getByRole("listitem", {
      name: "3. Csomag: várakozik",
    });
    expect(within(parcel).getByText("Előbb állítsd ki a számlát")).toBeTruthy();
    expect(
      within(steps).getByRole("listitem", { name: "2. Számla: folyamatban" }),
    ).toBeTruthy();

    const banner = screen.getByRole("link", { name: "Megnyitás" });
    expect(banner.getAttribute("href")).toBe("/webshop/rendelesek/order_39");
    expect(
      screen.getByText(/Kapcsolódó rendelés: #39 · bolti átvétel/),
    ).toBeTruthy();

    const items = screen.getByRole("region", { name: "Tételek" });
    expect(within(items).getByText("Utánvét kezelési díj")).toBeTruthy();
    expect(within(items).getByText("450 Ft")).toBeTruthy();
    expect(within(items).getByText("Zárolva: 20 840 Ft")).toBeTruthy();
    expect(within(items).getByText("Levonásra kerül: 20 840 Ft")).toBeTruthy();

    expect(
      screen.getByRole("link", { name: "E-mail küldése" }).getAttribute("href"),
    ).toBe("mailto:emese@example.hu");
    expect(
      screen.getByRole("link", { name: "Hívás" }).getAttribute("href"),
    ).toBe("tel:+36305550137");
  });

  it("copies the Stripe ID, and shows no button for an action not wired yet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Stripe ID másolása" }),
    );
    expect(writeText).toHaveBeenCalledWith("pi_3QX8fJ");
    expect(
      screen.queryByRole("button", {
        name: /Státusz módosítása|Csomagfeladás|Visszatérítés|Műveletek/,
      }),
    ).toBeNull();
  });

  it("a load error offers Újra; without orders.view nothing loads", async () => {
    api.detail.mockRejectedValueOnce(
      new Error("A rendelés nem található a webshopban."),
    );
    api.detail.mockResolvedValue(detail);
    const { unmount } = render(
      createElement(WebshopOrderDetailPage, { id: "order_38" }),
    );
    expect(
      await screen.findByText("A rendelés nem található a webshopban."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Újra" }));
    expect(await screen.findByRole("heading", { name: "#38" })).toBeTruthy();
    unmount();

    api.detail.mockReset();
    auth.session = session("SERVICE");
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    expect(
      await screen.findByText("Nincs hozzáférésed a rendelésekhez"),
    ).toBeTruthy();
    expect(api.detail).not.toHaveBeenCalled();
  });
});
