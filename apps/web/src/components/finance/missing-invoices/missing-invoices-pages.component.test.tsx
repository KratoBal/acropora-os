import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { urlNavigation } from "@/test/url-navigation";

import { MissingInvoicesMonthPage } from "./missing-invoices-month-page";
import { MissingInvoicesPage } from "./missing-invoices-page";
import type {
  MissingInvoiceItem,
  MissingInvoiceMonthDetail,
} from "./missing-invoices-wire";

/**
 * A HIÁNYZÓ SZÁMLÁK BEKÖTÉSE (nautilus szerződése, a végpontok a mockban).
 *
 * MI PIROSÍT: ha a szűrők nem az URL-ből mennének a szervernek; ha egy
 * párosítás után a hónap nem töltődne újra (a csempék a szerver számai); ha a
 * cég neve nem a szerverről jönne; ha egy csak néző szerep módosíthatna; ha a
 * kivonat-feltöltés vagy egy export nem a saját végpontját hívná.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);

const api = vi.hoisted(() => ({
  months: vi.fn(),
  month: vi.fn(),
  uploadStatement: vi.fn(),
}));
vi.mock("@/lib/api/missing-invoices", () => ({ missingInvoicesApi: api }));

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

const COMPANY = { name: "Szerver Kft.", taxNumber: "99999999" };

const item = (
  overrides: Partial<MissingInvoiceItem> = {},
): MissingInvoiceItem => ({
  id: "debit-1",
  bookingDate: "2026-08-03",
  account: { id: "acc-card", name: "Kártyás számla" },
  partner: "OPENAI *CHATGPT SUBSCR",
  narrative: "OPENAI *CHATGPT SUBSCR / CARD 4821",
  amount: "21990",
  currency: "HUF",
  original: { amount: "55.38", currency: "EUR" },
  category: "CARD_SUBSCRIPTION",
  categoryRule: "Kártyás terhelés.",
  categoryOverridden: false,
  state: "NOT_COMPANY",
  document: null,
  matchedBy: null,
  comment: null,
  ...overrides,
});

const monthDetail = (
  overrides: Partial<MissingInvoiceMonthDetail> = {},
): MissingInvoiceMonthDetail => ({
  month: "2026-08",
  status: "INCOMPLETE",
  accounts: [
    {
      id: "acc-main",
      name: "Fő számla",
      accountNumber: "11773",
      currency: "HUF",
      hasStatement: true,
    },
    {
      id: "acc-card",
      name: "Kártyás számla",
      accountNumber: "11774",
      currency: "HUF",
      hasStatement: true,
    },
  ],
  tiles: {
    found: 27,
    notMatched: 15,
    noInvoice: 25,
    originalMissing: 0,
    noInvoiceNeeded: 24,
  },
  items: [item()],
  pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
  ...overrides,
});

const IMPORT_RESULT = {
  importId: "imp-1",
  fileName: "export-24.csv",
  rowCount: 40,
  createdCount: 25,
  skippedCount: 3,
  rejected: Array.from({ length: 10 }, (_, index) => ({
    line: index + 7,
    reason:
      index === 0 ? "A dátum nem olvasható: 2026.13.01" : "Az összeg nem szám.",
  })),
  rejectedCount: 12,
  accounts: [{ accountNumber: "11773016-11111111", currency: "HUF" }],
  months: ["2026-08", "2026-09"],
};

beforeEach(() => {
  auth.role = "OWNER";
  for (const fn of Object.values(api)) fn.mockReset();
  api.months.mockResolvedValue({
    company: COMPANY,
    months: [
      {
        month: "2026-08",
        debitCount: 67,
        found: 27,
        notMatched: 15,
        noInvoice: 25,
        originalMissing: 0,
        noInvoiceNeeded: 24,
        missingAmountHuf: "693967",
        status: "INCOMPLETE",
        missingStatementAccounts: [],
      },
    ],
  });
  api.month.mockResolvedValue(monthDetail());
});

describe("MissingInvoicesPage", () => {
  beforeEach(() => urlNavigation.reset("/penzugy/hianyzo-szamlak"));

  it("the months from the server, the company from the server, a row opens the month", async () => {
    render(<MissingInvoicesPage />);
    const row = await screen.findByRole("row", {
      name: "2026. augusztus megnyitása",
    });
    expect(
      screen.getByText(
        "Csak az Szerver Kft. (adószám: 99999999) nevére szóló számla számít meglévőnek.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(row);
    expect(urlNavigation.push).toHaveBeenCalledWith(
      "/penzugy/hianyzo-szamlak/2026-08",
    );
  });

  it("the first statement can be uploaded from the month list, and its result shows", async () => {
    api.uploadStatement.mockResolvedValue({
      ...IMPORT_RESULT,
      rejected: [],
      rejectedCount: 0,
    });
    render(<MissingInvoicesPage />);
    await screen.findByRole("row", { name: "2026. augusztus megnyitása" });
    expect(
      screen.getByRole("button", { name: "Kivonat feltöltése" }),
    ).toBeInTheDocument();
    const csv = new File(["a;b"], "export-24.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Bankkivonat CSV"), {
      target: { files: [csv] },
    });
    const result = await screen.findByRole("region", {
      name: "A kivonat-feltöltés eredménye",
    });
    expect(result).toHaveTextContent("A kivonat feltöltve");
    expect(result).not.toHaveTextContent("elutasítva");
    await waitFor(() => expect(api.months).toHaveBeenCalledTimes(2));
  });

  it("a viewer gets no upload button", async () => {
    auth.role = "VIEWER";
    render(<MissingInvoicesPage />);
    await screen.findByRole("row", { name: "2026. augusztus megnyitása" });
    expect(
      screen.queryByRole("button", { name: "Kivonat feltöltése" }),
    ).toBeNull();
  });

  it("a role without finance.view gets no data call", () => {
    auth.role = "WAREHOUSE";
    render(<MissingInvoicesPage />);
    expect(api.months).not.toHaveBeenCalled();
    expect(screen.getByText(/finance.view jog kell/)).toBeInTheDocument();
  });
});

describe("MissingInvoicesMonthPage", () => {
  it("asks with the URL's tab, filters and page; a tab change goes to the URL and back to page one", async () => {
    urlNavigation.reset(
      "/penzugy/hianyzo-szamlak/2026-08",
      "tab=FOUND&category=INSURANCE&accountId=acc-card&page=2&q=Allianz",
    );
    render(<MissingInvoicesMonthPage month="2026-08" />);
    await waitFor(() => expect(api.month).toHaveBeenCalled());
    const [, month, query] = api.month.mock.calls[0]!;
    expect(month).toBe("2026-08");
    expect(query).toEqual({
      tab: "FOUND",
      q: "Allianz",
      category: "INSURANCE",
      accountId: "acc-card",
      page: 2,
      pageSize: 25,
    });
    fireEvent.click(await screen.findByRole("tab", { name: "Nem párosodott" }));
    const tabHref = urlNavigation.replace.mock.calls
      .map(([href]) => href as string)
      .find((href) => href.includes("tab=NOT_MATCHED"));
    expect(tabHref).toBeDefined();
    expect(tabHref).not.toContain("page=");
    expect(tabHref).toContain("category=INSURANCE");
  });

  it("the statement upload calls its endpoint, shows the result, and there is no export yet", async () => {
    urlNavigation.reset("/penzugy/hianyzo-szamlak/2026-08");
    api.uploadStatement.mockResolvedValue(IMPORT_RESULT);
    render(<MissingInvoicesMonthPage month="2026-08" />);
    await screen.findByRole("heading", { level: 1, name: "2026. augusztus" });

    const csv = new File(["a;b"], "export-24.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Bankkivonat CSV"), {
      target: { files: [csv] },
    });
    await waitFor(() =>
      expect(api.uploadStatement).toHaveBeenCalledWith("token-1", csv),
    );
    await waitFor(() => expect(api.month).toHaveBeenCalledTimes(2));
    // AZ ELUTASÍTOTT SOR NEM TŰNIK EL CSENDBEN (acrobot 25333)
    const result = await screen.findByRole("region", {
      name: "A kivonat-feltöltés eredménye",
    });
    expect(result).toHaveTextContent(
      "export-24.csv: 40 sor olvasva, 25 új, 3 már megvolt, 12 elutasítva.",
    );
    expect(result).toHaveTextContent(
      "7. sor: A dátum nem olvasható: 2026.13.01",
    );
    expect(result).toHaveTextContent(
      "És további 2 elutasított sor, ami itt nem látszik.",
    );
    expect(
      within(result).getByRole("link", { name: "2026. augusztus" }),
    ).toHaveAttribute("href", "/penzugy/hianyzo-szamlak/2026-08");

    // AZ EXPORT VÉGPONTJAI NAUTILUS 5. SZELETÉVEL JÖNNEK: addig nincs gomb
    expect(screen.queryByRole("group", { name: "Exportok" })).toBeNull();
  });

  it("a row opens the drawer with its data, read-only, saying the details come next", async () => {
    urlNavigation.reset("/penzugy/hianyzo-szamlak/2026-08");
    render(<MissingInvoicesMonthPage month="2026-08" />);
    fireEvent.click(
      await screen.findByRole("row", {
        name: "OPENAI *CHATGPT SUBSCR, 2026. 08. 03.",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "OPENAI *CHATGPT SUBSCR",
    });
    expect(dialog).toHaveTextContent("OPENAI *CHATGPT SUBSCR / CARD 4821");
    expect(dialog).toHaveTextContent(
      "A javasolt számlák, a párosítás és a számla feltöltése a következő lépésben érkezik.",
    );
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Párosítás" }),
    ).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Mentés" })).toBeNull();
  });
});
