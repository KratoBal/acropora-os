import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  Session,
  UnasOrderDetail,
  UnasOrderRefreshResult,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopOrderDetailPage } from "./webshop-order-detail-page";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getOne: vi.fn(),
  refreshOrder: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api/unas-orders", () => ({ unasOrdersApi: api }));

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

const viewerSession: Session = {
  id: "session-viewer",
  token: "token-viewer",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "viewer",
    email: "viewer@acropora.local",
    displayName: "Acropora Néző",
    role: "VIEWER",
  },
};

function baseDetail(overrides: Partial<UnasOrderDetail> = {}): UnasOrderDetail {
  return {
    id: "order-1",
    orderNumber: "UNAS-47679-738905",
    status: "CONFIRMED",
    unasStatusLabel: "Kiszállítás",
    buyerName: "Nagy Péter",
    buyerEmail: "nagy.peter@example.com",
    paymentName: "Bankkártya",
    paymentStatus: "paid",
    shippingName: "GLS",
    currency: "HUF",
    totalNet: "10000",
    totalTax: "2700",
    totalGross: "12700",
    orderedAt: "2026-07-20T14:05:00.000Z",
    createdAt: "2026-07-20T14:06:00.000Z",
    unasDeletedAt: null,
    lines: [],
    unasInvoiceStatus: null,
    invoices: [],
    ...overrides,
  };
}

function refreshResult(
  detailOverrides: Partial<UnasOrderDetail> = {},
  publishOverrides: Partial<UnasOrderRefreshResult["stockPublish"]> = {},
): UnasOrderRefreshResult {
  return {
    ...baseDetail(detailOverrides),
    stockPublish: {
      claimed: 1,
      succeeded: 1,
      superseded: 0,
      retried: 0,
      deadLettered: 0,
      ...publishOverrides,
    },
  };
}

beforeEach(() => {
  auth.session = ownerSession;
  navigation.push.mockReset();
  api.getOne.mockReset();
  api.refreshOrder.mockReset();
});

describe("WebshopOrderDetailPage - Számla kártya", () => {
  it("megjeleníti a UNAS-tükrözött számla adatait és a linket, ha van externalUrl", async () => {
    api.getOne.mockResolvedValue(
      baseDetail({
        unasInvoiceStatus: "BILLED",
        invoices: [
          {
            id: "invoice-1",
            invoiceNumber: "SZ-2026-000123",
            externalUrl: "https://szamlazz.hu/szamla/SZ-2026-000123.pdf",
            syncStatus: "RECEIVED",
            createdAt: "2026-07-21T09:00:00.000Z",
          },
        ],
      }),
    );

    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));

    expect(await screen.findByText("Számlázva")).toBeInTheDocument();
    expect(screen.getByText("SZ-2026-000123")).toBeInTheDocument();
    expect(screen.getByText("Fogadva")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Számla megnyitása/ });
    expect(link).toHaveAttribute(
      "href",
      "https://szamlazz.hu/szamla/SZ-2026-000123.pdf",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("nem jelenít meg linket, ha a mirroroltak számlához nincs externalUrl", async () => {
    api.getOne.mockResolvedValue(
      baseDetail({
        unasInvoiceStatus: "BILLED",
        invoices: [
          {
            id: "invoice-1",
            invoiceNumber: "SZ-2026-000124",
            externalUrl: null,
            syncStatus: "RECEIVED",
            createdAt: "2026-07-21T09:00:00.000Z",
          },
        ],
      }),
    );

    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));

    expect(await screen.findByText("SZ-2026-000124")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Számla megnyitása/ }),
    ).not.toBeInTheDocument();
  });

  it("egyértelmű üres állapotot mutat, ha a rendeléshez még nincs UNAS-számla", async () => {
    api.getOne.mockResolvedValue(
      baseDetail({ unasInvoiceStatus: "BILLABLE", invoices: [] }),
    );

    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));

    expect(await screen.findByText("Számlázható")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ehhez a rendeléshez a UNAS egyelőre nem jelentett kiállított számlát.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Számla megnyitása/ }),
    ).not.toBeInTheDocument();
  });

  it('"Nincs adat" jelzést mutat, ha unasInvoiceStatus null (nem UNAS-eredetű vagy még nem szinkronizált rendelés)', async () => {
    api.getOne.mockResolvedValue(
      baseDetail({ unasInvoiceStatus: null, invoices: [] }),
    );

    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));

    expect(await screen.findByText("Nincs adat")).toBeInTheDocument();
  });
});

