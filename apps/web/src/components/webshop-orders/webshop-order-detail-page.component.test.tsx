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
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  changeStatus: vi.fn(),
  resendStatusMail: vi.fn(),
  editLine: vi.fn(),
  releaseHold: vi.fn(),
  sendPaymentLink: vi.fn(),
  replacementVariants: vi.fn(),
  issueInvoice: vi.fn(),
  createParcel: vi.fn(),
  parcelLabel: vi.fn(),
  releaseParcel: vi.fn(),
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
  invoice: null,
  parcel: null,
  cardPayment: null,
  lineEdit: { allowed: true, reason: null },
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
  auth.session = session("OWNER");
  api.detail.mockReset();
  api.changeStatus.mockReset();
  api.resendStatusMail.mockReset();
  api.editLine.mockReset();
  api.releaseHold.mockReset();
  api.sendPaymentLink.mockReset();
  api.replacementVariants.mockReset();
  api.issueInvoice.mockReset();
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
    expect(
      within(card).getByText("Értesítő elküldve (újraküldve 1×)"),
    ).toBeTruthy();
    expect(within(card).getByText("Értesítő nem ment ki")).toBeTruthy();
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
    expect((await within(card).findByRole("alert")).textContent).toMatch(
      /eltérnek/,
    );
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

    auth.session = session("SALES");
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
      ...parcel,
    },
  });

  it("before the invoice there is no parcel button", async () => {
    api.detail.mockResolvedValue(detail);
    render(createElement(WebshopOrderDetailPage, { id: "order_38" }));
    const card = await screen.findByRole("region", { name: "Szállítás" });
    expect(
      within(card).getByText(
        "Előbb állítsd ki a számlát, utána adható fel a csomag.",
      ),
    ).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: "Csomag feladása" }),
    ).toBeNull();
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
    expect(
      within(within(dialog).getByRole("list", { name: "Kijelölt tételek" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Coral Food · 2 db"]);
    expect(within(dialog).getByText(/következő körben/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Bezárás" }));
    fireEvent.click(box);
    expect(
      within(items).queryByRole("button", { name: "Szétbontás" }),
    ).toBeNull();
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
});
