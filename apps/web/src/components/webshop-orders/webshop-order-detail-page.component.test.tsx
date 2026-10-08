import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@acropora/types";
import type { Session, WebshopOrderDetail } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WebshopOrderDetailPage,
  methodChangeText,
} from "./webshop-order-detail-page";

/*
  A WEBSHOP RENDELÉS ADATLAPJA, OLVASVA. MI PIROSÍT: a csomag lépés nem mondja,
  hogy előbb a számla kell; az utánvét díja nem külön sor; a zárolt és a
  levonandó összeg nem látszik; a Stripe ID nem másolható; a kapcsolódó
  rendelés nem nyitható; egy még be nem kötött művelet gombként áll
  (Státusz módosítása, ceruza); hibánál nincs „Újra”; jog nélkül betölt.
*/
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  changeStatus: vi.fn(),
  resendStatusMail: vi.fn(),
  editLine: vi.fn(),
  releaseHold: vi.fn(),
  sendPaymentLink: vi.fn(),
  updateAddress: vi.fn(),
  saveInternalNote: vi.fn(),
  pickupPoints: vi.fn(),
  changePoint: vi.fn(),
  shippingOptions: vi.fn(),
  shippingOptionPoints: vi.fn(),
  changeShippingMethod: vi.fn(),
  saveNotes: vi.fn(),
  split: vi.fn(),
  replacementVariants: vi.fn(),
  issueInvoice: vi.fn(),
  issueDeliveryNote: vi.fn(),
  sendProforma: vi.fn(),
  recordTransferReceived: vi.fn(),
  syncTransferToShop: vi.fn(),
  createParcel: vi.fn(),
  parcelLabel: vi.fn(),
  releaseParcel: vi.fn(),
  parcelTracking: vi.fn(),
}));
const billing = vi.hoisted(() => ({ pdf: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/webshop-orders", () => ({ webshopOrdersApi: api }));
vi.mock("@/lib/api/billing-documents", () => ({
  billingDocumentsApi: billing,
}));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-pilot" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/webshop/rendelesek/order_38",
  useSearchParams: () => new URLSearchParams(),
}));

const session = (
  role: "OWNER" | "SERVICE" | "WAREHOUSE" | "SALES",
): Session => ({
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

/**
 * AN ORDER HANDLER WITHOUT THE INVOICE RIGHTS. Since 2026-10-08 the SALES
 * template issues invoices (Balázs), so "orders.manage without billing.issue"
 * is a SALES user whose billing writes were taken away person by person.
 */
const salesWithoutBilling = (): Session => {
  const base = session("SALES");
  return {
    ...base,
    user: {
      ...base.user,
      permissions: ROLE_PERMISSIONS.SALES.filter(
        (permission) =>
          permission !== PERMISSIONS.BILLING_CREATE &&
          permission !== PERMISSIONS.BILLING_ISSUE &&
          permission !== PERMISSIONS.BILLING_RESEND,
      ),
    },
  };
};

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
    unsuccessfulOrderCount: 0,
    hasOtherOpenOrder: false,
  },
  dispatchPreview: { ready: true, reason: null, codHuf: null },

  billingAddress: {
    name: "Nagy Emese",
    company: null,
    line: "1117 Budapest, Fehérvári út 24.",
    countryCode: "HU",
    phone: null,
    fields: {
      lastName: "Nagy",
      firstName: "Emese",
      company: null,
      taxNumber: null,
      postalCode: "1117",
      city: "Budapest",
      line1: "Fehérvári út 24.",
      line2: null,
      phone: null,
      countryCode: "HU",
    },
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
      kind: null,
      type: "FOXPOST automata",
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
  invoice: null,
  deliveryNote: null,
  bankTransfer: false,
  proforma: null,
  transferReceipt: null,
  externalInvoice: null,
  parcel: null,
  cardPayment: null,
  osCustomer: null,
  internalNote: null,
  notes: { customer: null, carrier: null },
  notesEdit: {
    customer: { allowed: true, reason: null },
    carrier: { allowed: true, reason: null },
  },
  pointEdit: { allowed: true, reason: null },
  methodEdit: { allowed: true, reason: null },
  addressEdit: {
    billing: { allowed: true, reason: null },
    shipping: { allowed: true, reason: null },
  },
  lineEdit: { allowed: true, reason: null },
  splitEdit: { allowed: true, reason: null },
  split: { from: null, into: [] },
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
      mail: null,
    },
  ],
};