describe("WebshopOrderDetailPage - Rendelés frissítése gomb", () => {
  it("megjelenik orders.manage jogosultsággal", async () => {
    api.getOne.mockResolvedValue(baseDetail());
    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));

    expect(
      await screen.findByRole("button", { name: "Rendelés frissítése" }),
    ).toBeInTheDocument();
  });

  it("nem jelenik meg orders.manage jogosultság nélkül", async () => {
    // VIEWER has orders.view (sees the page normally) but not orders.manage
    // (per ROLE_PERMISSIONS) - the order detail still renders, but the
    // mutating "Rendelés frissítése" button must not.
    auth.session = viewerSession;
    api.getOne.mockResolvedValue(baseDetail());
    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));

    expect(await screen.findByText("UNAS-47679-738905")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Rendelés frissítése" }),
    ).not.toBeInTheDocument();
  });

  it("frissítés közben letiltott, betöltés-feliratú állapotot mutat", async () => {
    api.getOne.mockResolvedValue(baseDetail());
    let resolveRefresh: (value: UnasOrderRefreshResult) => void = () => {};
    api.refreshOrder.mockReturnValue(
      new Promise<UnasOrderRefreshResult>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));
    const button = await screen.findByRole("button", {
      name: "Rendelés frissítése",
    });

    fireEvent.click(button);

    const loadingButton = await screen.findByRole("button", {
      name: "Frissítés…",
    });
    expect(loadingButton).toBeDisabled();

    resolveRefresh(refreshResult());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Rendelés frissítése" }),
      ).not.toBeDisabled(),
    );
  });

  it("sikeres frissítés után lecseréli a képernyőn látható rendelés- és számlaadatokat", async () => {
    api.getOne.mockResolvedValue(
      baseDetail({
        status: "CONFIRMED",
        unasInvoiceStatus: null,
        invoices: [],
      }),
    );
    api.refreshOrder.mockResolvedValue(
      refreshResult({
        status: "COMPLETED",
        // Overrides baseDetail's default "Kiszállítás" - the status badge
        // prefers unasStatusLabel over the STATUS_LABEL[status] fallback
        // (see the component), so this must be cleared for the refreshed
        // "Lezárva" (COMPLETED) label to actually be the one rendered.
        unasStatusLabel: null,
        unasInvoiceStatus: "BILLED",
        invoices: [
          {
            id: "invoice-1",
            invoiceNumber: "SZ-2026-000200",
            externalUrl: "https://szamlazz.hu/szamla/SZ-2026-000200.pdf",
            syncStatus: "RECEIVED",
            createdAt: "2026-07-26T09:00:00.000Z",
          },
        ],
      }),
    );
    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));
    const button = await screen.findByRole("button", {
      name: "Rendelés frissítése",
    });

    fireEvent.click(button);

    expect(await screen.findByText("Lezárva")).toBeInTheDocument();
    expect(await screen.findByText("SZ-2026-000200")).toBeInTheDocument();
    expect(screen.getByText("Számlázva")).toBeInTheDocument();
    expect(
      screen.getByText(/A rendelés adatai frissültek/),
    ).toBeInTheDocument();
    expect(api.refreshOrder).toHaveBeenCalledWith("token-owner", "order-1");
  });

  it("egyértelműen jelzi, ha egy élő UNAS-rendelés stabil Id alapján helyreállította a korábbi téves törlésjelölést", async () => {
    api.getOne.mockResolvedValue(
      baseDetail({
        status: "CANCELLED",
        unasDeletedAt: "2026-08-08T20:13:16.000Z",
      }),
    );
    api.refreshOrder.mockResolvedValue(
      refreshResult({ status: "CONFIRMED", unasDeletedAt: null }),
    );
    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));
    const button = await screen.findByRole("button", {
      name: "Rendelés frissítése",
    });

    fireEvent.click(button);

    expect(
      await screen.findByText("A téves törlésjelölés helyreállt"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/auditált készletmozgással megtörtént/),
    ).toBeInTheDocument();
    expect(screen.getByText("Az UNAS készlet frissült")).toBeInTheDocument();
    expect(screen.queryByText(/Törölve a UNAS-ban/)).not.toBeInTheDocument();
  });

  it("külön jelzi, ha a célzott UNAS készletpublikálás hibára fut", async () => {
    api.getOne.mockResolvedValue(baseDetail());
    api.refreshOrder.mockResolvedValue(
      refreshResult(
        {},
        { claimed: 1, succeeded: 0, retried: 1, deadLettered: 0 },
      ),
    );
    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Rendelés frissítése" }),
    );

    expect(
      await screen.findByText("Az UNAS készletfrissítés nem fejeződött be"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Újrapróbálásra vár: 1/)).toBeInTheDocument();
  });

  it("hiba esetén egyértelmű hibaüzenetet mutat, és nem cseréli le a meglévő adatokat", async () => {
    api.getOne.mockResolvedValue(baseDetail({ status: "CONFIRMED" }));
    api.refreshOrder.mockRejectedValue(
      new Error("A UNAS API átmenetileg nem elérhető."),
    );
    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));
    const button = await screen.findByRole("button", {
      name: "Rendelés frissítése",
    });

    fireEvent.click(button);

    expect(
      await screen.findByText("A UNAS API átmenetileg nem elérhető."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A rendelés frissítése nem sikerült"),
    ).toBeInTheDocument();
    // The order detail already on screen is untouched by the failed refresh.
    expect(screen.getByText("Nagy Péter")).toBeInTheDocument();
  });
});
