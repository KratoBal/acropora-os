import {
  act,
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
  MissingInvoiceItemDetail,
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
  item: vi.fn(),
  match: vi.fn(),
  unmatch: vi.fn(),
  comment: vi.fn(),
  category: vi.fn(),
  uploadDocument: vi.fn(),
  uploadStatement: vi.fn(),
  missingList: vi.fn(),
  accountantPackage: vi.fn(),
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
  tiles: { found: 27, notMatched: 15, noInvoice: 25, noInvoiceNeeded: 24 },
  items: [item()],
  pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
  ...overrides,
});

const itemDetail = (
  overrides: Partial<MissingInvoiceItemDetail> = {},
): MissingInvoiceItemDetail => ({
  ...item(),
  candidates: [
    {
      documentId: "inv-2",
      number: "INV-2026-08177",
      date: "2026-07-04",
      gross: "21990",
      currency: "HUF",
      source: "DRIVE",
      payee: "COMPANY",
    },
  ],
  action: "REQUEST_REISSUE_TO_COMPANY",
  driveFolderUrl: null,
  ...overrides,
});

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
        noInvoiceNeeded: 24,
        missingAmountHuf: "693967",
        status: "INCOMPLETE",
        missingStatementAccounts: [],
      },
    ],
  });
  api.month.mockResolvedValue(monthDetail());
  api.item.mockResolvedValue(itemDetail());
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

  it("pairing: the explicit match call, then the month reloads with the server's new counts", async () => {
    urlNavigation.reset("/penzugy/hianyzo-szamlak/2026-08");
    api.match.mockResolvedValue(
      itemDetail({
        state: "FOUND",
        document: { id: "inv-2", number: "INV-2026-08177", source: "DRIVE" },
        matchedBy: "MANUAL",
        action: "NONE",
      }),
    );
    render(<MissingInvoicesMonthPage month="2026-08" />);
    fireEvent.click(
      await screen.findByRole("row", {
        name: "OPENAI *CHATGPT SUBSCR, 2026. 08. 03.",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    // a cég neve a szerverről (a hónaplista hívásából), nem a felületből
    await waitFor(() =>
      expect(
        within(dialog).getByRole("region", { name: "Mit kell tenni" }),
      ).toHaveTextContent("kérd újra az Szerver Kft. nevére"),
    );
    api.month.mockResolvedValue(
      monthDetail({
        tiles: {
          found: 28,
          notMatched: 15,
          noInvoice: 24,
          noInvoiceNeeded: 24,
        },
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Párosítás" }));
    await waitFor(() =>
      expect(api.match).toHaveBeenCalledWith(
        "token-1",
        "debit-1",
        "inv-2",
        "DRIVE",
      ),
    );
    await waitFor(() => expect(api.month).toHaveBeenCalledTimes(2));
    const tile = screen
      .getAllByText("Megvan")
      .find((node) => node.closest("article"))!
      .closest("article")!;
    await waitFor(() => expect(tile).toHaveTextContent("28"));
    expect(
      await within(dialog).findByRole("button", {
        name: "Párosítás visszavonása",
      }),
    ).toBeInTheDocument();
  });

  it("the note is saved through the comment endpoint", async () => {
    urlNavigation.reset("/penzugy/hianyzo-szamlak/2026-08");
    api.comment.mockResolvedValue(itemDetail({ comment: "Kérve e-mailben" }));
    render(<MissingInvoicesMonthPage month="2026-08" />);
    fireEvent.click(
      await screen.findByRole("row", {
        name: "OPENAI *CHATGPT SUBSCR, 2026. 08. 03.",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Megjegyzés"), {
      target: { value: "  Kérve e-mailben " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mentés" }));
    await waitFor(() =>
      expect(api.comment).toHaveBeenCalledWith(
        "token-1",
        "debit-1",
        "Kérve e-mailben",
      ),
    );
  });

  it("the statement upload and the two exports call their own endpoints", async () => {
    urlNavigation.reset("/penzugy/hianyzo-szamlak/2026-08");
    api.uploadStatement.mockResolvedValue({});
    api.missingList.mockResolvedValue(new Blob(["x"]));
    api.accountantPackage.mockResolvedValue(new Blob(["%PDF"]));
    // a happy-dom URL-je nem ad blob-címet: a két statikus tagot pótoljuk
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
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

    fireEvent.click(
      screen.getByRole("button", { name: "Hiánylista letöltése" }),
    );
    await waitFor(() =>
      expect(api.missingList).toHaveBeenCalledWith("token-1", "2026-08"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Könyvelői csomag" }));
    await waitFor(() =>
      expect(api.accountantPackage).toHaveBeenCalledWith("token-1", "2026-08"),
    );
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("a viewer (finance.view only) reads, but has no export, upload or pairing", async () => {
    auth.role = "VIEWER";
    urlNavigation.reset("/penzugy/hianyzo-szamlak/2026-08");
    render(<MissingInvoicesMonthPage month="2026-08" />);
    fireEvent.click(
      await screen.findByRole("row", {
        name: "OPENAI *CHATGPT SUBSCR, 2026. 08. 03.",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await act(async () => {});
    expect(screen.queryByRole("group", { name: "Exportok" })).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Párosítás" }),
    ).toBeNull();
    expect(within(dialog).queryByLabelText("Számla PDF")).toBeNull();
  });
});
