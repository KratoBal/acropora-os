import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoices = vi.hoisted(() => ({
  byCertificate: vi.fn(),
  draft: vi.fn(),
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
});
