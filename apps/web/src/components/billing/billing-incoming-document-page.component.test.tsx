import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  attachIncomingPdf: vi.fn(),
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
  origin: "SZAMLAZZ",
  review: null,
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
  paymentSource: "SZAMLAZZ",
  paymentConflict: false,
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
  relatedDocuments: [],
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

  // MI PIROSÍT (e4c3b0fb): ha a jóváhagyott postafiókos számla a Számlázz.hu
  // továbbításának vagy papírszámlának látszana
  it("an approved mailbox invoice says it came from the mailbox, not from Számlázz.hu", async () => {
    api.incomingDetail.mockResolvedValue(
      detail({
        origin: "MAILBOX",
        review: "VERIFIED",
        invoiceFormat: "PAPER",
        paymentsKnown: false,
        payments: [],
        paymentSource: "BANK_PAIRING",
      }),
    );
    render(<BillingIncomingDocumentPage documentId="in-1" />);
    expect(
      await screen.findByRole("heading", { name: "Postafiók" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Papír alapú/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Postafiókból/).length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/Ahogy a Számlázz\.hu továbbította/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/a fizetés a banki párosításból ismert/),
    ).toBeInTheDocument();
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

  it("without a PDF, finance can attach one; the page then offers it (acrobot 34672)", async () => {
    api.incomingDetail.mockResolvedValue(detail({ hasPdf: false }));
    api.attachIncomingPdf
      .mockReset()
      .mockResolvedValue(detail({ hasPdf: true }));
    render(<BillingIncomingDocumentPage documentId="in-1" />);
    const input = await screen.findByLabelText("PDF csatolása");
    const file = new File(["%PDF-1.4"], "kompress.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(api.attachIncomingPdf).toHaveBeenCalledWith(
        "token-1",
        "in-1",
        file,
      ),
    );
    expect(
      await screen.findByRole("button", { name: "PDF megnyitása" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("PDF csatolása")).toBeNull();
  });

  it("a mailbox-only row has no feed row to attach to: no attach input", async () => {
    api.incomingDetail.mockResolvedValue(detail({ hasPdf: false }));
    render(<BillingIncomingDocumentPage documentId="mailbox:doc-1" />);
    expect(
      await screen.findByText("Ehhez a számlához nem érkezett"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("PDF csatolása")).toBeNull();
  });

  /**
   * acrobot 35579: a díjbekérő és a számla egy várható beérkezésen áll (Várható
   * beérkezések, rendelésszám). MI PIROSÍT: ha a kapcsolódó díjbekérő nem látszik
   * az adatlapon; ha a fajtája, a rendelésszáma vagy az állapota nem magyarul
   * látszik; ha kapcsolat nélkül is megjelenne egy üres szakasz.
   */
  it("lists the documents on the same expected arrival: the pro forma next to the invoice", async () => {
    api.incomingDetail.mockResolvedValue(
      detail({
        relatedDocuments: [
          {
            id: "doc-proforma",
            kind: "PROFORMA",
            fileName: "Commande CM9876.pdf",
            invoiceNumber: null,
            orderReference: "13858",
            receivedAt: "2026-09-02T09:00:00.000Z",
            status: "READ",
          },
          {
            id: "doc-old",
            kind: "INVOICE",
            fileName: "RE67900-v1.pdf",
            invoiceNumber: "RE67900",
            orderReference: "13858",
            receivedAt: "2026-09-20T09:00:00.000Z",
            status: "SUPERSEDED",
          },
        ],
      }),
    );
    render(<BillingIncomingDocumentPage documentId="in-1" />);
    const list = await screen.findByRole("list", {
      name: "Kapcsolódó bizonylatok",
    });
    const [proforma, old] = within(list).getAllByRole("listitem");
    expect(proforma).toHaveTextContent("Díjbekérő");
    expect(proforma).toHaveTextContent("Commande CM9876.pdf");
    expect(proforma).toHaveTextContent("rendelés 13858");
    expect(proforma).toHaveTextContent("Beolvasva");
    expect(old).toHaveTextContent("Számla · RE67900");
    expect(old).toHaveTextContent("Javított változat váltotta");
  });

  it("shows no related-documents section when there is none", async () => {
    render(<BillingIncomingDocumentPage documentId="in-1" />);
    await screen.findByRole("heading", { name: "E-KBOSS-2026-1234" });
    expect(screen.queryByText("Kapcsolódó bizonylatok")).toBeNull();
  });
});
