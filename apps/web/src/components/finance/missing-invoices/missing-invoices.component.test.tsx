import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MissingInvoicesDrawer } from "./missing-invoices-drawer";
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
 * HIÁNYZÓ SZÁMLÁK, A FELÜLET (Balázs briefje, 2026-09-30; Figma 343:2).
 *
 * MI PIROSÍT: ha egy kivonat nélküli hónap nullákat mutatna "—" helyett; ha a
 * Hiányzik fül nem a négy problémás állapotot fogná; ha a cég neve vagy
 * adószáma a komponensbe égne; ha a partner-oszlop fix szélességet kapna, vagy
 * a számoszlopok elveszítenék a sajátjukat (az 1280-as mérce); ha a drawer
 * magától párosítana, fiktív Drive-linket mutatna, vagy nem PDF-et engedne.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const COMPANY = { name: "Próba Kft.", taxNumber: "11111111" };

const charge = (overrides: Partial<ChargeRow> = {}): ChargeRow => ({
  id: "c-1",
  date: "2026-08-03",
  bankAccount: "Kártyás számla",
  partner: "OPENAI *CHATGPT SUBSCR",
  narrative: "OPENAI *CHATGPT SUBSCR / CARD 4821 / DUBLIN IE",
  amountHuf: "21990",
  original: { amount: "55.38", currency: "EUR" },
  category: "Kártyás előfizetés",
  state: "NOT_COMPANY",
  invoice: null,
  note: null,
  ...overrides,
});

describe("the model", () => {
  it("Hiányzik is every state that still needs work, and nothing else", () => {
    expect([...TAB_STATES.MISSING].sort()).toEqual(
      ["NO_INVOICE", "NOT_COMPANY", "PROFORMA_ONLY", "UNMATCHED"].sort(),
    );
    expect(TAB_STATES.MISSING).not.toContain("FOUND");
    expect(TAB_STATES.MISSING).not.toContain("NOT_NEEDED");
  });

  it("months and the company name in the what-to-do text", () => {
    expect(formatMonth("2026-08")).toBe("2026. augusztus");
    expect(whatToDo("NOT_COMPANY", "Próba Kft.")).toBe(
      "A számla a magánszemély nevére szól: kérd újra az Próba Kft. nevére.",
    );
    expect(whatToDo("FOUND", "Próba Kft.")).toBeNull();
  });
});

describe("MissingInvoicesMonthList", () => {
  const months: MonthRow[] = [
    {
      month: "2026-09",
      state: "NO_STATEMENT",
      counts: null,
      missingAmount: null,
    },
    {
      month: "2026-08",
      state: "INCOMPLETE",
      counts: { charges: 67, found: 27, unmatched: 15, noInvoice: 25 },
      missingAmount: "693967",
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
    expect(within(september).getAllByText("—")).toHaveLength(5);
    expect(within(september).getByText("Kivonat hiányzik")).toBeInTheDocument();
    const august = screen.getByRole("row", {
      name: "2026. augusztus megnyitása",
    });
    expect(within(august).getByText("693 967 Ft")).toBeInTheDocument();
    expect(within(august).getByText("Hiányos")).toBeInTheDocument();
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
  const base = (): Props => ({
    month: "2026-08",
    bankAccounts: ["Fő számla", "Kártyás számla", "EUR számla"],
    summary: { found: 27, unmatched: 15, noInvoice: 25, notNeeded: 24 },
    hasStatement: true,
    tab: "MISSING",
    onTab: vi.fn(),
    filters: { search: "", category: "", bankAccount: "" },
    onFilters: vi.fn(),
    categories: ["Magyar szállító", "Kártyás előfizetés"],
    rows: [
      charge(),
      charge({
        id: "c-2",
        partner:
          "von Wussow Importe GmbH Handelsgesellschaft für Aquaristik und Zubehör",
        original: null,
        amountHuf: "184320",
        state: "NO_INVOICE",
        invoice: { number: "AC-2026-881", source: "NAV" },
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
    for (const [label, value] of [
      ["Megvan", "27"],
      ["Nem párosodott", "15"],
      ["Nincs számla", "25"],
      ["Nem kell számla", "24"],
    ]) {
      const tile = screen
        .getAllByText(label)
        .find((node) => node.closest("article"))!
        .closest("article")!;
      expect(tile).toHaveTextContent(value!);
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
    AZ 1280-AS MÉRCE SZERKEZETBEN (brief 10. pont). A jsdom nem számol
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

  it("a foreign card payment: forint first, the original amount under it", () => {
    render(<MissingInvoicesMonthDetail {...base()} />);
    const row = screen.getByRole("row", {
      name: "OPENAI *CHATGPT SUBSCR, 2026. 08. 03.",
    });
    expect(within(row).getByText("21 990 Ft")).toBeInTheDocument();
    expect(within(row).getByText("55,38 EUR")).toBeInTheDocument();
    expect(within(row).getByText("Nem a cégre szól")).toBeInTheDocument();
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
      target: { value: "EUR számla" },
    });
    expect(props.onFilters).toHaveBeenCalledWith({ bankAccount: "EUR számla" });
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
    const props = { ...base(), hasStatement: false, rows: [] };
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

  it("all found: the green page and only the accountant package", () => {
    render(
      <MissingInvoicesMonthDetail
        {...base()}
        month="2026-07"
        summary={{ found: 58, unmatched: 0, noInvoice: 0, notNeeded: 3 }}
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
      <MissingInvoicesMonthDetail {...base()} summary={null} rows={null} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("betöltése");
    unmount();
    render(<MissingInvoicesMonthDetail {...base()} canManage={false} />);
    expect(screen.queryByRole("group", { name: "Exportok" })).toBeNull();
  });
});

describe("MissingInvoicesDrawer", () => {
  type Props = Parameters<typeof MissingInvoicesDrawer>[0];
  const base = (): Props => ({
    row: charge(),
    onClose: vi.fn(),
    companyName: COMPANY.name,
    candidates: [
      {
        id: "inv-1",
        number: "INV-2026-08341",
        date: "2026-08-02",
        grossAmount: "21990",
        currency: "HUF",
        source: "MAILBOX",
      },
    ],
    onPair: vi.fn(),
    pairingId: null,
    driveUrl: null,
    onUpload: vi.fn(),
    uploading: false,
    note: "",
    onNote: vi.fn(),
    onSave: vi.fn(),
    saving: false,
    error: null,
    canManage: true,
  });

  it("the charge, with partner and narrative apart, and the what-to-do for its state", () => {
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

  it("pairing is an explicit click, never automatic", () => {
    const props = base();
    render(<MissingInvoicesDrawer {...props} />);
    expect(props.onPair).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Párosítás" }));
    expect(props.onPair).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-1" }),
    );
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
        driveUrl="https://drive.google.com/drive/folders/abc"
      />,
    );
    expect(
      screen.getByRole("link", { name: /Drive mappa megnyitása/ }),
    ).toHaveAttribute("href", "https://drive.google.com/drive/folders/abc");
  });

  it("only a PDF is uploaded", () => {
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
    expect(props.onUpload).toHaveBeenCalledWith(pdf);
  });

  it("a viewer reads it, but cannot pair, upload or save", () => {
    render(<MissingInvoicesDrawer {...base()} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Párosítás" })).toBeNull();
    expect(screen.queryByLabelText("Számla PDF")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
    expect(screen.getByLabelText("Megjegyzés")).toHaveAttribute("readonly");
  });
});
