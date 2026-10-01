import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IncomingDocumentDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingIncomingDocumentPage } from "./billing-incoming-document-page";

/**
 * A BEJÖVŐ SZÁMLA ADATLAPJA (B szelet, a #1367 adatlap-végpontján), csak
 * olvasásra.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/penzugy/szamlazas/bejovo/in-1",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  incomingDetail: vi.fn(),
  incomingPdf: vi.fn(),
}));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));

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
        role: "OWNER",
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const detail = (
  overrides: Partial<IncomingDocumentDetail> = {},
): IncomingDocumentDetail => ({
  id: "in-1",
  documentNumber: "E-KBOSS-2026-1234",
  kindCode: "SZ",
  kindLabel: "Számla",
  invoiceFormat: "ELECTRONIC",
  cancelled: false,
  supplierName: "KBOSS.hu Kft.",
  supplierTaxNumber: "13421739-2-41",
  issueDate: "2026-09-28",
  fulfillmentDate: "2026-09-28",
  dueDate: "2026-10-06",
  paymentMethod: "Átutalás",
  currency: "HUF",
  exchangeRate: null,
  netAmount: "10000",
  vatAmount: "2700",
  grossAmount: "12700",
  paymentState: "PAID",
  paidAmount: "12700",
  lastPaymentDate: "2026-09-30",
  bankMatch: {
    state: "PAIRED",
    reason: null,
    debits: [{ bookingDate: "2026-09-30", amount: "12700", currency: "HUF" }],
  },
  hasPdf: true,
  exchangeBank: null,
  supplier: {
    name: "KBOSS.hu Kft.",
    address: "1031 Budapest Záhony utca 7.",
    taxNumber: "13421739-2-41",
    euTaxNumber: null,
    bankAccount: "11111111-22222222",
  },
  buyer: { name: "Acropora Kft.", taxNumber: "23916229-2-42" },
  lines: [
    {
      name: "Számlázz.hu előfizetés",
      quantity: "1",
      unit: "db",
      unitNet: "10000",
      vatRate: "27",
      netAmount: "10000",
      vatAmount: "2700",
      grossAmount: "12700",
    },
  ],
  vatSummary: [
    {
      vatRate: "27",
      netAmount: "10000",
      vatAmount: "2700",
      grossAmount: "12700",
    },
  ],
  paymentsKnown: true,
  payments: [
    { date: "2026-09-30", title: "átutalás", amount: "12700", note: null },
  ],
  note: null,
  orderNumber: null,
  referencedInvoiceNumber: null,
  referencedProformaNumber: null,
  versionCount: 2,
  receivedAt: "2026-10-01T08:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  api.incomingDetail.mockReset().mockResolvedValue(detail());
  api.incomingPdf.mockReset().mockResolvedValue(new Blob(["%PDF-1.4"]));
});

// MI PIROSÍT: ha a PDF-gomb ott is megjelenne, ahol nem jött PDF; ha a
// hiányzó kifizetés-adat „Nincs fizetve” lenne; ha a „nem párosítandó” oka
// nem látszana; ha a vissza-link a kimenő listára vinne.
describe("BillingIncomingDocumentPage", () => {
  it("shows the supplier, the payments, the paired debit and opens the real PDF", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    URL.createObjectURL = vi.fn(() => "blob:pdf");
    render(<BillingIncomingDocumentPage documentId="in-1" />);
    expect(
      await screen.findByRole("heading", { name: "E-KBOSS-2026-1234" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bankszámla: 11111111-22222222"),
    ).toBeInTheDocument();
    expect(screen.getByText("Terhelés 2026. 09. 30.")).toBeInTheDocument();
    expect(screen.getByText("a legutóbbi a 2 közül")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Vissza a listához/ }),
    ).toHaveAttribute("href", "/penzugy/szamlazas?nezet=bejovo");
    fireEvent.click(screen.getByRole("button", { name: "PDF megnyitása" }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("blob:pdf", "_blank"),
    );
    expect(api.incomingPdf).toHaveBeenCalledWith("token-1", "in-1");
    open.mockRestore();
  });

  it("without a PDF there is no button; without payment data it says so; not to pair says why", async () => {
    api.incomingDetail.mockResolvedValue(
      detail({
        hasPdf: false,
        paymentsKnown: false,
        payments: [],
        paymentState: "UNKNOWN",
        paidAmount: "0",
        bankMatch: { state: "NOT_TO_PAIR", reason: "NOT_COMPANY", debits: [] },
      }),
    );
    render(<BillingIncomingDocumentPage documentId="in-1" />);
    expect(
      await screen.findByText("Ehhez a számlához nem érkezett"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PDF megnyitása" })).toBeNull();
    expect(
      screen.getByText(/nem küldött kifizetési adatot/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nincs fizetve")).toBeNull();
    expect(screen.getByText("A számla nem a cégre szól.")).toBeInTheDocument();
  });
});