beforeEach(() => {
  api.parcelTracking.mockReset().mockResolvedValue({
    events: [],
    checkedAt: "2026-10-06T08:00:00.000Z",
  });
  auth.session = session("OWNER");
  api.detail.mockReset();
  api.changeStatus.mockReset();
  api.resendStatusMail.mockReset();
  api.editLine.mockReset();
  api.releaseHold.mockReset();
  api.sendPaymentLink.mockReset();
  api.updateAddress.mockReset();
  api.saveInternalNote.mockReset();
  api.split.mockReset();
  api.shippingOptions.mockReset();
  api.shippingOptionPoints.mockReset();
  api.changeShippingMethod.mockReset();
  api.replacementVariants.mockReset();
  api.issueInvoice.mockReset();
  api.issueDeliveryNote.mockReset();
  api.sendProforma.mockReset();
  api.recordTransferReceived.mockReset();
  api.syncTransferToShop.mockReset();
  api.createParcel.mockReset();
  api.parcelLabel.mockReset();
  api.releaseParcel.mockReset();
  billing.pdf.mockReset();
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
        name: /Csomagfeladás|Visszatérítés|Műveletek/,
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

  /**
   * STÁTUSZ MÓDOSÍTÁSA (a prompt 9. pontja). MI PIROSÍT: a lista nem csak a
   * megengedett célokat kínálja; a kérés nem a választott céllal megy; a
   * webshop elutasítása (például a levonás hibája) bezárja a párbeszédet, és
   * a kezelő nem látja az okát; végállapotnál vagy kezelési jog nélkül gomb áll.
   */
  it("offers only the allowed next statuses and sends the chosen one", async () => {
    api.detail.mockResolvedValue(detail);
    api.changeStatus.mockResolvedValue({
      order: {
        ...detail,
        status: {
          ...detail.status,
          code: "stocking",
          label: "Készletezés alatt",
        },
        nextStatuses: [],
      },
      mail: { sent: false, reason: "no_mail_for_status" },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Státusz módosítása" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Státusz módosítása" });
    expect(within(dialog).getByText("Visszaigazolva")).toBeTruthy();
    const select = within(dialog).getByRole("combobox", {
      name: "Következő státusz",
    });
    expect(
      Array.from(select.querySelectorAll("option")).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Készletezés alatt"]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Státusz módosítása" }),
    );
    expect(
      await screen.findByText("Készletezés alatt", {
        selector: "span.rounded-full",
      }),
    ).toBeTruthy();
    expect(api.changeStatus).toHaveBeenCalledWith(
      "token",
      "order_38",
      "stocking",
      true,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText("Ehhez az állapothoz nem tartozik levél."),
    ).toBeTruthy();
  });

  /**
   * A STÁTUSZLEVÉL (commerce #479). MI PIROSÍT: a „Vevő értesítése” jelölő
   * kikapcsolása nem jut el a kérésig; a sor levele nem látszik; az
   * újraküldés nem hívódik, vagy kezelési jog nélkül is gomb áll.
   */
  it("an unticked „Vevő értesítése” changes the status without a mail", async () => {
    api.detail.mockResolvedValue(detail);
    api.changeStatus.mockResolvedValue({
      order: detail,
      mail: { sent: false, reason: "not_requested" },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Státusz módosítása" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Státusz módosítása" });
    const box = within(dialog).getByRole("checkbox", {
      name: "Vevő értesítése",
    }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Státusz módosítása" }),
    );
    expect(
      await screen.findByText("A vevő nem kapott levelet (nem kérted)."),
    ).toBeTruthy();
    expect(api.changeStatus).toHaveBeenCalledWith(
      "token",
      "order_38",
      "stocking",
      false,
    );
  });

  it("the history shows each row's mail, and the latest one can be resent", async () => {
    const withMail = {
      ...detail,
      history: [
        {
          at: "2026-10-05T11:21:00.000Z",
          text: "Rendelés létrejött · Feldolgozásra vár",
          mail: {
            status: "sent" as const,
            at: "2026-10-05T11:21:05.000Z",
            resent: 1,
          },
        },
        {
          at: "2026-10-05T11:40:00.000Z",
          text: "Feldolgozásra vár → Visszaigazolva",
          mail: {
            status: "failed" as const,
            at: "2026-10-05T11:40:02.000Z",
            resent: 0,
          },
        },
      ],
    };
    api.detail.mockResolvedValue(withMail);
    api.resendStatusMail.mockResolvedValue({
      order: withMail,
      mail: { sent: true },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Előzmények" });
    // the mail's own send time stands next to its state (the prompt, point 10)
    expect(
      within(card).getByText(
        /^Értesítő elküldve · .*13:21.* \(újraküldve 1×\)$/,
      ),
    ).toBeTruthy();
    expect(
      within(card).getByText(/^Értesítő nem ment ki · .*13:40/),
    ).toBeTruthy();
    fireEvent.click(
      within(card).getByRole("button", { name: "Értesítő újraküldése" }),
    );
    expect(
      await within(card).findByText("A vevő megkapta a státuszlevelet."),
    ).toBeTruthy();
    expect(api.resendStatusMail).toHaveBeenCalledWith("token", "order_38");
  });

  it("without orders.manage there is no resend button", async () => {
    auth.session = session("WAREHOUSE");
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Előzmények" });
    expect(
      within(card).queryByRole("button", { name: "Értesítő újraküldése" }),
    ).toBeNull();
  });

  it("a refusal stays in the dialog with the webshop's reason", async () => {
    api.detail.mockResolvedValue(detail);
    api.changeStatus.mockRejectedValue(
      new Error(
        "A státusz nem változott. A webshop válasza: The shared card payment cannot be captured for 21950 (authorized 17000)",
      ),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Státusz módosítása" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Státusz módosítása" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Státusz módosítása" }),
    );
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /cannot be captured/,
    );
    expect(
      screen.getByRole("dialog", { name: "Státusz módosítása" }),
    ).toBeTruthy();
  });

  it("a final status shows Végállapot, not a button; without orders.manage there is no button", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      status: {
        ...detail.status,
        code: "closed",
        label: "Megrendelés lezárva",
      },
      nextStatuses: [],
    });
    const { unmount } = render(
      createElement(WebshopOrderDetailPage, { id: "order_38" }),
    );
    expect(
      await screen.findByText("Végállapot", { selector: "header > span" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Státusz módosítása" }),
    ).toBeNull();
    unmount();

    auth.session = session("WAREHOUSE");
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    expect(await screen.findByRole("heading", { name: "#38" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Státusz módosítása" }),
    ).toBeNull();
  });

  /**
   * A SZÁMLA (Rendelések, 4. PR). MI PIROSÍT: a gomb nem a rendelés
   * kiállítását hívja; a kiállított számla száma, PDF-je vagy a Számlázás
   * linkje nem látszik; a hiba elveszik; visszaigazolás előtt, vagy a
   * kiállítás joga nélkül (értékesítő) gomb áll; a kiállítás alatti számla
   * mellé új kiállítás-gomb kerül.
   */
  it("issues the invoice, then shows its number, the PDF and the Számlázás link", async () => {
    api.detail.mockResolvedValue(detail);
    api.issueInvoice.mockResolvedValue({
      ...detail,
      invoiceNumber: "TESZT-2026-1A2B3C4D",
      invoice: {
        id: "webshop-order_38",
        status: "ISSUED",
        number: "TESZT-2026-1A2B3C4D",
      },
    });
    billing.pdf.mockResolvedValue(new Blob(["%PDF"]));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:pdf"),
      configurable: true,
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Számla" });
    expect(within(card).getByText("Még nincs kiállított számla.")).toBeTruthy();
    fireEvent.click(
      within(card).getByRole("button", { name: "Számla kiállítása" }),
    );
    // MEGERŐSÍTÉS NÉLKÜL NEM ÍR (acrobot 26827): a gomb csak a dialógust nyitja
    const confirm = screen.getByRole("dialog", { name: "Számla kiállítása" });
    expect(confirm.textContent).toContain("valódi számla készül");
    expect(confirm.textContent).toContain("csak sztornóval");
    expect(api.issueInvoice).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Számla kiállítása" }),
    );
    expect(await within(card).findByText("TESZT-2026-1A2B3C4D")).toBeTruthy();
    expect(api.issueInvoice).toHaveBeenCalledWith("token", "order_38");
    expect(
      within(card)
        .getByRole("link", { name: "Megnyitás a Számlázásban" })
        .getAttribute("href"),
    ).toBe("/penzugy/szamlazas/webshop-order_38");
    expect(
      within(card).queryByRole("button", { name: "Számla kiállítása" }),
    ).toBeNull();
    fireEvent.click(
      within(card).getByRole("button", { name: "PDF megnyitása" }),
    );
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith("blob:pdf", "_blank"),
    );
    expect(billing.pdf).toHaveBeenCalledWith("token", "webshop-order_38");
    open.mockRestore();
  });

  it("a refused issue keeps the reason in the card", async () => {
    api.detail.mockResolvedValue(detail);
    api.issueInvoice.mockRejectedValue(
      new Error(
        "Az OS-partner adatai eltérnek a rendelés számlázási adataitól (cím).",
      ),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Számla" });
    fireEvent.click(
      within(card).getByRole("button", { name: "Számla kiállítása" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Számla kiállítása" }),
      ).getByRole("button", { name: "Számla kiállítása" }),
    );
    expect((await within(card).findByRole("alert")).textContent).toMatch(
      /eltérnek/,
    );
  });

  it("'Mégsem' in the confirmation issues nothing", async () => {
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Számla" });
    fireEvent.click(
      within(card).getByRole("button", { name: "Számla kiállítása" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Számla kiállítása" }),
      ).getByRole("button", { name: "Mégsem" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Számla kiállítása" }),
    ).toBeNull();
    expect(api.issueInvoice).not.toHaveBeenCalled();
  });

  it("no button before confirmation, without billing.issue, or while issuing", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      status: { ...detail.status, code: "pending_processing" },
    });
    const first = render(
      createElement(WebshopOrderDetailPage, { id: "order_38" }),
    );
    let card = await screen.findByRole("region", { name: "Számla" });
    expect(
      within(card).getByText("A számla a visszaigazolás után állítható ki."),
    ).toBeTruthy();
    expect(within(card).queryByRole("button")).toBeNull();
    first.unmount();

    auth.session = salesWithoutBilling();
    api.detail.mockResolvedValue(detail);
    const second = render(
      createElement(WebshopOrderDetailPage, { id: "order_38" }),
    );
    card = await screen.findByRole("region", { name: "Számla" });
    expect(within(card).queryByRole("button")).toBeNull();
    second.unmount();

    auth.session = session("OWNER");
    api.detail.mockResolvedValue({
      ...detail,
      invoice: { id: "webshop-order_38", status: "ISSUING", number: null },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    card = await screen.findByRole("region", { name: "Számla" });
    expect(within(card).getByText(/ellenőrzésre vár/)).toBeTruthy();
    expect(within(card).queryByRole("button")).toBeNull();
    expect(
      within(card).getByRole("link", { name: "Megnyitás a Számlázásban" }),
    ).toBeTruthy();
  });

  /*
    THE DELIVERY NOTE (card 0a14f739 C/1). WHAT TURNS RED: a delivery note
    button before the invoice is issued; the button does not call its own
    endpoint; the issued note's number or PDF does not show; without
    billing.issue a button stands there.
  */
  it("after the invoice, issues the delivery note and opens its PDF", async () => {
    const issued: WebshopOrderDetail = {
      ...detail,
      invoiceNumber: "E-1",
      invoice: { id: "webshop-order_38", status: "ISSUED", number: "E-1" },
    };
    api.detail.mockResolvedValue(issued);
    api.issueDeliveryNote.mockResolvedValue({
      ...issued,
      deliveryNote: {
        id: "webshop-dn-order_38",
        status: "ISSUED",
        number: "TESZT-2026-5E6F7A8B",
      },
    });
    billing.pdf.mockResolvedValue(new Blob(["%PDF"]));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:pdf"),
      configurable: true,
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Számla" });
    fireEvent.click(
      within(card).getByRole("button", { name: "Szállítólevél kiállítása" }),
    );
    const confirm = screen.getByRole("dialog", {
      name: "Szállítólevél kiállítása",
    });
    expect(confirm.textContent).toContain("valódi szállítólevél készül");
    expect(api.issueDeliveryNote).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Szállítólevél kiállítása" }),
    );
    expect(await within(card).findByText("TESZT-2026-5E6F7A8B")).toBeTruthy();
    expect(api.issueDeliveryNote).toHaveBeenCalledWith("token", "order_38");
    expect(
      within(card).queryByRole("button", { name: "Szállítólevél kiállítása" }),
    ).toBeNull();
    fireEvent.click(
      within(card).getByRole("button", { name: "Szállítólevél PDF" }),
    );
    await vi.waitFor(() =>
      expect(billing.pdf).toHaveBeenCalledWith("token", "webshop-dn-order_38"),
    );
    open.mockRestore();
  });

  it("no delivery note button before the invoice, or without billing.issue", async () => {
    api.detail.mockResolvedValue(detail);
    const first = render(
      createElement(WebshopOrderDetailPage, { id: "order_38" }),
    );
    let card = await screen.findByRole("region", { name: "Számla" });
    expect(within(card).queryByText(/Szállítólevél/)).toBeNull();
    first.unmount();

    auth.session = salesWithoutBilling();
    api.detail.mockResolvedValue({
      ...detail,
      invoiceNumber: "E-1",
      invoice: { id: "webshop-order_38", status: "ISSUED", number: "E-1" },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    card = await screen.findByRole("region", { name: "Számla" });
    expect(within(card).getByText("Nincs szállítólevél.")).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: "Szállítólevél kiállítása" }),
    ).toBeNull();
  });

  /**
   * A CSOMAG (Rendelések, 5. PR). MI PIROSÍT: számla előtt gomb áll; a méret
   * nem megy a kéréssel; a levél sorsa nem látszik; a csomagszám vagy a címke
   * nem jelenik meg; a teszt-csomag valódinak látszik; a bizonytalan
   * foglalásnál új „Csomag feladása” gomb áll a feloldás helyett; a szállító
   * hibája elveszik; kezelési jog nélkül gomb áll.
   */
  const invoiced: WebshopOrderDetail = {
    ...detail,
    invoiceNumber: "E-1",
    invoice: { id: "webshop-order_38", status: "ISSUED", number: "E-1" },
  };
  const withParcel = (
    parcel: Partial<NonNullable<WebshopOrderDetail["parcel"]>>,
  ) => ({
    ...invoiced,
    parcel: {
      carrier: "FOXPOST" as const,
      reference: "38",
      parcelNumber: "CLFOX0000012345",
      stub: false,
      size: "m",
      codHuf: null,
      createdAt: "2026-10-05T12:00:00.000Z",
      trackingUrl: null,
      ...parcel,
    },
  });

  /*
    THE BUTTON STANDS THERE, HELD, AND SAYS WHY (the prompt, point 6): before
    the invoice, and when the parcel would miss something (a phone, an
    address), the reason shows before anyone presses it.
  */
  it("before the invoice the parcel button is held, with the reason", async () => {
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Szállítás" });
    expect(
      within(card).getByText(
        "Előbb állítsd ki a számlát, utána adható fel a csomag.",
      ),
    ).toBeTruthy();
    const button = within(card).getByRole("button", {
      name: "Csomag feladása",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Előbb állítsd ki a számlát");
  });

  it("a parcel that would miss data is held before it is pressed; the COD shows on the form", async () => {
    api.detail.mockResolvedValue({
      ...invoiced,
      dispatchPreview: {
        ready: false,
        reason:
          "A címzettből hiányzik: telefonszám. A szállító enélkül nem veszi fel a csomagot.",
        codHuf: null,
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Szállítás" });
    expect(
      await within(card).findByText(/A címzettből hiányzik: telefonszám/),
    ).toBeTruthy();
    expect(
      (
        within(card).getByRole("button", {
          name: "Csomag feladása",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    cleanup();

    api.detail.mockResolvedValue({
      ...invoiced,
      dispatchPreview: { ready: true, reason: null, codHuf: 20840 },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const ready = await screen.findByRole("region", { name: "Szállítás" });
    expect(await within(ready).findByText(/Utánvét a csomagon/)).toBeTruthy();
    expect(within(ready).getByText("20 840 Ft")).toBeTruthy();
  });

  it("creates the parcel with the chosen size, then shows its number, the mail and the label", async () => {
    api.detail.mockResolvedValue(invoiced);
    api.createParcel.mockResolvedValue({
      order: withParcel({}),
      notice: { sent: true },
    });
    api.parcelLabel.mockResolvedValue(new Blob(["%PDF"]));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:label"),
      configurable: true,
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Szállítás" });
    fireEvent.change(
      within(card).getByRole("combobox", { name: "Csomagméret" }),
      {
        target: { value: "m" },
      },
    );
    fireEvent.click(
      within(card).getByRole("button", { name: "Csomag feladása" }),
    );
    expect(await within(card).findByText("CLFOX0000012345")).toBeTruthy();
    expect(api.createParcel).toHaveBeenCalledWith("token", "order_38", "m");
    expect(within(card).getByRole("status").textContent).toMatch(
      /Feladtuk a csomagodat/,
    );
    fireEvent.click(
      within(card).getByRole("button", { name: "Címke nyomtatása" }),
    );
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith("blob:label", "_blank"),
    );
    expect(api.parcelLabel).toHaveBeenCalledWith("token", "order_38");
    open.mockRestore();
  });

  it("a carrier refusal stays in the card", async () => {
    api.detail.mockResolvedValue(invoiced);
    api.createParcel.mockRejectedValue(
      new Error(
        "Érvénytelen átvételi pont. Frissítsd a pontot és próbáld újra.",
      ),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Szállítás" });
    fireEvent.click(
      within(card).getByRole("button", { name: "Csomag feladása" }),
    );
    expect((await within(card).findByRole("alert")).textContent).toMatch(
      /Érvénytelen átvételi pont/,
    );
  });

  it("an uncertain parcel offers the release, not a new parcel", async () => {
    api.detail.mockResolvedValue(withParcel({ parcelNumber: null }));
    api.releaseParcel.mockResolvedValue(invoiced);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Szállítás" });
    expect(within(card).getByText(/eredménye bizonytalan/)).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: "Csomag feladása" }),
    ).toBeNull();
    fireEvent.click(
      within(card).getByRole("button", { name: "Létrehozás újraengedése" }),
    );
    expect(
      await within(card).findByRole("button", { name: "Csomag feladása" }),
    ).toBeTruthy();
    expect(api.releaseParcel).toHaveBeenCalledWith("token", "order_38");
  });

  it("a stub parcel says so; without orders.manage there is no parcel button", async () => {
    auth.session = session("WAREHOUSE");
    api.detail.mockResolvedValue(
      withParcel({ parcelNumber: "STUB-FOXPOST-1", stub: true }),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Szállítás" });
    expect(within(card).getByText("Teszt-csomag")).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: /Címke|Csomag feladása/ }),
    ).toBeNull();
  });

  /**
   * A TÉTELMŰVELETEK ÉS A SZÉTBONTÁS-KIJELÖLÉS (Rendelések, 6. PR). MI
   * PIROSÍT: a mennyiség, a csere vagy a törlés nem a választott tételre és
   * értékkel megy; a webshop elutasítása elveszik; tiltott állapotban ikon áll,
   * vagy nem látszik, miért tiltott; a „Szétbontás” kijelölés nélkül is áll,
   * vagy nem a kijelölt tételeket mutatja; kezelési jog nélkül művelet áll.
   */
  const twoLines: WebshopOrderDetail = {
    ...detail,
    lines: [
      ...detail.lines,
      {
        id: "i2",
        title: "Coral Food",
        variantTitle: "100 ml",
        sku: "CF-100",
        quantity: 2,
        unitPrice: 3000,
        total: 6000,
      },
    ],
  };

  it("a quantity goes to the chosen line with the new value", async () => {
    api.detail.mockResolvedValue(twoLines);
    api.editLine.mockResolvedValue(twoLines);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const items = await screen.findByRole("region", { name: "Tételek" });
    fireEvent.click(
      within(items).getAllByRole("button", {
        name: "Mennyiség módosítása",
      })[1]!,
    );
    const dialog = screen.getByRole("dialog", { name: "Mennyiség módosítása" });
    fireEvent.change(within(dialog).getByLabelText("Új mennyiség"), {
      target: { value: "1" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mentés" }));
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Mennyiség módosítása" }),
      ).toBeNull(),
    );
    expect(api.editLine).toHaveBeenCalledWith("token", "order_38", "i2", {
      kind: "quantity",
      quantity: 1,
    });
  });

  it("a removal asks first; the webshop's refusal stays in the dialog", async () => {
    api.detail.mockResolvedValue(twoLines);
    api.editLine.mockRejectedValue(
      new Error(
        "A tétel nem változott. A webshop válasza: A szerkesztés után a rendelés többe kerül",
      ),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const items = await screen.findByRole("region", { name: "Tételek" });
    fireEvent.click(
      within(items).getAllByRole("button", { name: "Tétel törlése" })[0]!,
    );
    const dialog = screen.getByRole("dialog", { name: "Tétel törlése" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Törlés" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /többe kerül/,
    );
    expect(api.editLine).toHaveBeenCalledWith("token", "order_38", "i1", {
      kind: "remove",
    });
  });

  it("a replacement searches, takes the picked variant and the quantity", async () => {
    api.detail.mockResolvedValue(twoLines);
    api.replacementVariants.mockResolvedValue([
      { variantId: "v1", title: "Reef Salt Pro 25 kg", sku: "RSP-25" },
    ]);
    api.editLine.mockResolvedValue(twoLines);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const items = await screen.findByRole("region", { name: "Tételek" });
    fireEvent.click(
      within(items).getAllByRole("button", { name: "Termék cseréje" })[0]!,
    );
    const dialog = screen.getByRole("dialog", { name: "Termék cseréje" });
    fireEvent.change(within(dialog).getByLabelText("Termék keresése"), {
      target: { value: "reef" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keresés" }));
    fireEvent.click(
      await within(dialog).findByRole("radio", { name: /Reef Salt Pro 25 kg/ }),
    );
    fireEvent.change(within(dialog).getByLabelText("Mennyiség"), {
      target: { value: "2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Csere" }));
    await vi.waitFor(() =>
      expect(api.editLine).toHaveBeenCalledWith("token", "order_38", "i1", {
        kind: "replace",
        variantId: "v1",
        quantity: 2,
      }),
    );
    expect(api.replacementVariants).toHaveBeenCalledWith(
      "token",
      "order_38",
      "reef",
    );
  });

  it("when the lines cannot change, the icons go and the reason shows; selecting still works", async () => {
    api.detail.mockResolvedValue({
      ...twoLines,
      lineEdit: {
        allowed: false,
        reason:
          "A számla már ki van állítva: a tétel csak a számla sztornója után módosítható.",
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const items = await screen.findByRole("region", { name: "Tételek" });
    expect(within(items).getByText(/sztornója után/)).toBeTruthy();
    expect(
      within(items).queryByRole("button", {
        name: /Mennyiség|cseréje|törlése/,
      }),
    ).toBeNull();
    expect(within(items).getAllByRole("checkbox")).toHaveLength(2);
  });

  it("Szétbontás appears only with a selection, and shows the selected lines", async () => {
    api.detail.mockResolvedValue(twoLines);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const items = await screen.findByRole("region", { name: "Tételek" });
    expect(
      within(items).queryByRole("button", { name: "Szétbontás" }),
    ).toBeNull();
    const box = within(items).getByRole("checkbox", {
      name: "Coral Food kijelölése",
    });
    fireEvent.click(box);
    fireEvent.click(within(items).getByRole("button", { name: "Szétbontás" }));
    const dialog = screen.getByRole("dialog", { name: "Szétbontás" });
    const list = within(dialog).getByRole("list", { name: "Kijelölt tételek" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(
      (
        within(list).getByRole("spinbutton", {
          name: "Coral Food: bontandó mennyiség",
        }) as HTMLInputElement
      ).value,
    ).toBe("2");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mégse" }));
    fireEvent.click(box);
    expect(
      within(items).queryByRole("button", { name: "Szétbontás" }),
    ).toBeNull();
  });

  /*
    THE SPLIT (card 0a14f739 C/3). WHAT TURNS RED: the chosen quantity or the
    request id does not go out; a retry gets a new request id (a lost answer
    would split twice); the whole order or an out-of-range quantity can be
    sent; the new order is not named and linked; the webshop's refusal is
    lost; a held split still offers the button; the page does not show
    which order it was split from or into.
  */
  it("sends the chosen quantity with one request id, then names and links the new order", async () => {
    api.detail.mockResolvedValue(twoLines);
    api.split
      .mockRejectedValueOnce(new Error("A webshop nem érhető el (HTTP 503)."))
      .mockResolvedValueOnce({
        order: twoLines,
        created: {
          id: "order_39",
          displayId: 39,
          total: 3000,
          awaitingPayment: true,
        },
      });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const items = await screen.findByRole("region", { name: "Tételek" });
    fireEvent.click(
      within(items).getByRole("checkbox", { name: "Coral Food kijelölése" }),
    );
    fireEvent.click(within(items).getByRole("button", { name: "Szétbontás" }));
    const dialog = screen.getByRole("dialog", { name: "Szétbontás" });
    fireEvent.change(
      within(dialog).getByRole("spinbutton", {
        name: "Coral Food: bontandó mennyiség",
      }),
      { target: { value: "1" } },
    );
    const submit = within(dialog).getByRole("button", { name: "Szétbontás" });
    fireEvent.click(submit);
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /HTTP 503/,
    );
    fireEvent.click(submit);
    const link = await within(dialog).findByRole("link", {
      name: "Az új rendelés megnyitása",
    });
    expect(link.getAttribute("href")).toBe("/webshop/rendelesek/order_39");
    expect(within(dialog).getByText(/#39/)).toBeTruthy();
    expect(within(dialog).getByText(/fizetésre vár/).textContent).toMatch(
      /adatlapjáról küldd, amikor kiszállítható/,
    );
    expect(api.split).toHaveBeenCalledTimes(2);
    const [first, second] = api.split.mock.calls;
    expect(first?.[2]).toEqual({
      lines: [{ itemId: "i2", quantity: 1 }],
      requestId: expect.any(String),
    });
    expect(second?.[2]).toEqual(first?.[2]);
  });

  it("the whole order or an out-of-range quantity cannot be sent", async () => {
    api.detail.mockResolvedValue(twoLines);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const items = await screen.findByRole("region", { name: "Tételek" });
    for (const name of [
      "Reef Salt Pro 20 kg kijelölése",
      "Coral Food kijelölése",
    ])
      fireEvent.click(within(items).getByRole("checkbox", { name }));
    fireEvent.click(within(items).getByRole("button", { name: "Szétbontás" }));
    const dialog = screen.getByRole("dialog", { name: "Szétbontás" });
    const submit = within(dialog).getByRole("button", { name: "Szétbontás" });
    expect(within(dialog).getByText(/nem bontás/)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const coral = within(dialog).getByRole("spinbutton", {
      name: "Coral Food: bontandó mennyiség",
    });
    fireEvent.change(coral, { target: { value: "3" } });
    expect(
      within(dialog).getByText(
        "Coral Food: 1 és 2 közötti mennyiség bontható.",
      ),
    ).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(coral, { target: { value: "1" } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("a held split names why and offers no button; the page shows the split's two ends", async () => {
    api.detail.mockResolvedValue({
      ...twoLines,
      splitEdit: {
        allowed: false,
        reason:
          "A számla már ki van állítva: a tétel csak a számla sztornója után módosítható.",
      },
      split: {
        from: { id: "order_30", displayId: 30 },
        into: [
          { id: "order_39", displayId: 39 },
          { id: "order_40", displayId: null },
        ],
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    expect(
      (await screen.findByRole("link", { name: "#30" })).getAttribute("href"),
    ).toBe("/webshop/rendelesek/order_30");
    expect(screen.getByRole("link", { name: "#39" }).getAttribute("href")).toBe(
      "/webshop/rendelesek/order_39",
    );
    expect(
      screen
        .getByRole("link", { name: "kapcsolt rendelés" })
        .getAttribute("href"),
    ).toBe("/webshop/rendelesek/order_40");
    const items = screen.getByRole("region", { name: "Tételek" });
    fireEvent.click(
      within(items).getByRole("checkbox", { name: "Coral Food kijelölése" }),
    );
    fireEvent.click(within(items).getByRole("button", { name: "Szétbontás" }));
    const dialog = screen.getByRole("dialog", { name: "Szétbontás" });
    expect(within(dialog).getByText(/számla sztornója után/)).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: "Szétbontás" }),
    ).toBeNull();
  });

  /*
    FÉLBEMARADT SZÉTBONTÁS (acrobot 26807, commerce #504). MI PIROSÍT: ha nem
    látszik, hogy a tétel már kikerült innen; ha a befejezés a kijelölést
    vagy egy új azonosítót küldene a rekordé helyett; ha a gomb tartott
    bontásnál is megjelenne.
  */
  it("a split left half done is shown with its lines, and 'Szétbontás befejezése' sends its record", async () => {
    const unfinished = {
      requestId: "req-half",
      lines: [{ itemId: "item_gone", title: "Hanna HI780-25", quantity: 1 }],
    };
    api.detail.mockResolvedValue({
      ...twoLines,
      split: { from: null, into: [], unfinished },
    });
    api.split.mockResolvedValue({
      order: {
        ...twoLines,
        split: { from: null, into: [{ id: "order_53", displayId: 53 }] },
      },
      created: {
        id: "order_53",
        displayId: 53,
        total: 10500,
        awaitingPayment: true,
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const notice = await screen.findByTestId("unfinished-split");
    expect(notice.textContent).toContain("Félbemaradt szétbontás");
    expect(notice.textContent).toContain("Hanna HI780-25 (1 db)");
    fireEvent.click(
      within(notice).getByRole("button", { name: "Szétbontás befejezése" }),
    );
    await waitFor(() => expect(api.split).toHaveBeenCalledTimes(1));
    expect(api.split.mock.calls[0]!.slice(1)).toEqual([
      "order_38",
      { requestId: "req-half", lines: [{ itemId: "item_gone", quantity: 1 }] },
    ]);
    await waitFor(() =>
      expect(screen.queryByTestId("unfinished-split")).toBeNull(),
    );
  });

  it("a half split on an order that may not be edited is shown, but offers no button", async () => {
    api.detail.mockResolvedValue({
      ...twoLines,
      splitEdit: { allowed: false, reason: "A számla már ki van állítva." },
      split: {
        from: null,
        into: [],
        unfinished: {
          requestId: "req-half",
          lines: [
            { itemId: "item_gone", title: "Hanna HI780-25", quantity: 1 },
          ],
        },
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const notice = await screen.findByTestId("unfinished-split");
    expect(within(notice).queryByRole("button")).toBeNull();
  });

  it("without orders.manage there is no selection and no line action", async () => {
    auth.session = session("WAREHOUSE");
    api.detail.mockResolvedValue(twoLines);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const items = await screen.findByRole("region", { name: "Tételek" });
    expect(within(items).queryByRole("checkbox")).toBeNull();
    expect(
      within(items).queryByRole("button", {
        name: /Mennyiség|cseréje|törlése/,
      }),
    ).toBeNull();
  });

  /**
   * A LEJÁRÓ KÁRTYÁS ZÁROLÁS (Balázs döntése, 2026-10-05). MI PIROSÍT: az 5.
   * naptól nincs jelzés; a „Csúszik a szállítás” nem a jelölő szerint értesít,
   * vagy kérdés nélkül old fel; a link nem a rendelés mostani összegét mondja;
   * a link adatai nem látszanak; kezelési jog nélkül gomb áll.
   */
  const card = (
    over: Partial<NonNullable<WebshopOrderDetail["cardPayment"]>>,
  ): WebshopOrderDetail => ({
    ...detail,
    cardPayment: {
      state: "hold",
      holdExpiresAt: "2026-10-07T10:00:00.000Z",
      holdWarning: "soon",
      link: null,
      paidAt: null,
      due: null,
      canRelease: true,
      canSendLink: false,
      ...over,
    },
  });

  it("warns from the 5th day, and Csúszik a szállítás asks first, then releases with the notify choice", async () => {
    api.detail.mockResolvedValue(card({}));
    api.releaseHold.mockResolvedValue({
      order: card({
        state: "awaiting_payment",
        holdWarning: null,
        holdExpiresAt: null,
        canRelease: false,
        canSendLink: true,
      }),
      mail: { sent: false, reason: "not_requested" },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const pay = await screen.findByRole("region", { name: "Fizetés" });
    expect(within(pay).getByRole("alert").textContent).toMatch(
      /2 napon belül lejár/,
    );
    fireEvent.click(
      within(pay).getByRole("button", { name: "Csúszik a szállítás" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Csúszik a szállítás" });
    expect(within(dialog).getByText(/kártyáját nem terheljük/)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "Vevő értesítése" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Zárolás feloldása" }),
    );
    expect(await within(pay).findByText("Fizetésre vár")).toBeTruthy();
    expect(api.releaseHold).toHaveBeenCalledWith("token", "order_38", false);
    expect(within(pay).getByRole("status").textContent).toMatch(/nem kérted/);
  });

  it("the payment link names the order's current total, sends, and shows the link", async () => {
    // egy tétel kiesett: a végösszeg (18 500) kisebb, mint a zárolt összeg (20 840)
    api.detail.mockResolvedValue({
      ...card({
        state: "awaiting_payment",
        holdWarning: null,
        holdExpiresAt: null,
        canRelease: false,
        canSendLink: true,
      }),
      totals: { ...detail.totals, total: 18500 },
    });
    api.sendPaymentLink.mockResolvedValue({
      order: card({
        state: "link_sent",
        holdWarning: null,
        holdExpiresAt: null,
        canRelease: false,
        canSendLink: true,
        link: {
          sentAt: "2026-10-09T08:00:00.000Z",
          expiresAt: "2026-10-12T08:00:00.000Z",
          remindedAt: null,
          amount: 20840,
          url: "https://shop.example/fizetes/tok",
        },
      }),
      mail: { sent: true },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const pay = await screen.findByRole("region", { name: "Fizetés" });
    fireEvent.click(
      within(pay).getByRole("button", { name: "Fizetési link küldése" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Fizetési link küldése",
    });
    expect(
      within(dialog).getByText(/mostani végösszegére szól: 18 500 Ft/),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Link küldése" }),
    );
    expect(
      await within(pay).findByText("https://shop.example/fizetes/tok"),
    ).toBeTruthy();
    expect(api.sendPaymentLink).toHaveBeenCalledWith("token", "order_38", true);
  });

  it("an added line over the hold: the link is for the difference, and says the hold stays", async () => {
    api.detail.mockResolvedValue(
      card({
        state: "awaiting_payment",
        holdWarning: null,
        canRelease: false,
        canSendLink: true,
        due: { amount: 3500, reason: "difference" },
      }),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const pay = await screen.findByRole("region", { name: "Fizetés" });
    expect(within(pay).getByText("Különbözet, fizetendő")).toBeTruthy();
    fireEvent.click(
      within(pay).getByRole("button", { name: "Fizetési link küldése" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Fizetési link küldése",
    });
    expect(
      within(dialog).getByText(
        /különbözetére szól: 3500 Ft\. A kártyás zárolás megmarad/,
      ),
    ).toBeTruthy();
  });

  it("without orders.manage the state shows, the buttons do not", async () => {
    auth.session = session("WAREHOUSE");
    api.detail.mockResolvedValue(card({}));
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const pay = await screen.findByRole("region", { name: "Fizetés" });
    expect(within(pay).getByText("Kártyás fizetés")).toBeTruthy();
    expect(within(pay).getByRole("alert").textContent).toMatch(
      /2 napon belül lejár/,
    );
    expect(
      within(pay).queryByRole("button", { name: /Csúszik|Fizetési link/ }),
    ).toBeNull();
  });

  /**
   * AZ ADATLAP CERUZÁI (Figma 494:386; acrobot 26502). MI PIROSÍT: a
   * számlázási cím ceruzája nem a számlázási címet szerkeszti, vagy nem a
   * meglévő adatokkal nyílik; a tiltott szerkesztés ceruzája kattintható, vagy
   * nem mondja meg, miért tiltott; a „Vevő adatlapja” nem az OS-partnerre
   * visz; a belső megjegyzés nem menthető; kezelési jog nélkül ceruza áll.
   */
  it("the billing pencil opens the address as it is, and saves the edited one", async () => {
    api.detail.mockResolvedValue(detail);
    api.updateAddress.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Számlázási cím szerkesztése",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Számlázási cím" });
    expect(
      (within(dialog).getByLabelText("Utca, házszám") as HTMLInputElement)
        .value,
    ).toBe("Fehérvári út 24.");
    fireEvent.change(within(dialog).getByLabelText("Adószám"), {
      target: { value: "12345678-2-41" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mentés" }));
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Számlázási cím" }),
      ).toBeNull(),
    );
    expect(api.updateAddress).toHaveBeenCalledWith("token", "order_38", {
      ...detail.billingAddress!.fields,
      kind: "billing",
      taxNumber: "12345678-2-41",
    });
  });

  it("a held address's pencil is disabled and says why", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      addressEdit: {
        billing: {
          allowed: false,
          reason:
            "A számla már ki van állítva ezzel a címmel: a cím csak a számla sztornója után változhat.",
        },
        shipping: { allowed: true, reason: null },
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const pencil = (await screen.findByRole("button", {
      name: "Számlázási cím szerkesztése",
    })) as HTMLButtonElement;
    expect(pencil.disabled).toBe(true);
    expect(pencil.title).toMatch(/sztornója után/);
  });

  it("Vevő adatlapja goes to the OS partner; the internal note saves", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      osCustomer: {
        id: "cust_1",
        customerNumber: "VEVO-0042",
        displayName: "Nagy Emese",
      },
    });
    api.saveInternalNote.mockResolvedValue({
      ...detail,
      internalNote: {
        text: "Első rendelése.",
        updatedAt: "2026-10-05T19:00:00.000Z",
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    expect(
      (
        await screen.findByRole("link", { name: "Vevő adatlapja" })
      ).getAttribute("href"),
    ).toBe("/vevok?search=VEVO-0042");
    fireEvent.click(
      screen.getByRole("button", { name: "Belső megjegyzés szerkesztése" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Belső megjegyzés" });
    fireEvent.change(within(dialog).getByLabelText("Belső megjegyzés"), {
      target: { value: "Első rendelése." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText("Első rendelése.")).toBeTruthy();
    expect(api.saveInternalNote).toHaveBeenCalledWith(
      "token",
      "order_38",
      "Első rendelése.",
    );
  });

  it("a FOXPOST order shows the official logo as its carrier", async () => {
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Szállítás" });
    expect(
      within(card).getByRole("img", { name: "FOXPOST" }).getAttribute("src"),
    ).toBe("/images/foxpost-packeta-group.png");
  });

  it("a Foxpost point's type shows under the shipping, in the customer's words", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      shipping: {
        ...detail.shipping,
        pickupPoint: { ...detail.shipping.pickupPoint!, type: "Packeta Z-BOX" },
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", {
      name: "Számlázási és szállítási adatok",
    });
    expect(within(card).getByText("Packeta Z-BOX")).toBeTruthy();
  });

  it("a GLS ParcelShop order names the kind of its point (GLS prompt, point 11)", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      shipping: {
        method: "GLS csomagpont",
        storePickup: false,
        carrier: "GLS",
        pickupPoint: {
          id: "2351-CSOMAGPONT",
          name: "Mammut",
          address: null,
          kind: "parcel-shop",
          type: null,
        },
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", {
      name: "Számlázási és szállítási adatok",
    });
    expect(within(card).getByText("GLS ParcelShop")).toBeTruthy();
  });

  /*
    THE GLS LOGO ON THE SHIPPING CARD (commerce #489's files): by the parcel's
    kind, so the counter does not hand a locker parcel over as a point.
  */
  for (const [point, src, alt] of [
    [null, "/images/gls.png", "GLS"],
    [
      {
        id: "L1",
        name: "GLS Automata Allee",
        address: null,
        kind: "parcel-locker",
      },
      "/images/gls-automata.png",
      "GLS Automata",
    ],
    [
      { id: "S1", name: "Mammut", address: null, kind: "parcel-shop" },
      "/images/gls-csomagpont.png",
      "GLS Csomagpont",
    ],
  ] as const)
    it(`the shipping card shows the ${alt} logo`, async () => {
      api.detail.mockResolvedValue({
        ...detail,
        shipping: {
          method: point ? "GLS csomagpont" : "GLS házhozszállítás",
          storePickup: false,
          carrier: "GLS",
          pickupPoint: point,
        },
      });
      render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
      const card = await screen.findByRole("region", { name: "Szállítás" });
      expect(within(card).getByAltText(alt).getAttribute("src")).toBe(src);
    });

  /*
    THE POINT AND THE NOTES (commerce #494, #493). WHAT TURNS RED: the point
    pencil is missing or ignores its reason; the dialog saves without a
    choice, offers an out-of-order locker, or does not send the chosen point;
    a note is sent under the other note's name, or the 50-character courier
    note can be saved longer.
  */
  /*
    THE SHIPPING METHOD CHANGE (card 0a14f739 C/2). WHAT TURNS RED: the
    methods do not show their new fee; a point method can be saved without a
    point, or its points are asked from the order's own method; the method
    and the point do not go together; the difference and the link's fate do
    not show; a held change still opens; a store pickup order gets a pencil.
  */
  it("a point method searches its own points, and the method and point go together", async () => {
    api.detail.mockResolvedValue(detail);
    api.shippingOptions.mockResolvedValue({
      currentOptionId: "so_fox",
      options: [
        {
          id: "so_fox",
          name: "Foxpost automata",
          amount: 990,
          carrier: "FOXPOST",
          needsPoint: true,
          heavy: false,
        },
        {
          id: "so_gls_point",
          name: "GLS csomagpont",
          amount: 1490,
          carrier: "GLS",
          needsPoint: true,
          heavy: false,
        },
      ],
    });
    api.shippingOptionPoints.mockResolvedValue({
      carrier: "GLS",
      currentPointId: null,
      count: 1,
      points: [
        {
          id: "S1",
          name: "GLS Mammut",
          address: "1024 Budapest, Lövőház u. 2-6.",
          kind: "parcel-shop",
          variant: null,
          outOfOrder: false,
        },
      ],
    });
    api.changeShippingMethod.mockResolvedValue({
      order: detail,
      change: {
        changed: true,
        previousTotal: 20840,
        total: 21340,
        difference: 500,
        link: { sent: true },
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Szállítási mód cseréje" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Szállítási mód cseréje",
    });
    const save = within(dialog).getByRole("button", {
      name: "Mentés",
    }) as HTMLButtonElement;
    fireEvent.click(
      await within(dialog).findByRole("radio", { name: /GLS csomagpont/ }),
    );
    expect(within(dialog).getByText(/1490 Ft|1 490 Ft/)).toBeTruthy();
    expect(within(dialog).getByText(/500 Ft összeggel nő/)).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Csomagpont keresése"), {
      target: { value: "mammut" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keresés" }));
    await waitFor(() =>
      expect(api.shippingOptionPoints).toHaveBeenCalledWith(
        "token",
        "order_38",
        "so_gls_point",
        "mammut",
      ),
    );
    expect(api.pickupPoints).not.toHaveBeenCalled();
    fireEvent.click(
      await within(dialog).findByRole("radio", { name: /GLS Mammut/ }),
    );
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.changeShippingMethod).toHaveBeenCalledWith(
        "token",
        "order_38",
        { optionId: "so_gls_point", pointId: "S1" },
      ),
    );
    expect((await screen.findByRole("status")).textContent).toMatch(
      /500 Ft összeggel nőtt. A vevő fizetési linket kapott/,
    );
  });

  it("a held change names why; a store pickup order has no method pencil", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      methodEdit: {
        allowed: false,
        reason:
          "A csomag már fel van adva: a mód csak a csomag lemondása után cserélhető.",
      },
    });
    const first = render(
      createElement(WebshopOrderDetailPage, { id: "order_38" }),
    );
    const pencil = (await screen.findByRole("button", {
      name: "Szállítási mód cseréje",
    })) as HTMLButtonElement;
    expect(pencil.disabled).toBe(true);
    expect(pencil.title).toMatch(/csomag lemondása után/);
    first.unmount();

    api.detail.mockResolvedValue({
      ...detail,
      shipping: { ...detail.shipping, storePickup: true, pickupPoint: null },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    await screen.findByRole("region", { name: "Tételek" });
    expect(
      screen.queryByRole("button", { name: "Szállítási mód cseréje" }),
    ).toBeNull();
  });

  it("the method change sentence: fall, rise without a card, and a link that did not go", () => {
    expect(
      methodChangeText({
        changed: true,
        previousTotal: 2000,
        total: 1500,
        difference: -500,
        link: null,
      }),
    ).toMatch(/500 Ft összeggel csökkent. Új fizetés nem kell/);
    expect(
      methodChangeText({
        changed: true,
        previousTotal: 1500,
        total: 2000,
        difference: 500,
        link: { sent: false, reason: "failed" },
      }),
    ).toMatch(/nem ment ki: a Fizetési link küldése gombbal/);
    expect(
      methodChangeText({
        changed: false,
        previousTotal: 1500,
        total: 1500,
        difference: 0,
        link: null,
      }),
    ).toBe("A szállítási mód nem változott.");
  });

  it("the point pencil searches the order's own list and sends the chosen point", async () => {
    api.detail.mockResolvedValue(detail);
    api.pickupPoints.mockResolvedValue({
      carrier: "FOXPOST",
      currentPointId: "hu1",
      count: 2,
      points: [
        {
          id: "hu1",
          name: "FOXPOST Allee",
          address: "1117 Budapest, Október 23. u. 8.",
          kind: null,
          variant: "FOXPOST A-BOX",
          outOfOrder: false,
        },
        {
          id: "hu2",
          name: "FOXPOST Etele",
          address: "1119 Budapest, Etele út 68.",
          kind: null,
          variant: "FOXPOST Z-BOX",
          outOfOrder: false,
        },
      ],
    });
    api.changePoint.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Csomagpont cseréje" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Csomagpont cseréje" });
    const save = within(dialog).getByRole("button", {
      name: "Mentés",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Csomagpont keresése"), {
      target: { value: "etele" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keresés" }));
    await waitFor(() =>
      expect(api.pickupPoints).toHaveBeenCalledWith(
        "token",
        "order_38",
        "etele",
      ),
    );
    const etele = await within(dialog).findByRole("radio", {
      name: /FOXPOST Etele/,
    });
    // a Z-BOX a vevő szavaival, ahogy a kirakat írja (commerce #498)
    expect(etele.closest("label")?.textContent).toContain("Packeta Z-BOX");
    expect(etele.closest("label")?.textContent).not.toContain("FOXPOST Z-BOX");
    fireEvent.click(etele);
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.changePoint).toHaveBeenCalledWith("token", "order_38", "hu2"),
    );
  });

  it("a held point names why, and an out-of-order locker cannot be chosen", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      pointEdit: {
        allowed: false,
        reason: "A csomag már fel van adva erre a pontra.",
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const pencil = (await screen.findByRole("button", {
      name: "Csomagpont cseréje",
    })) as HTMLButtonElement;
    expect(pencil.disabled).toBe(true);
    expect(pencil.title).toBe("A csomag már fel van adva erre a pontra.");
    cleanup();

    api.detail.mockResolvedValue(detail);
    api.pickupPoints.mockResolvedValue({
      carrier: "GLS",
      currentPointId: null,
      count: 1,
      points: [
        {
          id: "L1",
          name: "GLS Automata",
          address: "1024 Budapest",
          kind: "parcel-locker",
          variant: null,
          outOfOrder: true,
        },
      ],
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Csomagpont cseréje" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Csomagpont cseréje" });
    fireEvent.change(within(dialog).getByLabelText("Csomagpont keresése"), {
      target: { value: "a" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keresés" }));
    const radio = (await within(dialog).findByRole("radio", {
      name: /GLS Automata/,
    })) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(within(dialog).getByText(/üzemen kívül/)).toBeTruthy();
  });

  it("each note goes under its own name; the courier note stops at 50", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      notes: { customer: "Délután otthon vagyok.", carrier: null },
    });
    api.saveNotes.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    expect(await screen.findByText("Délután otthon vagyok.")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "A szállítónak szóló üzenet szerkesztése",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Szállítónak" });
    const box = within(dialog).getByLabelText("Szállítónak");
    const save = within(dialog).getByRole("button", {
      name: "Mentés",
    }) as HTMLButtonElement;
    fireEvent.change(box, { target: { value: "x".repeat(51) } });
    expect(save.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "Csengess kétszer" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.saveNotes).toHaveBeenCalledWith("token", "order_38", {
        carrierNote: "Csengess kétszer",
      }),
    );
  });

  it("the customer's earlier failed orders and other open order show on the page too", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      customer: {
        ...detail.customer,
        unsuccessfulOrderCount: 2,
        hasOtherOpenOrder: true,
      },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    expect(
      await screen.findByText(/2 korábbi sikertelen\s+rendelés/),
    ).toBeTruthy();
    expect(screen.getByText(/van másik nyitott rendelése/)).toBeTruthy();
  });

  /*
    THE PARCEL'S TRACKING (the prompt, point 7). WHAT TURNS RED: the carrier's
    last state does not show; refresh does not ask again; a carrier error
    hides instead of saying so; a link appears without a configured address.
  */
  it("a parcel shows the carrier's last state, refreshes, and links out only when configured", async () => {
    api.detail.mockResolvedValue(withParcel({}));
    api.parcelTracking.mockResolvedValue({
      events: [
        {
          status: "HDINTRANSIT",
          text: "Úton a címzetthez",
          at: "2026-10-06T08:00:00.000Z",
        },
        {
          status: "CREATE",
          text: "Létrehozva",
          at: "2026-10-05T10:00:00.000Z",
        },
      ],
      checkedAt: "2026-10-06T09:00:00.000Z",
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Szállítás" });
    expect(await within(card).findByText("Úton a címzetthez")).toBeTruthy();
    expect(within(card).queryByText("Létrehozva")).toBeNull();
    expect(
      within(card).queryByRole("link", { name: "Követés a szállító oldalán" }),
    ).toBeNull();
    fireEvent.click(
      within(card).getByRole("button", { name: "Csomagkövetés frissítése" }),
    );
    await waitFor(() => expect(api.parcelTracking).toHaveBeenCalledTimes(2));
    cleanup();

    api.detail.mockResolvedValue(
      withParcel({ trackingUrl: "https://track.example/?code=CLFOX1" }),
    );
    api.parcelTracking.mockRejectedValue(
      new Error("A szállító most nem érhető el."),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const linked = await screen.findByRole("region", { name: "Szállítás" });
    expect(
      await within(linked).findByText("A szállító most nem érhető el."),
    ).toBeTruthy();
    expect(
      within(linked)
        .getByRole("link", { name: "Követés a szállító oldalán" })
        .getAttribute("href"),
    ).toBe("https://track.example/?code=CLFOX1");
  });

  it("without orders.manage there are no pencils", async () => {
    auth.session = session("WAREHOUSE");
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    expect(await screen.findByRole("heading", { name: "#38" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /szerkesztése/ })).toBeNull();
  });
});

/*
  A DÍJBEKÉRŐ (kártya bb3a6bd5). MI PIROSÍT: nem előre utalásos rendelésen is
  áll; a gomb megerősítés nélkül küld, vagy nem a díjbekérő végpontját hívja;
  a kiküldött díjbekérő gombja nem újraküldés, vagy az újraküldés új
  díjbekérőt ígér; a lejárt nem „Lejárt díjbekérő”; a kiállítás alatti mellé
  gomb kerül; a számlázási jogok nélkül gomb áll; a hiba elveszik.
*/
describe("the proforma on the Fizetés card", () => {
  const transfer: WebshopOrderDetail = {
    ...detail,
    bankTransfer: true,
    payment: {
      ...detail.payment!,
      method: "Előre utalás",
      state: "AWAITING",
      authorized: 0,
      stripePaymentIntentId: null,
    },
    cardPayment: null,
  };
  const issued = (
    over: Partial<NonNullable<WebshopOrderDetail["proforma"]>> = {},
  ): WebshopOrderDetail => ({
    ...transfer,
    proforma: {
      id: "doc_p1",
      status: "ISSUED",
      number: "TESZT-D-1",
      dueDate: "2026-10-14",
      emailStatus: "SENT",
      expired: false,
      grossAmount: "20840.0000",
      ...over,
    },
  });
  const card = () => screen.findByRole("region", { name: "Fizetés" });

  it("is not there for another payment method", async () => {
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const payment = await card();
    expect(within(payment).queryByText(/díjbekérő/i)).toBeNull();
    expect(within(payment).queryByText("Utalásra vár")).toBeNull();
  });

  it("waits for the transfer; the first send asks first, then issues and sends", async () => {
    api.detail.mockResolvedValue(transfer);
    api.sendProforma.mockResolvedValue(issued());
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const payment = await card();
    expect(within(payment).getByText("Utalásra vár")).toBeTruthy();
    expect(within(payment).getByText("Még nincs díjbekérő.")).toBeTruthy();
    fireEvent.click(
      within(payment).getByRole("button", { name: "Díjbekérő kiküldése" }),
    );
    const confirm = screen.getByRole("dialog", { name: "Díjbekérő kiküldése" });
    expect(confirm.textContent).toContain("valódi díjbekérő készül");
    expect(confirm.textContent).toContain("8 napos");
    expect(confirm.textContent).toContain("emese@example.hu");
    expect(api.sendProforma).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Díjbekérő kiküldése" }),
    );
    expect(await within(payment).findByText("TESZT-D-1")).toBeTruthy();
    expect(api.sendProforma).toHaveBeenCalledWith("token", "order_38");
    expect(within(payment).getByText("2026-10-14")).toBeTruthy();
    expect(within(payment).getByText("Kiküldve")).toBeTruthy();
    expect(
      within(payment)
        .getByRole("link", { name: "Megnyitás a Számlázásban" })
        .getAttribute("href"),
    ).toBe("/penzugy/szamlazas/doc_p1");
  });

  it("once sent, the button resends the same one; an expired one is marked and can be resent", async () => {
    api.detail.mockResolvedValue(issued({ expired: true }));
    api.sendProforma.mockResolvedValue(issued({ expired: true }));
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const payment = await card();
    expect(within(payment).getByText("Lejárt díjbekérő")).toBeTruthy();
    expect(within(payment).queryByText("Utalásra vár")).toBeNull();
    expect(
      within(payment).queryByRole("button", { name: "Díjbekérő kiküldése" }),
    ).toBeNull();
    fireEvent.click(
      within(payment).getByRole("button", { name: "Díjbekérő újraküldése" }),
    );
    const confirm = screen.getByRole("dialog", {
      name: "Díjbekérő újraküldése",
    });
    expect(confirm.textContent).toContain("Új díjbekérő nem készül");
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Díjbekérő újraküldése" }),
    );
    await vi.waitFor(() =>
      expect(api.sendProforma).toHaveBeenCalledWith("token", "order_38"),
    );
  });

  it("no button while issuing, while sending, without the billing rights, or on a failed order", async () => {
    for (const [order, who] of [
      [issued({ status: "ISSUING", number: null, emailStatus: null }), "OWNER"],
      [issued({ emailStatus: "SENDING" }), "OWNER"],
      [transfer, "NO_BILLING"],
      [
        {
          ...transfer,
          status: { ...transfer.status, code: "closed_unsuccessfully" },
        },
        "OWNER",
      ],
    ] as const) {
      auth.session =
        who === "NO_BILLING" ? salesWithoutBilling() : session(who);
      api.detail.mockResolvedValue(order);
      const view = render(
        createElement(WebshopOrderDetailPage, { id: "order_38" }),
      );
      const payment = await card();
      const button = within(payment).queryByRole("button", {
        name: /Díjbekérő/,
      });
      expect(button === null || (button as HTMLButtonElement).disabled).toBe(
        true,
      );
      view.unmount();
    }
  });

  /*
    MEGJÖTT A PÉNZ (bb3a6bd5). MI PIROSÍT: a kifizetett rendelésen „Utalásra
    vár”, „Lejárt díjbekérő” vagy küldő gomb áll; a kézi rögzítés hivatkozás
    nélkül vagy nem a megadott nappal megy; jog vagy kiállított díjbekérő
    nélkül is van gomb.
  */
  const paid = (
    over: Partial<NonNullable<WebshopOrderDetail["transferReceipt"]>> = {},
  ): WebshopOrderDetail => ({
    ...issued({ expired: false }),
    transferReceipt: {
      source: "MANUAL",
      receivedOn: "2026-10-06",
      reference: "OTP 0013",
      amount: "20840.0000",
      currency: "HUF",
      recordedBy: "Teszt Elek",
      ...over,
    },
  });

  it("a paid order says Kifizetve, with the day, the reference and who, and offers nothing to send", async () => {
    api.detail.mockResolvedValue(paid());
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const payment = await card();
    expect(within(payment).getByText("Kifizetve")).toBeTruthy();
    expect(within(payment).queryByText("Utalásra vár")).toBeNull();
    expect(within(payment).queryByText("Lejárt díjbekérő")).toBeNull();
    expect(within(payment).getByText("2026-10-06")).toBeTruthy();
    expect(within(payment).getByText("OTP 0013")).toBeTruthy();
    expect(within(payment).getByText("Teszt Elek")).toBeTruthy();
    expect(
      within(payment).queryByRole("button", { name: /Díjbekérő|Utalás/ }),
    ).toBeNull();
  });

  it("a bank pairing is named as such", async () => {
    api.detail.mockResolvedValue(
      paid({ source: "BANK_PAIRING", recordedBy: null }),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    expect(within(await card()).getByText("Banki párosítás")).toBeTruthy();
  });

  it("records a transfer by hand: today by default, a reference required, then Kifizetve", async () => {
    api.detail.mockResolvedValue(issued());
    api.recordTransferReceived.mockResolvedValue(paid());
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const payment = await card();
    fireEvent.click(
      within(payment).getByRole("button", { name: "Utalás beérkezett" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Utalás beérkezett" });
    expect(dialog.textContent).toMatch(/20\s?840/);
    const day = within(dialog).getByLabelText(
      "A jóváírás napja",
    ) as HTMLInputElement;
    expect(day.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const save = within(dialog).getByRole("button", { name: "Mentés" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Banki hivatkozás"), {
      target: { value: "  OTP 0013 " },
    });
    fireEvent.click(save);
    expect(await within(payment).findByText("Kifizetve")).toBeTruthy();
    expect(api.recordTransferReceived).toHaveBeenCalledWith(
      "token",
      "order_38",
      { receivedOn: day.value, reference: "OTP 0013" },
    );
  });

  /*
    A WEBSHOP OLDALA (commerce #509). MI PIROSÍT: a gomb akkor is áll, ha a
    webshop már kifizetettnek látja; nem a lezárás végpontját hívja; a hiba
    elveszik.
  */
  it("paid in the OS but awaiting in the shop offers Webshop fizetés lezárása", async () => {
    const awaiting = paid();
    api.detail.mockResolvedValue(awaiting);
    api.syncTransferToShop.mockResolvedValue({
      ...awaiting,
      payment: { ...awaiting.payment!, state: "CAPTURED" },
    });
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const payment = await card();
    expect(payment.textContent).toContain("még fizetésre vár");
    fireEvent.click(
      within(payment).getByRole("button", { name: "Webshop fizetés lezárása" }),
    );
    await vi.waitFor(() =>
      expect(
        within(payment).queryByRole("button", {
          name: "Webshop fizetés lezárása",
        }),
      ).toBeNull(),
    );
    expect(api.syncTransferToShop).toHaveBeenCalledWith("token", "order_38");
  });

  it("no shop button once the shop has the payment; a refusal stays on the card", async () => {
    const captured = paid();
    api.detail.mockResolvedValue({
      ...captured,
      payment: { ...captured.payment!, state: "CAPTURED" },
    });
    const first = render(
      createElement(WebshopOrderDetailPage, { id: "order_38" }),
    );
    expect(
      within(await card()).queryByRole("button", {
        name: "Webshop fizetés lezárása",
      }),
    ).toBeNull();
    first.unmount();

    api.detail.mockResolvedValue(paid());
    api.syncTransferToShop.mockRejectedValue(
      new Error("A webshop fizetése nem zárult le: Az összeg eltér"),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const payment = await card();
    fireEvent.click(
      within(payment).getByRole("button", { name: "Webshop fizetés lezárása" }),
    );
    expect((await within(payment).findByRole("alert")).textContent).toMatch(
      /Az összeg eltér/,
    );
  });

  /*
    A BEÉRKEZETT UTALÁS RÖGZÍTÉSE FIZETÉS, NEM KIÁLLÍTÁS: a SALES 2026-10-08 óta
    kiállíthat (billing.issue), de ezt a gombot nem kapja (finance.manage).
  */
  it("no Utalás beérkezett before the proforma is issued, or without the finance write right", async () => {
    for (const [order, role] of [
      [transfer, "OWNER"],
      [issued(), "SALES"],
    ] as const) {
      auth.session = session(role);
      api.detail.mockResolvedValue(order);
      const view = render(
        createElement(WebshopOrderDetailPage, { id: "order_38" }),
      );
      expect(
        within(await card()).queryByRole("button", {
          name: "Utalás beérkezett",
        }),
      ).toBeNull();
      view.unmount();
    }
  });

  /*
    A SZÁMLÁZZ.HU SZÁMLÁJA (bb3a6bd5). MI PIROSÍT: előre utalásnál az OS
    kiállítás-gombot ad; a bejött számla nem látszik, nem a külső bizonylatra
    visz, vagy a gyenge kötés nincs jelölve; a számla szerinti kifizetés nem
    „Kifizetve”.
  */
  const external = (
    over: Partial<NonNullable<WebshopOrderDetail["externalInvoice"]>> = {},
  ): WebshopOrderDetail => ({
    ...issued(),
    externalInvoice: {
      id: "ext_1",
      number: "E-ACR-2026-77",
      link: "ORDER_NUMBER",
      paid: true,
      paidOn: "2026-10-07",
      ...over,
    },
  });

  it("before the Számlázz.hu invoice the Számla card offers no OS invoice", async () => {
    api.detail.mockResolvedValue(issued());
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const invoiceCard = await screen.findByRole("region", { name: "Számla" });
    expect(invoiceCard.textContent).toContain("a Számlázz.hu állítja ki");
    expect(within(invoiceCard).queryByRole("button")).toBeNull();
  });

  it("the Számlázz.hu invoice shows with its link, and paid by it says Kifizetve", async () => {
    api.detail.mockResolvedValue(external());
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const invoiceCard = await screen.findByRole("region", { name: "Számla" });
    expect(within(invoiceCard).getByText("E-ACR-2026-77")).toBeTruthy();
    expect(
      within(invoiceCard)
        .getByRole("link", { name: "Megnyitás a Számlázásban" })
        .getAttribute("href"),
    ).toBe("/penzugy/szamlazas/kulso/ext_1");
    expect(invoiceCard.textContent).not.toContain("nézd meg");
    const payment = await card();
    expect(within(payment).getByText("Kifizetve")).toBeTruthy();
    expect(payment.textContent).toContain(
      "A Számlázz.hu számlája szerint kifizetve (2026-10-07)",
    );
    expect(
      within(payment).queryByRole("button", { name: /Díjbekérő|Utalás/ }),
    ).toBeNull();
  });

  it("a weak link by buyer and amount says to check it; an unpaid invoice is not Kifizetve", async () => {
    api.detail.mockResolvedValue(
      external({ link: "BUYER_AMOUNT", paid: false, paidOn: null }),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const invoiceCard = await screen.findByRole("region", { name: "Számla" });
    expect(invoiceCard.textContent).toContain(
      "Csak a vevő és az összeg egyezik",
    );
    expect(within(await card()).queryByText("Kifizetve")).toBeNull();
  });

  it("a refused send keeps the reason on the card", async () => {
    api.detail.mockResolvedValue(transfer);
    api.sendProforma.mockRejectedValue(
      new Error(
        "A rendelésen nincs e-mail cím, ezért a díjbekérő nem küldhető ki.",
      ),
    );
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const payment = await card();
    fireEvent.click(
      within(payment).getByRole("button", { name: "Díjbekérő kiküldése" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Díjbekérő kiküldése" }),
      ).getByRole("button", { name: "Díjbekérő kiküldése" }),
    );
    expect((await within(payment).findByRole("alert")).textContent).toMatch(
      /nincs e-mail cím/,
    );
  });
});
