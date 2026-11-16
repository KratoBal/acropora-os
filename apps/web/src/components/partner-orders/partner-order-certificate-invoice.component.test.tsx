import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoices = vi.hoisted(() => ({
  byCertificate: vi.fn(),
  draft: vi.fn(),
  issueSummary: vi.fn(),
  issue: vi.fn(),
  downloadPdf: vi.fn(),
}));
vi.mock("@/lib/api/maintenance-invoice", () => ({
  maintenanceInvoiceApi: invoices,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "Balázs",
        role: "OWNER",
        customerId: null,
        supplierId: null,
      },
    },
  }),
}));

import { PartnerOrderCertificateInvoice } from "./partner-order-certificate-invoice";

/*
  A MEGRENDELÉSES TIG SZÁMLÁZÁS GOMBJA (kártya 88649353; Balázs, 2026-11-04 17:38 UTC). MI
  PIROSÍT: ha aláírt példány nélkül a gomb tiltott; ha aláírt példány nélkül megerősítés nélkül
  számláz; ha a megerősítés nem a megerősítést küldi; ha a Mégsem is számláz; ha aláírt
  példánnyal is kérdez; ha a piszkozat után nincs kiállítás és letöltés.
*/
const draftSummary = {
  id: "inv-1",
  status: "DRAFT",
  invoiceNumber: null,
  currency: "HUF",
  netAmount: "20000",
  vatAmount: "5400",
  grossAmount: "25400",
  issueEnabled: true,
  issueNote: null,
  createdAt: "2026-11-04T18:00:00.000Z",
};

beforeEach(() => {
  invoices.byCertificate.mockReset().mockResolvedValue(null);
  invoices.draft.mockReset().mockResolvedValue(draftSummary);
});

describe("PartnerOrderCertificateInvoice", () => {
  it("aláírt példánnyal kérdés nélkül számláz", async () => {
    render(
      <PartnerOrderCertificateInvoice
        certificateId="cert-1"
        certificateNumber="TI-2026-008"
        signed
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Számlázás" }));
    await waitFor(() =>
      expect(invoices.draft).toHaveBeenCalledWith("token-1", "cert-1", {
        acknowledgeUnsigned: false,
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Kiállítás" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Előnézet letöltése" }),
    ).toBeInTheDocument();
  });

  it("aláírt példány nélkül a gomb aktív, de előbb megerősítést kér; a Mégsem nem számláz", async () => {
    render(
      <PartnerOrderCertificateInvoice
        certificateId="cert-1"
        certificateNumber="TI-2026-008"
        signed={false}
      />,
    );
    const button = await screen.findByRole("button", { name: "Számlázás" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(
      await screen.findByText(/még nincs feltöltve az aláírt példány/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));
    expect(invoices.draft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Számlázás" }));
    fireEvent.click(await screen.findByRole("button", { name: "Számlázom" }));
    await waitFor(() =>
      expect(invoices.draft).toHaveBeenCalledWith("token-1", "cert-1", {
        acknowledgeUnsigned: true,
      }),
    );
  });

  // Balázs képe (18:48 UTC): üres válasznál örökre „Számla: betöltés…” állt
  it("üres válasznál (még nincs számla) a Számlázás gomb jelenik meg, nem a betöltés", async () => {
    invoices.byCertificate.mockResolvedValue(undefined);
    render(
      <PartnerOrderCertificateInvoice
        certificateId="cert-1"
        certificateNumber="TI-2026-001"
        signed={false}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Számlázás" }),
    ).toBeEnabled();
    expect(screen.queryByText(/betöltés/)).toBeNull();
  });

  it("betöltési hibánál a hiba látszik, és nem marad betöltés", async () => {
    invoices.byCertificate.mockRejectedValue(
      new Error("Nincs jogosultságod ehhez a művelethez."),
    );
    render(
      <PartnerOrderCertificateInvoice
        certificateId="cert-1"
        certificateNumber="TI-2026-001"
        signed={false}
      />,
    );
    expect(
      await screen.findByText("Nincs jogosultságod ehhez a művelethez."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/betöltés/)).toBeNull();
  });

  it("a kiállított számlát letölthetőként mutatja, új számlázás nélkül", async () => {
    invoices.byCertificate.mockResolvedValue({
      ...draftSummary,
      status: "ISSUED",
      invoiceNumber: "ACRS-2026-12",
    });
    render(
      <PartnerOrderCertificateInvoice
        certificateId="cert-1"
        certificateNumber="TI-2026-008"
        signed={false}
      />,
    );
    expect(await screen.findByText(/ACRS-2026-12/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Számla letöltése" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Számlázás" })).toBeNull();
  });

  it("a kiállítás a megerősítő ablakon át megy, bejelölt küldéssel a vevő címére (kártya 7ba97e0d, S3)", async () => {
    invoices.byCertificate.mockResolvedValue(draftSummary);
    invoices.issueSummary.mockResolvedValue({
      buyerName: "Kitalált Kft.",
      buyerAddress: "1011 Budapest, Fő utca 1.",
      buyerTaxNumber: "12345678-2-42",
      buyerEuTaxNumber: null,
      buyerEmail: "szamla@kitalalt.example",
      issueDate: "2026-11-11",
      fulfillmentDate: "2026-11-04",
      dueDate: "2026-11-19",
      paymentMethod: "Átutalás",
      showsPaymentFields: true,
      dueDateFollowsIssueDate: false,
      fingerprint: "f".repeat(64),
    });
    invoices.issue.mockResolvedValue({
      invoice: {
        ...draftSummary,
        status: "ISSUED",
        invoiceNumber: "ACRS-2026-9",
      },
      mail: { to: "szamla@kitalalt.example", sent: true },
    });
    render(
      <PartnerOrderCertificateInvoice
        certificateId="cert-1"
        certificateNumber="TI-2026-008"
        signed
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Kiállítás" }));
    const dialog = await screen.findByRole("dialog", {
      name: /^Kiállítod a számlát/,
    });
    await within(dialog).findByText("Kitalált Kft.");
    fireEvent.click(within(dialog).getByLabelText("Elküldöm e-mailben"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Számla kiállítása" }),
    );

    await waitFor(() =>
      expect(invoices.issue).toHaveBeenCalledWith("token-1", "inv-1", {
        issueDate: "2026-11-11",
        fulfillmentDate: "2026-11-04",
        dueDate: "2026-11-19",
        fingerprint: "f".repeat(64),
        send: true,
      }),
    );
    expect(await screen.findByText(/ACRS-2026-9/)).toBeInTheDocument();
    expect(screen.getByTestId("invoice-mail").textContent).toBe(
      "A számla elment: szamla@kitalalt.example.",
    );
  });
});
