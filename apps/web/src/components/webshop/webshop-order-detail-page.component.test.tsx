import { render, screen } from "@testing-library/react";
import type { Session, UnasOrderDetail } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopOrderDetailPage } from "./webshop-order-detail-page";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getOne: vi.fn(),
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
    lines: [],
    unasInvoiceStatus: null,
    invoices: [],
    ...overrides,
  };
}

beforeEach(() => {
  auth.session = ownerSession;
  navigation.push.mockReset();
  api.getOne.mockReset();
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

  it("\"Nincs adat\" jelzést mutat, ha unasInvoiceStatus null (nem UNAS-eredetű vagy még nem szinkronizált rendelés)", async () => {
    api.getOne.mockResolvedValue(
      baseDetail({ unasInvoiceStatus: null, invoices: [] }),
    );

    render(createElement(WebshopOrderDetailPage, { orderId: "order-1" }));

    expect(await screen.findByText("Nincs adat")).toBeInTheDocument();
  });
});
