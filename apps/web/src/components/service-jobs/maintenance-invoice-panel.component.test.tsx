import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MaintenanceInvoiceSummary, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MaintenanceInvoicePanel } from "./maintenance-invoice-panel";

const certificatesApi = vi.hoisted(() => ({ list: vi.fn() }));
const invoiceApi = vi.hoisted(() => ({
  byCertificate: vi.fn(),
  draft: vi.fn(),
  downloadPdf: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/completion-certificates", () => ({
  completionCertificatesApi: certificatesApi,
}));
vi.mock("@/lib/api/maintenance-invoice", () => ({
  maintenanceInvoiceApi: invoiceApi,
}));

function session(token: string | undefined): Session {
  return {
    id: "session-1",
    token,
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "balazs@acropora.local",
      displayName: "Balázs",
      role: "OWNER",
      customerId: null,
      supplierId: null,
    },
  };
}

const signedCertificate = {
  id: "cert-1",
  number: "ALT-2026-001",
  issuedAt: "2026-09-24T00:00:00.000Z",
  issuedByName: null,
  documents: [
    {
      id: "doc-1",
      type: "SIGNED_FORM" as const,
      fileName: "igazolas-alairt.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      createdAt: "2026-09-24T00:00:00.000Z",
    },
  ],
};

const invoiceSummary: MaintenanceInvoiceSummary = {
  id: "invoice-1",
  status: "DRAFT",
  currency: "HUF",
  netAmount: "100000",
  vatAmount: "27000",
  grossAmount: "127000",
  createdAt: "2026-09-24T18:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.session = session("dev-token");
});

describe("MaintenanceInvoicePanel -- betöltés token nélkül", () => {
  /**
   * UGYANAZ A REGRESSZIÓS PRÓBA, MINT A `CompletionCertificatePanel`-en:
   * Balázs éles hibája (2026-09-24 17:39) -- `if (token)` a `useEffect`-ben
   * SOHA nem futna éles, süti-alapú bejelentkezésnél.
   */
  it("üres (undefined) tokennel is elindítja a betöltést", async () => {
    auth.session = session(undefined);
    certificatesApi.list.mockResolvedValue([]);

    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);

    await screen.findByText(/Nincs kiállítva teljesítési igazolás/);
    expect(certificatesApi.list).toHaveBeenCalledWith("", "job-1");
  });
});

describe("MaintenanceInvoicePanel", () => {
  it("shows a message and no button when there is no certificate", async () => {
    certificatesApi.list.mockResolvedValue([]);

    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);

    await screen.findByText(/Nincs kiállítva teljesítési igazolás/);
    expect(invoiceApi.byCertificate).not.toHaveBeenCalled();
  });

  it("shows a message when the certificate isn't signed yet", async () => {
    certificatesApi.list.mockResolvedValue([
      { ...signedCertificate, documents: [] },
    ]);

    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);

    await screen.findByText(/A teljesítési igazolás aláírt példánya hiányzik/);
  });

  it("offers a create-draft button when signed and no invoice exists yet", async () => {
    certificatesApi.list.mockResolvedValue([signedCertificate]);
    invoiceApi.byCertificate.mockResolvedValue(null);
    invoiceApi.draft.mockResolvedValue(invoiceSummary);

    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);

    const button = await screen.findByRole("button", {
      name: "Piszkozat készítése",
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(invoiceApi.draft).toHaveBeenCalledWith("dev-token", "cert-1"),
    );
    await screen.findByText("127000 HUF");
  });

  it("shows the amount, a download button and a disabled, labelled Kiállítás button when a draft exists", async () => {
    certificatesApi.list.mockResolvedValue([signedCertificate]);
    invoiceApi.byCertificate.mockResolvedValue(invoiceSummary);

    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);

    await screen.findByText("127000 HUF");
    const issueButton = screen.getByRole("button", { name: "Kiállítás" });
    expect(issueButton).toBeDisabled();
    expect(screen.getByText("A kiállítás még nincs bekapcsolva.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Előnézet letöltése" }),
    ).toBeTruthy();
  });
});
