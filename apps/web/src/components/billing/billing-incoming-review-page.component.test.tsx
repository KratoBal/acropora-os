import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  IncomingDocumentReview,
  Session,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BillingIncomingReviewPage,
  incomingReviewHref,
} from "./billing-incoming-review-page";

/**
 * A POSTAFIÓKOS SZÁMLA ELLENŐRZŐ LAPJA (kártya e4c3b0fb). Kitalált szállító
 * és számok.
 *
 * MI PIROSÍT: ha a mező forrása nem látszana; ha a figyelmeztetés elveszne;
 * ha a jóváhagyás nem a SZERKESZTETT értékeket küldené, vagy az üres mezőt
 * üres szövegként küldené `null` helyett; ha a szerver magyar hibaüzenete
 * elnyelődne; ha jóváhagyási jog nélkül is lenne gomb; ha a jóváhagyott lap
 * még szerkeszthető lenne.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const api = vi.hoisted(() => ({
  incomingReview: vi.fn(),
  saveIncomingReview: vi.fn(),
  approveIncomingReview: vi.fn(),
  incomingPdf: vi.fn(),
}));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));

const role = vi.hoisted(() => ({ value: "OWNER" as UserRole }));
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
        role: role.value,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const review = (
  over: Partial<IncomingDocumentReview> = {},
): IncomingDocumentReview => ({
  item: {
    id: "mailbox:mail-1",
    origin: "MAILBOX",
    review: "TO_REVIEW",
    documentNumber: "KIT-2026-0042",
    kindCode: "SZ",
    kindLabel: "Számla",
    invoiceFormat: null,
    cancelled: false,
    supplierName: "Kitalált Előfizetés Inc.",
    supplierTaxNumber: null,
    issueDate: "2026-10-03",
    fulfillmentDate: null,
    dueDate: null,
    paymentMethod: null,
    currency: "EUR",
    exchangeRate: null,
    netAmount: null,
    vatAmount: null,
    grossAmount: "81.30",
    paymentState: "PAID",
    paidAmount: "81.30",
    lastPaymentDate: "2026-10-05",
    paymentSource: "BANK_PAIRING",
    paymentConflict: false,
    bankMatch: {
      state: "PAIRED",
      reason: null,
      debits: [{ bookingDate: "2026-10-05", amount: "81.30", currency: "EUR" }],
    },
    hasPdf: false,
  },
  state: "TO_REVIEW",
  values: {
    supplierName: "Kitalált Előfizetés Inc.",
    supplierTaxNumber: null,
    supplierEuTaxNumber: null,
    documentNumber: "KIT-2026-0042",
    issueDate: "2026-10-03",
    fulfillmentDate: null,
    dueDate: "2026-10-17",
    currency: "EUR",
    netAmount: "81.30",
    vatAmount: null,
    grossAmount: "81.30",
  },
  sources: {
    supplierName: "PAIRING",
    documentNumber: "TEXT",
    issueDate: "TEXT",
    dueDate: "TEXT",
    currency: "TEXT",
    netAmount: "TEXT",
    grossAmount: "TEXT",
  },
  warnings: ["A bruttó (81.30 EUR) eltér a banki terheléstől (82.00 EUR)."],
  hasText: true,
  readAt: null,
  ...over,
});

beforeEach(() => {
  role.value = "OWNER";
  api.incomingReview.mockReset().mockResolvedValue(review());
  api.saveIncomingReview.mockReset();
  api.approveIncomingReview.mockReset();
  api.incomingPdf.mockReset();
});

describe("the review page", () => {
  it("the href encodes the mailbox id", () => {
    expect(incomingReviewHref("mailbox:mail-1")).toBe(
      "/penzugy/szamlazas/bejovo/ellenorzes/mailbox%3Amail-1",
    );
  });

  it("shows each field with its source, and the warnings", async () => {
    render(<BillingIncomingReviewPage itemId="mailbox:mail-1" />);
    expect(await screen.findByLabelText("Nettó")).toHaveValue("81.30");
    expect(screen.getByText("Ellenőrizendő")).toBeInTheDocument();
    expect(screen.getAllByText("PDF szövegéből").length).toBeGreaterThan(0);
    expect(screen.getByText("Banki párosításból")).toBeInTheDocument();
    expect(screen.getAllByText("nincs adat").length).toBeGreaterThan(0);
    expect(screen.getByText(/eltér a banki terheléstől/)).toBeInTheDocument();
    expect(api.incomingReview).toHaveBeenCalledWith(
      "token-1",
      "mailbox:mail-1",
      expect.anything(),
    );
  });

  it("approves the EDITED values, an emptied field as null", async () => {
    api.approveIncomingReview.mockResolvedValue(review({ state: "VERIFIED" }));
    render(<BillingIncomingReviewPage itemId="mailbox:mail-1" />);
    fireEvent.change(await screen.findByLabelText("ÁFA"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Fizetési határidő"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Jóváhagyás" }));
    await waitFor(() => expect(api.approveIncomingReview).toHaveBeenCalled());
    const [, id, values] = api.approveIncomingReview.mock.calls[0]!;
    expect(id).toBe("mailbox:mail-1");
    expect(values).toMatchObject({
      vatAmount: "0",
      dueDate: null,
      netAmount: "81.30",
      supplierTaxNumber: null,
    });
    expect(await screen.findByText(/Jóváhagyva/)).toBeInTheDocument();
    // a jóváhagyott lap nem szerkeszthető, és nincs több gomb
    expect(screen.getByLabelText("ÁFA")).toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "Jóváhagyás" }),
    ).not.toBeInTheDocument();
  });

  it("shows the server's reason when approval is refused", async () => {
    api.approveIncomingReview.mockRejectedValue(
      new Error("Hiányzó mező: ÁFA."),
    );
    render(<BillingIncomingReviewPage itemId="mailbox:mail-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Jóváhagyás" }));
    expect(await screen.findByText("Hiányzó mező: ÁFA.")).toBeInTheDocument();
  });

  it("saves without approving", async () => {
    api.saveIncomingReview.mockResolvedValue(review());
    render(<BillingIncomingReviewPage itemId="mailbox:mail-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Mentés jóváhagyás nélkül" }),
    );
    await waitFor(() => expect(api.saveIncomingReview).toHaveBeenCalled());
    expect(api.approveIncomingReview).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/továbbra is ellenőrizendő/),
    ).toBeInTheDocument();
  });

  it("without the billing create right the page is read only", async () => {
    role.value = "VIEWER";
    render(<BillingIncomingReviewPage itemId="mailbox:mail-1" />);
    expect(await screen.findByLabelText("Nettó")).toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "Jóváhagyás" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/billing\.create/)).toBeInTheDocument();
  });

  it("a missing PDF is said, not swallowed", async () => {
    api.incomingPdf.mockRejectedValue(
      new Error("A számla megvan, de PDF nem érkezett hozzá."),
    );
    render(<BillingIncomingReviewPage itemId="mailbox:mail-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "PDF megnyitása" }),
    );
    expect(
      await screen.findByText("A számla megvan, de PDF nem érkezett hozzá."),
    ).toBeInTheDocument();
  });
});
