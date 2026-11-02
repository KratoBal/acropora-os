import type { MissingInvoicePackageCheck } from "@acropora/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChargeRow } from "./missing-invoices-model";
import { MissingInvoicesMonthDetail } from "./missing-invoices-month-detail";

/**
 * A HÓNAP LAPJA A KÖNYVELŐI CSOMAG SZEMÉVEL (Balázs, 2026-11-02 22:37 UTC: a
 * csomag borítóján „nem PDF”, a Hiányzó számlák lapon ez nem látszott, és a
 * „Minden terheléshez megvan a számla” üzenet készenlétet ígért).
 *
 * MI PIROSÍT: ha a „minden megvan” üzenet megjelenne, amíg a csomagból
 * hiányzik egy PDF, vagy amíg az ellenőrzés még tölt; ha a hiányzó PDF-et a
 * sor nem jelölné; ha a papíron meglévő számla hiányzónak látszana; ha a
 * ki nem fizetett számlák blokkja nem jelenne meg; ha a csatolás gombja
 * olyan sornál is megjelenne, ahol a szerver 409-et adna (nem PDF fájl); ha a
 * csatolás a sor megnyitását is kiváltaná; ha a szűrő gombja nem a szervernek
 * szóló jelzést adná.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const row = (id: string, partner: string): ChargeRow => ({
  id,
  date: "2026-10-05",
  account: { id: "acc", name: "Fő számla" },
  partner,
  narrative: "",
  amount: "56420",
  currency: "HUF",
  original: null,
  category: "SUPPLIER",
  categoryRule: "",
  categoryOverridden: false,
  state: "FOUND",
  document: { number: "KS-1", source: "SZAMLAZZ" },
  matchedBy: "RULE",
  comment: null,
  documentNumbers: ["KS-1"],
  missingNumbers: [],
  amountDifference: null,
  refund: null,
  paperOriginal: false,
});

type Props = Parameters<typeof MissingInvoicesMonthDetail>[0];
const base = (over: Partial<Props> = {}): Props => ({
  month: "2026-10",
  accounts: [{ id: "acc", name: "Fő számla", hasStatement: true }],
  state: "READY",
  summary: {
    found: 3,
    notMatched: 0,
    noInvoice: 0,
    originalMissing: 0,
    noInvoiceNeeded: 0,
  },
  tab: "FOUND",
  onTab: vi.fn(),
  filters: { search: "", category: "", accountId: "" },
  onFilters: vi.fn(),
  rows: [
    row("ok", "Rendben Kft."),
    row("nopdf", "PDF nélküli Kft."),
    row("xml", "Nem PDF Kft."),
  ],
  totalItems: 3,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  onPage: vi.fn(),
  onOpenRow: vi.fn(),
  error: null,
  onRetry: vi.fn(),
  canManage: true,
  onUploadStatement: vi.fn(),
  exporting: false,
  ...over,
});

const check = (
  over: Partial<MissingInvoicePackageCheck> = {},
): MissingInvoicePackageCheck => ({
  month: "2026-10",
  lackingCount: 2,
  items: [
    { id: "ok", pdf: "ATTACHED", attach: { kind: "ROW", id: "r-ok" } },
    { id: "nopdf", pdf: "PDF_MISSING", attach: { kind: "ROW", id: "r-nopdf" } },
    { id: "xml", pdf: "NOT_PDF", attach: { kind: "ROW", id: "r-xml" } },
  ],
  unpaid: [],
  ...over,
});

describe("the month page sees the accountant package", () => {
  it("READY with a lacking PDF: no 'everything is here' promise, the banner counts, the rows are marked", () => {
    render(<MissingInvoicesMonthDetail {...base()} packageCheck={check()} />);
    expect(
      screen.queryByRole("heading", {
        name: "Minden terheléshez megvan a számla",
      }),
    ).toBeNull();
    expect(
      screen.getByText(/A könyvelői csomagból hiányzik 2 számla PDF-je/),
    ).toBeInTheDocument();
    const missingRow = screen.getByText("PDF nélküli Kft.").closest("tr")!;
    expect(within(missingRow).getByText("PDF hiányzik")).toBeInTheDocument();
    const xmlRow = screen.getByText("Nem PDF Kft.").closest("tr")!;
    expect(within(xmlRow).getByText("Nem PDF")).toBeInTheDocument();
    const okRow = screen.getByText("Rendben Kft.").closest("tr")!;
    expect(within(okRow).queryByText("PDF hiányzik")).toBeNull();
    expect(within(okRow).queryByText("PDF a csomagban")).toBeNull();
  });

  it("READY while the check is still loading: no promise either (null), and the old message only when the check is not wired (undefined)", () => {
    const { rerender } = render(
      <MissingInvoicesMonthDetail {...base()} packageCheck={null} />,
    );
    expect(
      screen.queryByRole("heading", {
        name: "Minden terheléshez megvan a számla",
      }),
    ).toBeNull();
    expect(screen.getByText(/ellenőrzése…/)).toBeInTheDocument();
    rerender(
      <MissingInvoicesMonthDetail {...base()} packageCheck={undefined} />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Minden terheléshez megvan a számla",
      }),
    ).toBeInTheDocument();
  });

  it("READY with nothing lacking: the message stays, with the limit of the check said out loud", () => {
    render(
      <MissingInvoicesMonthDetail
        {...base()}
        packageCheck={check({ lackingCount: 0, items: [] })}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Minden terheléshez megvan a számla",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nem olvasható PDF-et/)).toBeInTheDocument();
  });

  it("a paper original is not lacking, and the filter button speaks to the server", () => {
    const onPackagePdfOnly = vi.fn();
    render(
      <MissingInvoicesMonthDetail
        {...base()}
        packageCheck={check({
          items: [
            { id: "ok", pdf: "PAPER", attach: { kind: "ROW", id: "r-ok" } },
            {
              id: "nopdf",
              pdf: "PDF_MISSING",
              attach: { kind: "ROW", id: "r-nopdf" },
            },
          ],
          lackingCount: 1,
        })}
        onPackagePdfOnly={onPackagePdfOnly}
      />,
    );
    const okRow = screen.getByText("Rendben Kft.").closest("tr")!;
    expect(within(okRow).queryByText("Papíron megvan")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Csak a PDF nélküliek" }),
    );
    expect(onPackagePdfOnly).toHaveBeenCalledWith(true);
  });

  it("the unpaid invoices have their own block with the PDF status, and a missing PDF can be attached from it", () => {
    const onAttachPdf = vi.fn();
    render(
      <MissingInvoicesMonthDetail
        {...base()}
        packageCheck={check({
          unpaid: [
            {
              id: "u-1",
              number: "KS26/12407",
              supplier: "Fluidra Magyarország Kft.",
              amount: "56420",
              currency: "HUF",
              date: "2026-10-22",
              pdf: "PDF_MISSING",
            },
            {
              id: "u-2",
              number: "KS26/00002",
              supplier: "Másik Kft.",
              amount: "1000",
              currency: "HUF",
              date: "2026-10-23",
              pdf: "NOT_PDF",
            },
          ],
          lackingCount: 4,
        })}
        onAttachPdf={onAttachPdf}
      />,
    );
    const block = screen.getByRole("region", {
      name: "Ki nem fizetett bejövő számlák",
    });
    expect(within(block).getByText("KS26/12407")).toBeInTheDocument();
    expect(within(block).getByText("PDF hiányzik")).toBeInTheDocument();
    // csak a PDF_MISSING sorhoz van gomb: a „nem PDF” sorra a szerver 409-et adna
    expect(
      within(block).getAllByRole("button", { name: "PDF csatolása" }),
    ).toHaveLength(1);
    const file = new File(["%PDF-1.4"], "szamla.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(within(block).getByLabelText("KS26/12407 PDF-je"), {
      target: { files: [file] },
    });
    expect(onAttachPdf).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u-1" }),
      file,
    );
  });

  it("attaching from a row does not open the row, and a viewer without finance.manage gets no button", () => {
    const onOpenRow = vi.fn();
    const onAttachPdf = vi.fn();
    const { rerender } = render(
      <MissingInvoicesMonthDetail
        {...base()}
        onOpenRow={onOpenRow}
        packageCheck={check()}
        onAttachPdf={onAttachPdf}
      />,
    );
    const missingRow = screen.getByText("PDF nélküli Kft.").closest("tr")!;
    const file = new File(["%PDF-1.4"], "szamla.pdf", {
      type: "application/pdf",
    });
    // a gomb kattintása a sor része, de nem nyitja meg a sort
    fireEvent.click(
      within(missingRow).getByRole("button", { name: "PDF csatolása" }),
    );
    expect(onOpenRow).not.toHaveBeenCalled();
    fireEvent.change(
      within(missingRow).getByLabelText("PDF nélküli Kft. PDF-je"),
      { target: { files: [file] } },
    );
    expect(onAttachPdf).toHaveBeenCalledTimes(1);
    expect(onOpenRow).not.toHaveBeenCalled();
    // a nem PDF fájlú sorhoz nincs csatolás
    const xmlRow = screen.getByText("Nem PDF Kft.").closest("tr")!;
    expect(
      within(xmlRow).queryByRole("button", { name: "PDF csatolása" }),
    ).toBeNull();
    rerender(
      <MissingInvoicesMonthDetail
        {...base()}
        canManage={false}
        packageCheck={check()}
        onAttachPdf={onAttachPdf}
      />,
    );
    expect(screen.queryByRole("button", { name: "PDF csatolása" })).toBeNull();
  });

  it("a bank-side row opens the existing drawer instead of a file chooser", () => {
    const onAttachPdf = vi.fn();
    const onOpenRow = vi.fn();
    render(
      <MissingInvoicesMonthDetail
        {...base()}
        onOpenRow={onOpenRow}
        packageCheck={check({
          items: [
            {
              id: "nopdf",
              pdf: "PDF_MISSING",
              attach: { kind: "BANK", id: "nopdf" },
            },
          ],
          lackingCount: 1,
        })}
        onAttachPdf={onAttachPdf}
      />,
    );
    const missingRow = screen.getByText("PDF nélküli Kft.").closest("tr")!;
    fireEvent.click(
      within(missingRow).getByRole("button", { name: "PDF csatolása" }),
    );
    expect(onAttachPdf).toHaveBeenCalledWith(
      expect.objectContaining({ attach: { kind: "BANK", id: "nopdf" } }),
    );
    expect(onOpenRow).not.toHaveBeenCalled();
  });
});
