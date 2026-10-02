import { render, screen } from "@testing-library/react";
import type {
  BillingExternalDocumentDetail,
  Session,
  UserRole,
} from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import { BillingExternalDocumentPage } from "./billing-external-document-page";

/**
 * A SZÁMLÁZZ.HU-BÓL KAPOTT KÜLSŐ BIZONYLAT ADATLAPJA (acrobot 25812): ugyanaz a
 * kinézet, csak olvasásra, PDF nélkül.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/penzugy/szamlazas/kulso/ext-1",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({ externalDetail: vi.fn() }));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));

const auth = vi.hoisted(() => ({ role: "OWNER" as UserRole }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "U",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const detail = (
  overrides: Partial<BillingExternalDocumentDetail> = {},
): BillingExternalDocumentDetail => ({
  id: "ext-1",
  source: "SZAMLAZZ",
  pdfAvailable: false,
  pdfMissingReason: null,
  kindCode: "SZ",
  kindLabel: "Számla",
  documentNumber: "ACRW-2026/00508",
  invoiceFormat: "ELECTRONIC",
  issueDate: "2026-09-30",
  fulfillmentDate: "2026-09-29",
  dueDate: "2026-10-08",
  paymentMethod: "Átutalás",
  currency: "HUF",
  customer: {
    name: "Teszt Akvárium Bt.",
    taxNumber: "12345678-2-41",
    address: "1031 Budapest Minta utca 1.",
  },
  lines: [
    {
      name: "Akvárium szerviz",
      quantity: "2.0",
      unit: "óra",
      unitNet: "10000.0",
      vatRate: "27",
      netAmount: "20000",
      vatAmount: "5400",
      grossAmount: "25400",
    },
  ],
  totals: { netAmount: "20000", vatAmount: "5400", grossAmount: "25400" },
  cancelled: false,
  paymentState: "UNKNOWN",
  paidAmount: "0",
  lastPaymentDate: null,
  paymentSource: null,
  paymentsKnown: false,
  payments: [],
  ownPaymentMarks: [],
  orderNumber: "47679-665706",
  paymentMethodUnified: "átutalás",
  versionCount: 2,
  receivedAt: "2026-10-01T15:00:00.000Z",
  ...overrides,
});

describe("BillingExternalDocumentPage", () => {
  /**
   * MI PIROSÍT: ha egy mező (szám, vevő, tétel, végösszeg) nem a válaszból
   * jönne; ha bármilyen művelet (szerkesztés, sztornó, újraküldés, PDF)
   * megjelenne egy csak olvasható bizonylaton.
   */
  it("shows the invoice read-only: its fields, its lines and totals, and no action at all", async () => {
    api.externalDetail.mockResolvedValue(detail());
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(
      await screen.findByRole("heading", { name: "ACRW-2026/00508" }),
    ).toBeInTheDocument();
    expect(api.externalDetail).toHaveBeenCalledWith(
      "token-1",
      "ext-1",
      expect.anything(),
    );
    expect(screen.getAllByText("Teszt Akvárium Bt.").length).toBeGreaterThan(0);
    expect(screen.getByText("Akvárium szerviz")).toBeInTheDocument();
    expect(screen.getByText("Külső")).toBeInTheDocument();
    expect(
      screen.getByText("Külső bizonylat, csak olvasásra"),
    ).toBeInTheDocument();
    expect(screen.getByText("a legutóbbi a 2 közül")).toBeInTheDocument();
    // a webshop rendelésszáma (`alap.rendelesszam`, acrobot 25964)
    expect(screen.getByText("47679-665706")).toBeInTheDocument();
    // a KONTROLL a gombokra: a lapon csak a „Vissza a listához” link van
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(
      screen.queryByText(/Szerkesztés|Sztornó|Újraküldés|Nyomtatás|Letöltés/),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /Vissza a listához/ }),
    ).toHaveAttribute("href", "/penzugy/szamlazas");
  });

  it("shows the payments Számlázz.hu recorded, its own bank pairing too", async () => {
    api.externalDetail.mockResolvedValue(
      detail({
        paymentState: "PAID",
        paidAmount: "25400",
        lastPaymentDate: "2026-09-28",
        paymentSource: "SZAMLAZZ",
        paymentsKnown: true,
        payments: [
          {
            date: "2026-09-28",
            title: "átutalás",
            amount: "25400",
            note: "Automatikus banki tranzakció párosítás",
          },
        ],
      }),
    );
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(await screen.findByText("Fizetve")).toBeInTheDocument();
    expect(
      screen.getByText("Automatikus banki tranzakció párosítás"),
    ).toBeInTheDocument();
    expect(screen.getByText(/2026\. 09\. 28\. · átutalás/)).toBeInTheDocument();
  });

  /*
    A SAJÁT, BEÍRT JELÖLÉS (acrobot 26027). MI PIROSÍT: ha a jelölésből számolt
    „Fizetve” nem mondaná a forrását; ha a jelölés sora nem látszana az adatlapon.
  */
  it("shows our own written mark: the source on the state, and the mark's line", async () => {
    api.externalDetail.mockResolvedValue(
      detail({
        paymentState: "PAID",
        paidAmount: "29210",
        lastPaymentDate: "2026-09-17",
        paymentSource: "MARK_GLS_COD",
        paymentsKnown: false,
        ownPaymentMarks: [
          { source: "GLS_COD", date: "2026-09-17", amount: "29210" },
        ],
      }),
    );
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(
      await screen.findByText("Fizetve (GLS utánvét)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Általunk beírva a Számlázz.hu-ba"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2026\. 09\. 17\. · GLS utánvét/),
    ).toBeInTheDocument();
  });

  // MI PIROSÍT: ha a rendelésből jött név nem lenne megjelölve (acrobot 26096)
  it("says when the buyer's name came from the webshop order", async () => {
    api.externalDetail.mockResolvedValue(
      detail({
        customer: {
          name: "Kiss Anna",
          taxNumber: null,
          address: null,
          nameFromOrder: true,
        },
      }),
    );
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(
      await screen.findByText(
        "A név a webshop-rendelésből; a számlán a NAV elrejti.",
      ),
    ).toBeInTheDocument();
  });

  it("says when Számlázz.hu marks it cancelled", async () => {
    api.externalDetail.mockResolvedValue(detail({ cancelled: true }));
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(await screen.findByText("Sztornózott")).toBeInTheDocument();
  });
});
