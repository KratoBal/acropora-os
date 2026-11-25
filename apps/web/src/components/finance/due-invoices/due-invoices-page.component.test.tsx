import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  DueInvoiceItem,
  DueInvoicesResponse,
  Session,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { urlNavigation } from "@/test/url-navigation";

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
// a rendezés az URL-ben áll (`useUrlSort`): a közös, élő URL-hamisító
vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);

const api = vi.hoisted(() => ({ list: vi.fn(), setSupplierAccount: vi.fn() }));
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
  probablyNotTransfer: [],
  summary: {
    count: items.length,
    overdue: items.filter((i) => i.overdue).length,
    withMissingData: 0,
    totals: [{ currency: "HUF", outstanding: "127000" }],
    probablyNotTransfer: { count: 0, totals: [] },
    ...over,
  },
});

beforeEach(() => {
  urlNavigation.reset("/penzugy/lejaro-szamlak");
  auth.role = "OWNER";
  api.list.mockReset().mockResolvedValue(response([row()]));
  api.setSupplierAccount.mockReset();
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

  /* A rendezés (Balázs kérése, kártya 2f6369a4): kliensoldali (a lista minden sort betölt), az URL-ben, mindkét táblára ugyanaz. */
  it("a fejlécre kattintva a sorok a böngészőben rendeződnek (asc, desc, alap), a nincs-határidős sor a végén", async () => {
    api.list.mockResolvedValue(
      response([
        row({
          id: "a",
          supplierName: "Béla Kft.",
          dueDate: "2026-12-15",
          outstanding: "900",
        }),
        row({
          id: "b",
          supplierName: "Ábel Kft.",
          dueDate: null,
          outstanding: "10000",
        }),
        row({
          id: "c",
          supplierName: "Zita Kft.",
          dueDate: "2026-10-02",
          outstanding: "250",
        }),
      ]),
    );
    render(<DueInvoicesPage />);
    await screen.findByText("Béla Kft.");
    const order = () =>
      screen
        .getAllByRole("row")
        .map((r) => /(Béla|Ábel|Zita) Kft\./.exec(r.textContent ?? "")?.[1])
        .filter(Boolean)
        .join(",");
    expect(order()).toBe("Béla,Ábel,Zita"); // a szerver sorrendje
    const header = (name: RegExp) =>
      within(screen.getByRole("columnheader", { name })).getByRole("button");
    fireEvent.click(header(/Összeg/));
    await waitFor(() => expect(order()).toBe("Zita,Béla,Ábel")); // 250, 900, 10000: számként
    fireEvent.click(header(/Összeg/));
    await waitFor(() => expect(order()).toBe("Ábel,Béla,Zita"));
    fireEvent.click(header(/Összeg/));
    await waitFor(() => expect(order()).toBe("Béla,Ábel,Zita")); // vissza az alapra
    fireEvent.click(header(/Fizetési határidő/));
    await waitFor(() => expect(order()).toBe("Zita,Béla,Ábel")); // az üres határidő a végén
    fireEvent.click(header(/Fizetési határidő/));
    await waitFor(() => expect(order()).toBe("Béla,Zita,Ábel")); // csökkenőben is a végén
    fireEvent.click(header(/Cég/));
    await waitFor(() => expect(order()).toBe("Ábel,Béla,Zita")); // magyar ábécé: az Á az A-val
  });

  it("csak a Cég, a Fizetési határidő, az Összeg és a Közlemény rendezhető: a Bankszámlaszám nem", async () => {
    render(<DueInvoicesPage />);
    await screen.findByText("Alfa Kft.");
    for (const name of [/Cég/, /Fizetési határidő/, /Összeg/, /Közlemény/])
      expect(
        within(screen.getByRole("columnheader", { name })).getAllByRole(
          "button",
        ),
      ).toHaveLength(1);
    expect(
      within(
        screen.getByRole("columnheader", { name: /Bankszámlaszám/ }),
      ).queryByRole("button"),
    ).toBeNull();
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

/*
  A SZÁLLÍTÓI SZÁMLASZÁM KÉZI MEGADÁSA A LISTÁN (acrobot 58655). MI PIROSÍT: ha a Pénzügy írási joga nélkül is lenne megadó gomb; ha a számla saját vagy a törzsből/másik számláról pótolt számlaszám mellett
  is lenne; ha a hiányzó vagy a kitöltésből jött számlaszám mellett nem; ha a mentés nem a beírt számlaszámmal és a sor azonosítójával menne; ha a szerver mondata (érvénytelen, nem megengedett)
  nem látszana; ha a csere megerősítés nélkül menne, vagy a megerősítés nem küldené a confirmReplace-t; ha mentés után a lista nem töltődne újra.
*/
describe("entering a supplier bank account by hand", () => {
  const missing = row({
    id: "m",
    supplierName: "Hiányos Kft.",
    supplierBankAccount: null,
    supplierBankAccountSource: null,
    missing: {
      dueDate: false,
      supplierBankAccount: true,
      paymentMethod: false,
    },
  });
  const fromPdf = row({
    id: "p",
    supplierName: "PDF Kft.",
    supplierBankAccount: "11773016-11111018",
    supplierBankAccountSource: "INVOICE_PDF",
  });

  it("offers the entry only to the finance manage right, and only where it can take effect", async () => {
    api.list.mockResolvedValue(
      response([
        missing,
        fromPdf,
        row({ id: "o", supplierName: "Saját Kft." }),
        row({
          id: "x",
          supplierName: "Másik Kft.",
          supplierBankAccount: "10918001-00000017",
          supplierBankAccountSource: "OTHER_INVOICE",
        }),
        row({
          id: "t",
          supplierName: "Törzs Kft.",
          supplierBankAccount: "10918001-00000017",
          supplierBankAccountSource: "MASTER",
        }),
      ]),
    );
    render(<DueInvoicesPage />);
    const rowOf = async (name: string) =>
      (await screen.findByText(name)).closest("tr")!;
    expect(
      within(await rowOf("Hiányos Kft.")).getByText("Számlaszám megadása"),
    ).toBeInTheDocument();
    expect(
      within(await rowOf("PDF Kft.")).getByText("Csere"),
    ).toBeInTheDocument();
    for (const name of ["Saját Kft.", "Másik Kft.", "Törzs Kft."])
      expect(
        within(await rowOf(name)).queryByRole("button", {
          name: /megadása|Csere/,
        }),
      ).toBeNull();
  });

  it("shows nothing without the finance manage right", async () => {
    auth.role = "VIEWER";
    api.list.mockResolvedValue(response([missing]));
    render(<DueInvoicesPage />);
    await screen.findByText("Hiányos Kft.");
    expect(screen.queryByText("Számlaszám megadása")).toBeNull();
  });

  it("saves the typed account for the row and reloads the list", async () => {
    api.list.mockResolvedValue(response([missing]));
    api.setSupplierAccount.mockResolvedValue({
      account: "11773016-11111018",
      changed: true,
    });
    const user = userEvent.setup();
    render(<DueInvoicesPage />);
    await user.click(await screen.findByText("Számlaszám megadása"));
    await user.type(
      screen.getByLabelText(/Bankszámlaszám: Hiányos Kft\./),
      "11773016-11111018",
    );
    await user.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(api.setSupplierAccount).toHaveBeenCalledWith("token-1", "m", {
        account: "11773016-11111018",
      }),
    );
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it("shows the server's sentence when the entry is refused", async () => {
    api.list.mockResolvedValue(response([missing]));
    api.setSupplierAccount.mockRejectedValue(
      new ApiError(
        "A számlaszám nem érvényes: az ellenőrző összeg nem stimmel.",
        400,
      ),
    );
    const user = userEvent.setup();
    render(<DueInvoicesPage />);
    await user.click(await screen.findByText("Számlaszám megadása"));
    await user.type(
      screen.getByLabelText(/Bankszámlaszám:/),
      "11773016-11111019",
    );
    await user.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A számlaszám nem érvényes",
    );
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("replaces a filled account only after a separate confirmation that sends confirmReplace", async () => {
    api.list.mockResolvedValue(response([fromPdf]));
    api.setSupplierAccount
      .mockRejectedValueOnce(
        new ApiError(
          "A szállítónak már van számlaszáma ...1018 (a számla PDF-jéből). A csere külön megerősítés.",
          409,
        ),
      )
      .mockResolvedValueOnce({ account: "10918001-00000017", changed: true });
    const user = userEvent.setup();
    render(<DueInvoicesPage />);
    await user.click(await screen.findByText("Csere"));
    await user.type(
      screen.getByLabelText(/Bankszámlaszám:/),
      "10918001-00000017",
    );
    await user.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("...1018");
    expect(api.setSupplierAccount).toHaveBeenCalledTimes(1);
    expect(api.setSupplierAccount).toHaveBeenLastCalledWith("token-1", "p", {
      account: "10918001-00000017",
    });
    await user.click(
      screen.getByRole("button", { name: "Csere megerősítése" }),
    );
    await waitFor(() =>
      expect(api.setSupplierAccount).toHaveBeenLastCalledWith("token-1", "p", {
        account: "10918001-00000017",
        confirmReplace: true,
      }),
    );
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it("shows the probably-not-transfer section with each row's reason, its own count and sum, and nothing when it is empty", async () => {
    const moved = {
      ...row({
        id: "card-1",
        supplierName: "Kártyás Kft.",
        outstanding: "79057",
        paymentMethod: null,
        missing: {
          dueDate: false,
          supplierBankAccount: false,
          paymentMethod: true,
        },
      }),
      evidence: { kind: "CARD" as const, cardInvoices: 2 },
    };
    api.list.mockResolvedValue({
      ...response([row()]),
      probablyNotTransfer: [moved],
      summary: {
        ...response([row()]).summary,
        probablyNotTransfer: {
          count: 1,
          totals: [{ currency: "HUF", outstanding: "79057" }],
        },
      },
    });
    render(<DueInvoicesPage />);
    const section = await screen.findByTestId("probably-not-transfer");
    expect(
      within(section).getByText("Valószínűleg nem utalandó"),
    ).toBeInTheDocument();
    expect(within(section).getByText("Kártyás Kft.")).toBeInTheDocument();
    expect(
      within(section).getByText(
        "a szállító másik 2 számláját kártyával fizettük",
      ),
    ).toBeInTheDocument();
    expect(section).toHaveTextContent(/1\s+számla, hátralék:\s+79\s?057\s?Ft/);
    // the main table still holds only the transfer row
    expect(screen.getByText("Alfa Kft.")).toBeInTheDocument();
    expect(screen.getByTestId("due-summary")).toHaveTextContent(/1 számla/);
  });

  it("shows no section when no row moved", async () => {
    render(<DueInvoicesPage />);
    await screen.findByText("Alfa Kft.");
    expect(screen.queryByTestId("probably-not-transfer")).toBeNull();
  });
});
