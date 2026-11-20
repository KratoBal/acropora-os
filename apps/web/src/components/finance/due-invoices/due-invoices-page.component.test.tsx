import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  DueInvoiceItem,
  DueInvoicesResponse,
  Session,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DueInvoicesPage } from "./due-invoices-page";

/*
  LEJÁRÓ SZÁMLÁK, A LISTA OLDAL (Balázs, 2026-11-20; acrobot 58227, 58229). MI PIROSÍT: ha a lista nem a szerver sorrendjében áll; ha egy
  lejárt tétel nincs külön jelölve (a napok száma is); ha a hiányzó bankszámlaszám, határidő vagy fizetési mód nem „nincs adat”-ot ír
  (vagy a sor kiesik); ha az összeg nem a hátralék a pénznemével; ha a közlemény nem jelzi, hogy alapértelmezés; ha az összesítő
  nem pénznemenként ír; ha jog nélkül is betölt; ha a hiba nem látszik és nem lehet újrapróbálni; ha az üres lista nem mond semmit.
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/due-invoices", () => ({ dueInvoicesApi: api }));

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

const row = (over: Partial<DueInvoiceItem> = {}): DueInvoiceItem => ({
  id: "row-1",
  documentNumber: "SZ-2026-7",
  supplierName: "Alfa Kft.",
  dueDate: "2026-11-25",
  overdue: false,
  daysOverdue: null,
  supplierBankAccount: "11700000-12345678-00000000",
  supplierBankAccountSource: "OWN",
  outstanding: "127000",
  currency: "HUF",
  reference: "SZ-2026-7",
  referenceIsDefault: true,
  paymentMethod: "Átutalás",
  missing: { dueDate: false, supplierBankAccount: false, paymentMethod: false },
  ...over,
});

const response = (
  items: DueInvoiceItem[],
  over: Partial<DueInvoicesResponse["summary"]> = {},
): DueInvoicesResponse => ({
  asOf: "2026-11-20",
  items,
  summary: {
    count: items.length,
    overdue: items.filter((i) => i.overdue).length,
    withMissingData: 0,
    totals: [{ currency: "HUF", outstanding: "127000" }],
    ...over,
  },
});

beforeEach(() => {
  auth.role = "OWNER";
  api.list.mockReset().mockResolvedValue(response([row()]));
});

describe("the due invoices page", () => {
  it("shows the five columns of a row: company, due date, bank account, outstanding with its currency, reference", async () => {
    render(<DueInvoicesPage />);
    const cell = await screen.findByText("Alfa Kft.");
    const tableRow = cell.closest("tr")!;
    expect(within(tableRow).getByText("2026. 11. 25.")).toBeInTheDocument();
    expect(
      within(tableRow).getByText("11700000-12345678-00000000"),
    ).toBeInTheDocument();
    expect(tableRow).toHaveTextContent(/127\s?000\s?Ft/);
    expect(within(tableRow).getByText("SZ-2026-7")).toBeInTheDocument();
    expect(
      within(tableRow).getByText("a számla száma (alapértelmezés)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("nincs adat")).toBeNull();
  });

  it("keeps the server's order and marks the overdue rows with the days", async () => {
    api.list.mockResolvedValue(
      response([
        row({
          id: "a",
          supplierName: "Régi Kft.",
          dueDate: "2026-10-02",
          overdue: true,
          daysOverdue: 49,
        }),
        row({ id: "b", supplierName: "Mai Kft.", dueDate: "2026-11-20" }),
        row({ id: "c", supplierName: "Késői Kft.", dueDate: "2026-12-15" }),
      ]),
    );
    render(<DueInvoicesPage />);
    await screen.findByText("Régi Kft.");
    const names = screen
      .getAllByRole("row")
      .map((r) => r.textContent ?? "")
      .filter((text) => /Kft\./.test(text));
    expect(names[0]).toContain("Régi Kft.");
    expect(names[1]).toContain("Mai Kft.");
    expect(names[2]).toContain("Késői Kft.");
    expect(screen.getByText("Lejárt (49 napja)")).toBeInTheDocument();
    // only one row is flagged
    expect(screen.getAllByText(/Lejárt \(/)).toHaveLength(1);
  });

  it("names the source of a supplied bank account under it, and writes nothing under an own one", async () => {
    api.list.mockResolvedValue(
      response([
        row({ id: "own", supplierName: "Saját Kft." }),
        row({
          id: "pdf",
          supplierName: "PDF Kft.",
          supplierBankAccount: "11773016-11111018",
          supplierBankAccountSource: "INVOICE_PDF",
        }),
        row({
          id: "other",
          supplierName: "Másik Kft.",
          supplierBankAccount: "10918001-00000017",
          supplierBankAccountSource: "OTHER_INVOICE",
        }),
      ]),
    );
    render(<DueInvoicesPage />);
    const ownRow = (await screen.findByText("Saját Kft.")).closest("tr")!;
    const pdfRow = screen.getByText("PDF Kft.").closest("tr")!;
    const otherRow = screen.getByText("Másik Kft.").closest("tr")!;
    expect(within(pdfRow).getByText("a számla PDF-jéből")).toBeInTheDocument();
    expect(
      within(otherRow).getByText("a szállító másik számlájáról"),
    ).toBeInTheDocument();
    expect(
      within(ownRow).queryByText(/PDF-jéből|másik számlájáról/),
    ).toBeNull();
  });

  it("writes 'nincs adat' for a missing bank account, due date and payment method, and keeps the row", async () => {
    api.list.mockResolvedValue(
      response(
        [
          row({
            id: "x",
            supplierName: "Hiányos Kft.",
            dueDate: null,
            supplierBankAccount: null,
            supplierBankAccountSource: null,
            paymentMethod: null,
            missing: {
              dueDate: true,
              supplierBankAccount: true,
              paymentMethod: true,
            },
          }),
        ],
        { withMissingData: 1 },
      ),
    );
    render(<DueInvoicesPage />);
    const tableRow = (await screen.findByText("Hiányos Kft.")).closest("tr")!;
    // the due date and the bank account cell, plus the payment method line under the company
    expect(within(tableRow).getAllByText("nincs adat")).toHaveLength(2);
    expect(
      within(tableRow).getByText(/fizetési mód: nincs adat/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("due-summary")).toHaveTextContent(
      "1 sorból hiányzik adat",
    );
  });

  it("the summary names the count, the overdue count and the totals per currency", async () => {
    api.list.mockResolvedValue(
      response(
        [
          row({
            id: "a",
            overdue: true,
            daysOverdue: 3,
            dueDate: "2026-11-17",
          }),
          row({ id: "b", currency: "EUR", outstanding: "115.50" }),
        ],
        {
          totals: [
            { currency: "EUR", outstanding: "115.50" },
            { currency: "HUF", outstanding: "127000" },
          ],
        },
      ),
    );
    render(<DueInvoicesPage />);
    const summary = await screen.findByTestId("due-summary");
    expect(summary).toHaveTextContent("2 számla, ebből 1 lejárt");
    expect(summary).toHaveTextContent(/115,50\s?EUR/);
    expect(summary).toHaveTextContent(/127\s?000\s?Ft/);
  });

  it("without the finance read right nothing loads", async () => {
    auth.role = "SERVICE";
    render(<DueInvoicesPage />);
    expect(
      await screen.findByText(/finance\.view jog kell/),
    ).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("an empty list says so, and an error shows with a retry", async () => {
    api.list.mockResolvedValueOnce(response([]));
    const { unmount } = render(<DueInvoicesPage />);
    expect(
      await screen.findByText(/Nincs kifizetetlen, átutalással fizetendő/),
    ).toBeInTheDocument();
    unmount();
    api.list
      .mockReset()
      .mockRejectedValueOnce(new Error("Szerverhiba"))
      .mockResolvedValueOnce(response([row()]));
    render(<DueInvoicesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Szerverhiba");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Újrapróbálás" }));
    await waitFor(() =>
      expect(screen.getByText("Alfa Kft.")).toBeInTheDocument(),
    );
  });
});
