import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { MaintenanceInvoiceSummary, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MaintenanceInvoicePanel } from "./maintenance-invoice-panel";

const certificatesApi = vi.hoisted(() => ({ list: vi.fn() }));
const invoiceApi = vi.hoisted(() => ({
  byCertificate: vi.fn(),
  draft: vi.fn(),
  issueSummary: vi.fn(),
  issue: vi.fn(),
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
  // a szerver alapértelmezése (146ccc61): a valódi kiállítás KI van kapcsolva
  issueEnabled: false,
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
    await screen.findByText("127 000 Ft");
  });

  it("shows the amount, a download button and a disabled, labelled Kiállítás button when a draft exists", async () => {
    certificatesApi.list.mockResolvedValue([signedCertificate]);
    invoiceApi.byCertificate.mockResolvedValue(invoiceSummary);

    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);

    await screen.findByText("127 000 Ft");
    const issueButton = screen.getByRole("button", { name: "Kiállítás" });
    expect(issueButton).toBeDisabled();
    expect(screen.getByText("A kiállítás még nincs bekapcsolva.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Előnézet letöltése" }),
    ).toBeTruthy();
  });

  /* the TIG invoice's confirmation window (card 7ba97e0d, S3): what the server's summary says */
  const ISSUE_SUMMARY = {
    buyerName: "Fővárosi Állatkert",
    buyerAddress: "1146 Budapest, Állatkerti körút 6-12.",
    buyerTaxNumber: "12345678-2-42",
    buyerEuTaxNumber: null,
    buyerEmail: "szamla@allatkert.example",
    issueDate: "2026-11-11",
    fulfillmentDate: "2026-09-24",
    dueDate: "2026-11-19",
    paymentMethod: "Átutalás",
    showsPaymentFields: true,
    dueDateFollowsIssueDate: false,
    fingerprint: "f".repeat(64),
  };
  const ISSUED = {
    ...invoiceSummary,
    status: "ISSUED" as const,
    invoiceNumber: "ACRS-2026-1",
    issuedAt: "2026-09-29T22:00:00.000Z",
    issueEnabled: true,
  };
  /** The window, once the summary is in (its buttons wait for it). */
  async function openWindow() {
    certificatesApi.list.mockResolvedValue([signedCertificate]);
    invoiceApi.byCertificate.mockResolvedValue({
      ...invoiceSummary,
      issueEnabled: true,
    });
    invoiceApi.issueSummary.mockResolvedValue(ISSUE_SUMMARY);
    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Kiállítás" }));
    const dialog = await screen.findByRole("dialog", {
      name: /^Kiállítod a számlát/,
    });
    await within(dialog).findByText(ISSUE_SUMMARY.buyerName);
    return dialog;
  }

  it("a bekapcsolt kiállítás a megerősítő ablakon át hív, és utána a számlaszámot és a valódi PDF-et mutatja", async () => {
    invoiceApi.issue.mockResolvedValue({ invoice: ISSUED, mail: null });
    const dialog = await openWindow();

    // A kattintás még NEM állít ki: előbb az ablak, a szerver összegzőjével és a következménnyel.
    expect(invoiceApi.issue).not.toHaveBeenCalled();
    expect(invoiceApi.issueSummary).toHaveBeenCalledWith(
      "dev-token",
      "invoice-1",
    );
    expect(dialog.textContent).toContain(ISSUE_SUMMARY.buyerAddress);
    expect(dialog.textContent).toContain(ISSUE_SUMMARY.buyerEmail);
    expect(dialog.textContent).toMatch(/NAV-nak bejelentett számla készül/);
    // The amount in the question reads as money, not as the stored "127000 HUF".
    expect(
      within(dialog).getByText("Kiállítod a számlát (127 000 Ft)?"),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Számla kiállítása" }),
    );

    // "Elküldöm e-mailben" starts unchecked: today the TIG invoice is not sent by itself
    await waitFor(() =>
      expect(invoiceApi.issue).toHaveBeenCalledWith("dev-token", "invoice-1", {
        issueDate: ISSUE_SUMMARY.issueDate,
        fulfillmentDate: ISSUE_SUMMARY.fulfillmentDate,
        dueDate: ISSUE_SUMMARY.dueDate,
        fingerprint: ISSUE_SUMMARY.fingerprint,
        send: false,
      }),
    );
    await screen.findByText("ACRS-2026-1");
    expect(
      screen.getByRole("button", { name: "Számla letöltése" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kiállítás" })).toBeNull();
    expect(screen.queryByTestId("invoice-mail")).toBeNull();
  });

  it("'Elküldöm e-mailben' bejelölve a kiállítás küldést kér, és a panel kiírja, hová ment", async () => {
    invoiceApi.issue.mockResolvedValue({
      invoice: ISSUED,
      mail: { to: ISSUE_SUMMARY.buyerEmail, sent: true },
    });
    const dialog = await openWindow();
    fireEvent.click(within(dialog).getByLabelText("Elküldöm e-mailben"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Számla kiállítása" }),
    );

    await waitFor(() =>
      expect(invoiceApi.issue).toHaveBeenCalledWith(
        "dev-token",
        "invoice-1",
        expect.objectContaining({ send: true }),
      ),
    );
    expect((await screen.findByTestId("invoice-mail")).textContent).toBe(
      "A számla elment: szamla@allatkert.example.",
    );
  });

  it("kiállítva, de a levél elbukott: a számlaszám látszik, a levél hibája külön", async () => {
    invoiceApi.issue.mockResolvedValue({
      invoice: ISSUED,
      mail: {
        to: ISSUE_SUMMARY.buyerEmail,
        sent: false,
        error: "A levélküldés ki van kapcsolva.",
      },
    });
    const dialog = await openWindow();
    fireEvent.click(within(dialog).getByLabelText("Elküldöm e-mailben"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Számla kiállítása" }),
    );

    await screen.findByText("ACRS-2026-1");
    expect(screen.getByTestId("invoice-mail").textContent).toContain(
      "a levél nem ment ki (szamla@allatkert.example): A levélküldés ki van kapcsolva.",
    );
    expect(screen.queryByRole("button", { name: "Kiállítás" })).toBeNull();
  });

  it("ha az összegző nem készül el, az ablak az okát mondja, és nem állít ki", async () => {
    certificatesApi.list.mockResolvedValue([signedCertificate]);
    invoiceApi.byCertificate.mockResolvedValue({
      ...invoiceSummary,
      issueEnabled: true,
    });
    invoiceApi.issueSummary.mockRejectedValue(
      new Error(
        "A teljesítési igazolás a piszkozat óta megváltozott: az összeg már nem egyezik. Készíts új piszkozatot.",
      ),
    );
    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Kiállítás" }));

    const dialog = await screen.findByRole("dialog", {
      name: /^Kiállítod a számlát/,
    });
    await within(dialog).findByText(/az összeg már nem egyezik/);
    expect(
      within(dialog).getByRole("button", { name: "Számla kiállítása" }),
    ).toBeDisabled();
    expect(invoiceApi.issue).not.toHaveBeenCalled();
  });

  it("pénzügyi jog nélkül a bekapcsolt kiállítás is tiltott, és megmondja, miért", async () => {
    auth.session = {
      ...session("dev-token"),
      user: { ...session("dev-token").user, role: "WAREHOUSE" },
    };
    certificatesApi.list.mockResolvedValue([signedCertificate]);
    invoiceApi.byCertificate.mockResolvedValue({
      ...invoiceSummary,
      issueEnabled: true,
    });

    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);

    expect(
      await screen.findByRole("button", { name: "Kiállítás" }),
    ).toBeDisabled();
    expect(
      screen.getByText("A kiállításhoz pénzügyi jogosultság kell."),
    ).toBeTruthy();
  });

  it("ellenőrzésre váró kiállításnál nem kínál sem kiállítást, sem letöltést, és kiírja az okát", async () => {
    certificatesApi.list.mockResolvedValue([signedCertificate]);
    invoiceApi.byCertificate.mockResolvedValue({
      ...invoiceSummary,
      status: "ISSUING",
      issueEnabled: true,
      issueNote: "A Számlázz.hu válasza nem érkezett meg (TimeoutError).",
    });

    render(<MaintenanceInvoicePanel serviceJobId="job-1" />);

    await screen.findByText(/válasza nem érkezett meg/);
    expect(screen.queryByRole("button", { name: "Kiállítás" })).toBeNull();
    expect(screen.queryByRole("button", { name: /letöltése/ })).toBeNull();
  });
});
