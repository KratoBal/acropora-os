import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MissingInvoicesDrawer,
  type ChargeDetailExtras,
} from "./missing-invoices-drawer";
import {
  TAB_STATES,
  formatMonth,
  whatToDo,
  type ChargeRow,
  type MonthRow,
} from "./missing-invoices-model";
import { MissingInvoicesMonthDetail } from "./missing-invoices-month-detail";
import { MissingInvoicesMonthList } from "./missing-invoices-month-list";

/**
 * HIÁNYZÓ SZÁMLÁK, A FELÜLET (Balázs briefje, 2026-09-30; Figma 343:2; a
 * kulcsnevek nautilus szerződéséből).
 *
 * MI PIROSÍT: ha egy kivonat nélküli hónap nullákat mutatna "—" helyett; ha a
 * részleges kivonat nem mondaná meg, melyik számlához hiányzik; ha a Hiányzik
 * fül nem a négy problémás állapotot fogná; ha a cég neve vagy adószáma a
 * komponensbe égne; ha a partner-oszlop fix szélességet kapna, vagy a
 * számoszlopok elveszítenék a sajátjukat (az 1280-as mérce); ha a drawer
 * magától párosítana, a szabály szerinti párosítást is visszavonhatóvá tenné,
 * fiktív Drive-linket mutatna, vagy nem PDF-et engedne.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const COMPANY = { name: "Próba Kft.", taxNumber: "11111111" };

const charge = (overrides: Partial<ChargeRow> = {}): ChargeRow => ({
  id: "c-1",
  date: "2026-08-03",
  account: { id: "acc-card", name: "Kártyás számla" },
  partner: "OPENAI *CHATGPT SUBSCR",
  narrative: "OPENAI *CHATGPT SUBSCR / CARD 4821 / DUBLIN IE",
  amount: "21990",
  currency: "HUF",
  original: { amount: "55.38", currency: "EUR" },
  category: "CARD_SUBSCRIPTION",
  categoryRule: "Kártyás terhelés, ismert előfizetés-kereskedő.",
  categoryOverridden: false,
  state: "NOT_COMPANY",
  document: null,
  matchedBy: null,
  comment: null,
  paperOriginal: false,
  ...overrides,
});

describe("the model", () => {
  it("Hiányzik is every state that still needs work, and nothing else", () => {
    expect([...TAB_STATES.MISSING].sort()).toEqual(
      [
        "NO_INVOICE",
        "NOT_COMPANY",
        "NOT_MATCHED",
        "ORIGINAL_MISSING",
        "PROFORMA_ONLY",
      ].sort(),
    );
    expect(TAB_STATES.MISSING).not.toContain("FOUND");
    expect(TAB_STATES.MISSING).not.toContain("NO_INVOICE_NEEDED");
  });

  it("months, and the company name in the what-to-do text", () => {
    expect(formatMonth("2026-08")).toBe("2026. augusztus");
    expect(whatToDo("REQUEST_REISSUE_TO_COMPANY", "Próba Kft.")).toBe(
      "A számla a magánszemély nevére szól: kérd újra az Próba Kft. nevére.",
    );
    expect(whatToDo("NONE", "Próba Kft.")).toBeNull();
  });
});

describe("MissingInvoicesMonthList", () => {
  const months: MonthRow[] = [
    {
      month: "2026-10",
      state: "STATEMENT_PARTIAL",
      counts: {
        charges: 12,
        found: 10,
        notMatched: 1,
        noInvoice: 1,
        originalMissing: 0,
      },
      missingAmountHuf: "15000",
      missingStatementAccounts: ["EUR számla"],
    },
    {
      month: "2026-09",
      state: "STATEMENT_MISSING",
      counts: {
        charges: 0,
        found: 0,
        notMatched: 0,
        noInvoice: 0,
        originalMissing: 0,
      },
      missingAmountHuf: "0",
      missingStatementAccounts: ["Fő számla", "Kártyás számla", "EUR számla"],
    },
    {
      month: "2026-08",
      state: "INCOMPLETE",
      counts: {
        charges: 70,
        found: 27,
        notMatched: 15,
        noInvoice: 25,
        originalMissing: 3,
      },
      missingAmountHuf: "693967",
      missingStatementAccounts: [],
    },
  ];
  const renderList = (
    props: Partial<Parameters<typeof MissingInvoicesMonthList>[0]> = {},
  ) => {
    const onOpen = vi.fn();
    render(
      <MissingInvoicesMonthList
        months={months}
        error={null}
        onRetry={vi.fn()}
        onOpen={onOpen}
        company={COMPANY}
        {...props}
      />,
    );
    return { onOpen };
  };

  it("a month without a statement shows dashes, not zeros, and its own state", () => {
    renderList();
    const september = screen.getByRole("row", {
      name: "2026. szeptember megnyitása",
    });
    expect(within(september).queryByText("0")).toBeNull();
    expect(within(september).queryByText("0 Ft")).toBeNull();
    expect(within(september).getAllByText("—")).toHaveLength(6);
    expect(within(september).getByText("Kivonat hiányzik")).toBeInTheDocument();
    const august = screen.getByRole("row", {
      name: "2026. augusztus megnyitása",
    });
    expect(within(august).getByText("693 967 Ft")).toBeInTheDocument();
    expect(within(august).getByText("Hiányos")).toBeInTheDocument();
  });

  it("a partial statement keeps its numbers and names the account without one", () => {
    renderList();
    const october = screen.getByRole("row", {
      name: "2026. október megnyitása",
    });
    expect(within(october).getByText("Részleges kivonat")).toBeInTheDocument();
    expect(
      within(october).getByText("Nincs kivonat: EUR számla"),
    ).toBeInTheDocument();
    expect(within(october).getByText("15 000 Ft")).toBeInTheDocument();
  });

  /*
    AZ EREDETI HIÁNYZIK A HÓNAP SORÁBAN (acrobot 25328; a Figmában nincs), és
    az 1280-as mérce a hónaplistán: az Állapot oszlop az egyetlen szélesség
    nélküli, és a fix oszlopok mellett 1280-on is elfér a leghosszabb jelvény.
  */
  it("the month row counts the missing originals, and the state column keeps room at 1280", () => {
    renderList();
    const august = screen.getByRole("row", {
      name: "2026. augusztus megnyitása",
    });
    const table = august.closest("table")!;
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    const cells = within(august).getAllByRole("cell");
    expect(cells[headers.indexOf("Eredeti hiányzik")]).toHaveTextContent("3");
    const cols = [...table.querySelectorAll("col")] as HTMLElement[];
    expect(cols[headers.indexOf("Állapot")]!.style.width).toBe("");
    const fixed = cols.reduce(
      (sum, col) => sum + (parseInt(col.style.width, 10) || 0),
      0,
    );
    // az 1280-as tartalomszélesség ~968 px; a "Kész a könyvelőnek" ~150 px
    expect(968 - fixed).toBeGreaterThanOrEqual(150);
  });

  it("the whole row opens the month", () => {
    const { onOpen } = renderList();
    fireEvent.click(
      screen.getByRole("row", { name: "2026. augusztus megnyitása" }),
    );
    expect(onOpen).toHaveBeenCalledWith("2026-08");
  });

  it("the company rule names the configured company, not a hardcoded one", () => {
    renderList();
    expect(
      screen.getByText(
        "Csak az Próba Kft. (adószám: 11111111) nevére szóló számla számít meglévőnek.",
      ),
    ).toBeInTheDocument();
  });

  it("loading, empty and error are three different pages", () => {
    const { unmount } = render(
      <MissingInvoicesMonthList
        months={null}
        error={null}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        company={null}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("betöltése");
    unmount();
    const onRetry = vi.fn();
    render(
      <MissingInvoicesMonthList
        months={null}
        error="A hónapok nem tölthetők be."
        onRetry={onRetry}
        onOpen={vi.fn()}
        company={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Újrapróbálás" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("MissingInvoicesMonthDetail", () => {
  type Props = Parameters<typeof MissingInvoicesMonthDetail>[0];
  const accounts = [
    { id: "acc-main", name: "Fő számla", hasStatement: true },
    { id: "acc-card", name: "Kártyás számla", hasStatement: true },
    { id: "acc-eur", name: "EUR számla", hasStatement: true },
  ];
  const base = (): Props => ({
    month: "2026-08",
    accounts,
    state: "INCOMPLETE",
    summary: {
      found: 27,
      notMatched: 15,
      noInvoice: 25,
      originalMissing: 3,
      noInvoiceNeeded: 24,
    },
    tab: "MISSING",
    onTab: vi.fn(),
    filters: { search: "", category: "", accountId: "" },
    onFilters: vi.fn(),
    rows: [
      charge(),
      charge({
        id: "c-2",
        partner:
          "von Wussow Importe GmbH Handelsgesellschaft für Aquaristik und Zubehör",
        original: null,
        amount: "468",
        currency: "EUR",
        account: { id: "acc-eur", name: "EUR számla" },
        category: "FOREIGN_SUPPLIER",
        state: "NO_INVOICE",
        document: { number: "AC-2026-881", source: "NAV" },
      }),
    ],
    totalItems: 40,
    page: 1,
    pageSize: 7,
    totalPages: 6,
    onPage: vi.fn(),
    onOpenRow: vi.fn(),
    error: null,
    onRetry: vi.fn(),
    canManage: true,
    onUploadStatement: vi.fn(),
    onDownloadMissing: vi.fn(),
    onDownloadPackage: vi.fn(),
    exporting: false,
  });

  it("the header, the accounts, the four tiles and the export pair", () => {
    render(<MissingInvoicesMonthDetail {...base()} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "2026. augusztus" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fő számla · Kártyás számla · EUR számla"),
    ).toBeInTheDocument();
    const tiles: [string, string][] = [
      ["Megvan", "27"],
      ["Nem párosodott", "15"],
      ["Nincs számla", "25"],
      ["Nem kell számla", "24"],
    ];
    for (const [label, value] of tiles) {
      const tile = screen
        .getAllByText(label)
        .find((node) => node.closest("article"))!
        .closest("article")!;
      expect(tile).toHaveTextContent(value);
    }
    const exports = screen.getByRole("group", { name: "Exportok" });
    expect(
      within(exports).getByRole("button", { name: "Hiánylista letöltése" }),
    ).toBeInTheDocument();
    expect(
      within(exports).getByRole("button", { name: "Könyvelői csomag" }),
    ).toBeInTheDocument();
  });

  /*
    AZ 1280-AS MÉRCE SZERKEZETBEN (brief 10. pont). A happy-dom nem számol
    elrendezést, ezért a GARANCIÁT mérjük: a partner az egyetlen szélesség
    nélküli oszlop (a maradékot kapja és levágódik), az összeg, a számla, a
    forrás és az állapot fix szélességű, a tábla alsó határa belefér az 1280-as
    tartalomba.
  */
  it("1280: the partner column alone flexes and truncates; amount, invoice, source and state keep their width", () => {
    render(<MissingInvoicesMonthDetail {...base()} />);
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    const cols = [...table.querySelectorAll("col")];
    const widthOf = (header: string) =>
      (cols[headers.indexOf(header)] as HTMLElement).style.width;
    expect(widthOf("Partner")).toBe("");
    for (const header of ["Összeg", "Számla", "Forrás", "Állapot", "Dátum"])
      expect(widthOf(header)).not.toBe("");
    expect(parseInt(table.style.minWidth, 10)).toBeLessThanOrEqual(968);
    const longName = screen.getByText(/^von Wussow Importe GmbH/);
    expect(longName).toHaveClass("truncate");
    expect(longName).toHaveAttribute("title", longName.textContent!);
  });

  it("the fifth tile counts the missing originals, and such a row says so", () => {
    render(
      <MissingInvoicesMonthDetail
        {...base()}
        rows={[charge({ state: "ORIGINAL_MISSING" })]}
      />,
    );
    const tile = screen
      .getAllByText("Eredeti hiányzik")
      .find((node) => node.closest("article"))!
      .closest("article")!;
    expect(tile).toHaveTextContent("3");
    const row = screen.getByRole("row", {
      name: "OPENAI *CHATGPT SUBSCR, 2026. 08. 03.",
    });
    expect(within(row).getByText("Eredeti hiányzik")).toBeInTheDocument();
  });

  it("amounts: forint with the card's original under it; a EUR account in EUR", () => {
    render(<MissingInvoicesMonthDetail {...base()} />);
    const card = screen.getByRole("row", {
      name: "OPENAI *CHATGPT SUBSCR, 2026. 08. 03.",
    });
    expect(within(card).getByText("21 990 Ft")).toBeInTheDocument();
    expect(within(card).getByText("55,38 EUR")).toBeInTheDocument();
    expect(within(card).getByText("Nem a cégre szól")).toBeInTheDocument();
    expect(within(card).getByText("Kártyás előfizetés")).toBeInTheDocument();
    const eur = screen.getByRole("row", { name: /^von Wussow/ });
    expect(within(eur).getByText("468,00 EUR")).toBeInTheDocument();
    expect(within(eur).getByText("AC-2026-881")).toBeInTheDocument();
    expect(within(eur).getByText("NAV")).toBeInTheDocument();
  });

  it("tabs, filters, a row and paging report back to the caller", () => {
    const props = base();
    render(<MissingInvoicesMonthDetail {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "Megvan" }));
    expect(props.onTab).toHaveBeenCalledWith("FOUND");
    fireEvent.change(screen.getByLabelText("Keresés a terhelések között"), {
      target: { value: "Telekom" },
    });
    expect(props.onFilters).toHaveBeenCalledWith({ search: "Telekom" });
    fireEvent.change(screen.getByLabelText("Bankszámla"), {
      target: { value: "acc-eur" },
    });
    expect(props.onFilters).toHaveBeenCalledWith({ accountId: "acc-eur" });
    fireEvent.change(screen.getByLabelText("Kategória"), {
      target: { value: "INSURANCE" },
    });
    expect(props.onFilters).toHaveBeenCalledWith({ category: "INSURANCE" });
    fireEvent.click(
      screen.getByRole("row", {
        name: "OPENAI *CHATGPT SUBSCR, 2026. 08. 03.",
      }),
    );
    expect(props.onOpenRow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c-1" }),
    );
    expect(screen.getByText(/1–2 \/ 40 hiányzó terhelés/)).toBeInTheDocument();
  });

  it("the second page counts from the page size, not from the rows it got", () => {
    render(<MissingInvoicesMonthDetail {...base()} page={2} />);
    expect(screen.getByText(/8–9 \/ 40 hiányzó terhelés/)).toBeInTheDocument();
  });

  it("no statement: its own page, with the upload for who may manage", () => {
    const props = {
      ...base(),
      state: "STATEMENT_MISSING" as const,
      accounts: accounts.map((account) => ({
        ...account,
        hasStatement: false,
      })),
      rows: [],
    };
    const { unmount } = render(<MissingInvoicesMonthDetail {...props} />);
    expect(
      screen.getByRole("heading", {
        name: "Ehhez a hónaphoz nincs bankkivonat",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kivonat feltöltése" }));
    expect(props.onUploadStatement).toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("group", { name: "Exportok" })).toBeNull();
    unmount();
    render(<MissingInvoicesMonthDetail {...props} canManage={false} />);
    expect(
      screen.queryByRole("button", { name: "Kivonat feltöltése" }),
    ).toBeNull();
  });

  it("a partial statement: the page stands, and a strip names the account without one", () => {
    const props = {
      ...base(),
      state: "STATEMENT_PARTIAL" as const,
      accounts: accounts.map((account) =>
        account.id === "acc-eur"
          ? { ...account, hasStatement: false }
          : account,
      ),
    };
    render(<MissingInvoicesMonthDetail {...props} />);
    const strip = screen
      .getByText(/^Részleges kivonat:/)
      .closest("[role=status]")! as HTMLElement;
    expect(strip).toHaveTextContent("EUR számla");
    expect(strip).not.toHaveTextContent("Fő számla");
    fireEvent.click(
      within(strip).getByRole("button", { name: "Kivonat feltöltése" }),
    );
    expect(props.onUploadStatement).toHaveBeenCalled();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("a partial statement with nothing missing yet is still not all found", () => {
    render(
      <MissingInvoicesMonthDetail
        {...base()}
        state="STATEMENT_PARTIAL"
        accounts={accounts.map((account) =>
          account.id === "acc-eur"
            ? { ...account, hasStatement: false }
            : account,
        )}
        summary={{
          found: 20,
          notMatched: 0,
          noInvoice: 0,
          originalMissing: 0,
          noInvoiceNeeded: 2,
        }}
      />,
    );
    expect(
      screen.queryByRole("heading", {
        name: "Minden terheléshez megvan a számla",
      }),
    ).toBeNull();
    expect(screen.getByText(/^Részleges kivonat:/)).toBeInTheDocument();
  });

  it("all found: the green page and only the accountant package", () => {
    render(
      <MissingInvoicesMonthDetail
        {...base()}
        month="2026-07"
        state="READY"
        summary={{
          found: 58,
          notMatched: 0,
          noInvoice: 0,
          originalMissing: 0,
          noInvoiceNeeded: 3,
        }}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Minden terheléshez megvan a számla",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/A júliusi hónap készen áll/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    const exports = screen.getByRole("group", { name: "Exportok" });
    expect(
      within(exports).queryByRole("button", { name: "Hiánylista letöltése" }),
    ).toBeNull();
    expect(
      within(exports).getByRole("button", { name: "Könyvelői csomag" }),
    ).toBeInTheDocument();
  });

  it("loading says so, and a viewer gets no export buttons", () => {
    const { unmount } = render(
      <MissingInvoicesMonthDetail
        {...base()}
        state={null}
        summary={null}
        rows={null}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("betöltése");
    unmount();
    render(<MissingInvoicesMonthDetail {...base()} canManage={false} />);
    expect(screen.queryByRole("group", { name: "Exportok" })).toBeNull();
  });
});

describe("MissingInvoicesDrawer", () => {
  type Props = Parameters<typeof MissingInvoicesDrawer>[0];
  const extras = (
    overrides: Partial<ChargeDetailExtras> = {},
  ): ChargeDetailExtras => ({
    candidates: [
      {
        documentId: "inv-1",
        number: "INV-2026-08341",
        date: "2026-08-02",
        gross: "21990",
        currency: "HUF",
        source: "MAILBOX",
        payee: "NOT_COMPANY",
        hasOriginal: true,
      },
      {
        documentId: "inv-2",
        number: "INV-2026-08177",
        date: "2026-07-04",
        gross: "20880",
        currency: "HUF",
        source: "DRIVE",
        payee: "COMPANY",
        hasOriginal: true,
      },
    ],
    action: "REQUEST_REISSUE_TO_COMPANY",
    driveFolderUrl: null,
    ...overrides,
  });
  const base = (): Props => ({
    row: charge(),
    onClose: vi.fn(),
    companyName: COMPANY.name,
    extras: extras(),
    onPair: vi.fn(),
    onUnpair: vi.fn(),
    onCategory: vi.fn(),
    busy: null,
    onUpload: vi.fn(),
    note: "",
    onNote: vi.fn(),
    onSave: vi.fn(),
    saving: false,
    error: null,
    canManage: true,
  });

  it("the charge, with partner and narrative apart, and the what-to-do from the server's action", () => {
    render(<MissingInvoicesDrawer {...base()} />);
    const dialog = screen.getByRole("dialog", {
      name: "OPENAI *CHATGPT SUBSCR",
    });
    const partner = within(dialog).getByText("Partner").nextElementSibling;
    const narrative = within(dialog).getByText("Közlemény").nextElementSibling;
    expect(partner).toHaveTextContent(/^OPENAI \*CHATGPT SUBSCR$/);
    expect(narrative).toHaveTextContent(
      "OPENAI *CHATGPT SUBSCR / CARD 4821 / DUBLIN IE",
    );
    expect(
      within(dialog).getByRole("region", { name: "Mit kell tenni" }),
    ).toHaveTextContent(
      "A számla a magánszemély nevére szól: kérd újra az Próba Kft. nevére.",
    );
  });

  it("pairing is an explicit click, never automatic, and a private-person candidate says so", () => {
    const props = base();
    render(<MissingInvoicesDrawer {...props} />);
    expect(props.onPair).not.toHaveBeenCalled();
    const first = screen.getByText("INV-2026-08341").closest("li")!;
    expect(within(first).getByText("Nem a cégre szól")).toBeInTheDocument();
    const second = screen.getByText("INV-2026-08177").closest("li")!;
    expect(within(second).queryByText("Nem a cégre szól")).toBeNull();
    fireEvent.click(within(second).getByRole("button", { name: "Párosítás" }));
    expect(props.onPair).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "inv-2" }),
    );
  });

  it("only a manual pairing can be undone", () => {
    const props = base();
    const { unmount } = render(
      <MissingInvoicesDrawer
        {...props}
        row={charge({
          state: "FOUND",
          document: { number: "INV-2026-08177", source: "DRIVE" },
          matchedBy: "RULE",
        })}
      />,
    );
    expect(screen.getByText(/Párosított számla/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Párosítás visszavonása" }),
    ).toBeNull();
    unmount();
    render(
      <MissingInvoicesDrawer
        {...props}
        row={charge({
          state: "FOUND",
          document: { number: "INV-2026-08177", source: "DRIVE" },
          matchedBy: "MANUAL",
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Párosítás visszavonása" }),
    );
    expect(props.onUnpair).toHaveBeenCalled();
  });

  it("the category can be moved by hand, and back to the rule", () => {
    const props = base();
    const { unmount } = render(<MissingInvoicesDrawer {...props} />);
    const select = screen.getByLabelText("Kategória");
    expect(select).toHaveDisplayValue("Automatikus: Kártyás előfizetés");
    expect(
      screen.getByText("Kártyás terhelés, ismert előfizetés-kereskedő."),
    ).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "BANK_FEE" } });
    expect(props.onCategory).toHaveBeenCalledWith("BANK_FEE");
    unmount();
    render(
      <MissingInvoicesDrawer
        {...props}
        row={charge({ category: "BANK_FEE", categoryOverridden: true })}
      />,
    );
    expect(screen.getByText("Kézzel átsorolva")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Kategória"), {
      target: { value: "" },
    });
    expect(props.onCategory).toHaveBeenCalledWith(null);
  });

  /*
    A 4A SZELET (nautilus #1303). MI PIROSÍT: ha a "papíron megvan" jelölő
    nem a szerver felé menne, vagy olyan tételnél is látszana, ahol nem
    kérdés; ha a bruttó nélküli jelölt 0-t mutatna; ha a csak NAV-adatos
    jelölt nem mondaná meg, hogy eredeti nincs; ha a feltöltés része kezelő
    nélkül is látszana (a végpont a 4b-vel jön).
  */
  it("an original-missing pairing can be marked as on paper, and back", () => {
    const props = { ...base(), onPaperOriginal: vi.fn() };
    const { unmount } = render(
      <MissingInvoicesDrawer
        {...props}
        row={charge({
          state: "ORIGINAL_MISSING",
          document: { number: "NAV-2026-1", source: "NAV" },
          matchedBy: "RULE",
        })}
        extras={extras({ action: "PROVIDE_ORIGINAL" })}
      />,
    );
    const box = screen.getByRole("checkbox", {
      name: "Az eredeti papíron megvan",
    });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(props.onPaperOriginal).toHaveBeenCalledWith(true);
    expect(
      screen.getByRole("region", { name: "Mit kell tenni" }),
    ).toHaveTextContent(
      "A számla megvan a NAV-ban; az eredeti (PDF vagy papír) kell a könyvelőnek.",
    );
    unmount();
    render(
      <MissingInvoicesDrawer
        {...props}
        row={charge({
          state: "FOUND",
          document: { number: "NAV-2026-1", source: "NAV" },
          matchedBy: "RULE",
          paperOriginal: true,
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Az eredeti papíron megvan" }),
    );
    expect(props.onPaperOriginal).toHaveBeenLastCalledWith(false);
  });

  it("no paper-original question where there is no pairing, or the original is not the gap", () => {
    render(
      <MissingInvoicesDrawer
        {...base()}
        onPaperOriginal={vi.fn()}
        row={charge({ state: "NO_INVOICE" })}
      />,
    );
    expect(
      screen.queryByRole("checkbox", { name: "Az eredeti papíron megvan" }),
    ).toBeNull();
  });

  it("no paper-original question on a pairing whose original is already there", () => {
    render(
      <MissingInvoicesDrawer
        {...base()}
        onPaperOriginal={vi.fn()}
        row={charge({
          state: "FOUND",
          document: { number: "INV-2026-08177", source: "MAILBOX" },
          matchedBy: "RULE",
          paperOriginal: false,
        })}
      />,
    );
    expect(
      screen.queryByRole("checkbox", { name: "Az eredeti papíron megvan" }),
    ).toBeNull();
  });

  it("a candidate without a gross shows a dash, and one with only NAV data says so", () => {
    render(
      <MissingInvoicesDrawer
        {...base()}
        extras={extras({
          candidates: [
            {
              documentId: "nav-1",
              number: "NAV-2026-7",
              date: "2026-08-01",
              gross: null,
              currency: "HUF",
              source: "NAV",
              payee: "COMPANY",
              hasOriginal: false,
            },
          ],
        })}
      />,
    );
    const candidate = screen.getByText("NAV-2026-7").closest("li")!;
    expect(within(candidate).getByText("—")).toBeInTheDocument();
    expect(within(candidate).queryByText(/0 Ft/)).toBeNull();
    expect(
      within(candidate).getByText("Csak NAV-adat, eredeti nincs a rendszerben"),
    ).toBeInTheDocument();
  });

  it("without an upload handler there is no upload section", () => {
    render(<MissingInvoicesDrawer {...base()} onUpload={undefined} />);
    expect(screen.queryByLabelText("Számla PDF")).toBeNull();
    expect(screen.queryByText("Számla feltöltése")).toBeNull();
  });

  it("the Drive link only with a real address", () => {
    const { unmount } = render(<MissingInvoicesDrawer {...base()} />);
    expect(
      screen.queryByRole("link", { name: /Drive mappa megnyitása/ }),
    ).toBeNull();
    unmount();
    render(
      <MissingInvoicesDrawer
        {...base()}
        extras={extras({
          driveFolderUrl: "https://drive.google.com/drive/folders/abc",
        })}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Drive mappa megnyitása/ }),
    ).toHaveAttribute("href", "https://drive.google.com/drive/folders/abc");
  });

  it("only a PDF is uploaded, as an invoice or a premium notice", () => {
    const props = base();
    render(<MissingInvoicesDrawer {...props} />);
    const input = screen.getByLabelText("Számla PDF");
    fireEvent.change(input, {
      target: { files: [new File(["x"], "szamla.png", { type: "image/png" })] },
    });
    expect(props.onUpload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Csak PDF");
    const pdf = new File(["%PDF"], "szamla.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(props.onUpload).toHaveBeenLastCalledWith(pdf, "INVOICE");
    fireEvent.click(screen.getByRole("radio", { name: "Díjértesítő" }));
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(props.onUpload).toHaveBeenLastCalledWith(pdf, "PREMIUM_NOTICE");
  });

  it("a viewer reads it, but cannot pair, move, upload or save", () => {
    render(<MissingInvoicesDrawer {...base()} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Párosítás" })).toBeNull();
    expect(screen.queryByLabelText("Számla PDF")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
    expect(screen.getByLabelText("Kategória")).toBeDisabled();
    expect(screen.getByLabelText("Megjegyzés")).toHaveAttribute("readonly");
  });
});
