import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  InvoiceCollectionSuggestion,
  Session,
  SupplierRulePreview,
  SupplierRuleView,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MissingInvoicesSuggestionsPage } from "./missing-invoices-suggestions-page";

/**
 * A JEV JAVASLATAINAK JÓVÁHAGYÁSA (levél-válogatás terv, 4. szelet; acrobot
 * 25803): a Jev csak javasol, ember dönt.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/penzugy/hianyzo-szamlak/javaslatok",
  useSearchParams: () => new URLSearchParams(),
}));

const billingApi = vi.hoisted(() => ({
  incomingList: vi.fn(),
  assignIncomingDocument: vi.fn(),
}));
vi.mock("@/lib/api/billing-documents", () => ({
  billingDocumentsApi: billingApi,
}));

const api = vi.hoisted(() => ({
  suggestions: vi.fn(),
  collectionItems: vi.fn(),
  suggestionFile: vi.fn(),
  acceptSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
  supplierRulePreview: vi.fn(),
  acceptWithRule: vi.fn(),
  supplierRules: vi.fn(),
  disableSupplierRule: vi.fn(),
  autoAccepted: vi.fn(),
  undoAutoAccepted: vi.fn(),
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

const suggestion = (
  documentId: string,
  fileName: string,
): InvoiceCollectionSuggestion => ({
  documentId,
  state: "SUGGESTED",
  stale: false,
  fileName,
  sender: "invoice@waterro.lv",
  subject: "Invoice request",
  receivedAt: "2026-09-12T08:00:00.000Z",
  confidence: 0.9,
  decisionRunId: `run-${documentId}`,
  invoiceNumber: "WR26-0220",
  supplierName: "SIA Waterro",
  gross: "1063.00",
  currency: "EUR",
  createdAt: "2026-10-01T08:00:00.000Z",
  ruleRefusal: null,
});

const incomingRow = (id: string, documentNumber: string, hasPdf: boolean) => ({
  id,
  documentNumber,
  hasPdf,
  supplierName: "Kitalált Gumi Kft.",
  issueDate: "2026-10-22",
  currency: "HUF",
  grossAmount: "119800",
});

beforeEach(() => {
  auth.role = "OWNER";
  for (const fn of Object.values(billingApi)) fn.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.suggestions.mockResolvedValue({
    items: [
      suggestion("doc-a", "WR26-0220.pdf"),
      suggestion("doc-b", "inv-67.pdf"),
    ],
    staleAfterDays: 60,
    staleCount: 0,
    supplierRules: { live: true, amountlessAccepted: false },
  });
  api.collectionItems.mockResolvedValue({
    items: [],
    counts: {},
    limit: 200,
    truncated: false,
  });
  api.acceptSuggestion.mockResolvedValue(undefined);
  api.rejectSuggestion.mockResolvedValue(undefined);
  api.supplierRules.mockResolvedValue([]);
  api.autoAccepted.mockResolvedValue([]);
  api.supplierRulePreview.mockResolvedValue(preview());
});

const preview = (
  over: Partial<SupplierRulePreview> = {},
): SupplierRulePreview => ({
  documentId: "doc-a",
  taxKey: "LV40003005253",
  externalSender: true,
  senderDomain: "waterro.lv",
  taxLooksUnstable: false,
  pendingCount: { TAX: 3, NAME: 0 },
  canCreate: { TAX: true, NAME: true },
  ...over,
});

const rowOf = async (fileName: string) =>
  (await screen.findByText(fileName)).closest("tr")!;

describe("MissingInvoicesSuggestionsPage", () => {
  /**
   * MI PIROSÍT: ha az Elfogad az elvetés végpontját hívná (vagy fordítva); ha a
   * döntés után a sor a listán maradna; ha a bizonyosság nem a Jev számából
   * jönne.
   */
  it("accepts one and rejects the other, each through its own endpoint, and the decided row leaves the list", async () => {
    render(<MissingInvoicesSuggestionsPage />);
    const a = await rowOf("WR26-0220.pdf");
    expect(within(a).getByText("90%")).toBeInTheDocument();
    fireEvent.click(within(a).getByRole("button", { name: "Elfogad" }));
    await waitFor(() =>
      expect(api.acceptSuggestion).toHaveBeenCalledWith("token-1", "doc-a"),
    );
    await waitFor(() => expect(screen.queryByText("WR26-0220.pdf")).toBeNull());

    const b = await rowOf("inv-67.pdf");
    fireEvent.click(within(b).getByRole("button", { name: "Elvet" }));
    await waitFor(() =>
      expect(api.rejectSuggestion).toHaveBeenCalledWith("token-1", "doc-b"),
    );
    expect(api.acceptSuggestion).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByText("Nincs döntésre váró javaslat."),
      ).toBeInTheDocument(),
    );
  });

  /**
   * MI PIROSÍT: ha a nem párosodott fájl a Jev javaslataként látszana (az
   * Állapot), vagy a bizonyossága 0%-ként; ha az elfogadása másik végpontot
   * hívna, mint a javaslaté.
   */
  it("labels an untied file 'Nem párosodott' with no confidence, and accepts it through the same endpoint", async () => {
    api.suggestions.mockResolvedValue({
      items: [
        {
          ...suggestion("doc-u", "RE67456.pdf"),
          state: "UNASSIGNED",
          confidence: null,
        },
      ],
      staleAfterDays: 60,
      staleCount: 0,
    });
    render(<MissingInvoicesSuggestionsPage />);
    const row = await rowOf("RE67456.pdf");
    expect(within(row).getByText("Nem párosodott")).toBeInTheDocument();
    expect(within(row).queryByText("A Jev javasolta")).toBeNull();
    expect(within(row).queryByText("0%")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Elfogad" }));
    await waitFor(() =>
      expect(api.acceptSuggestion).toHaveBeenCalledWith("token-1", "doc-u"),
    );
  });

  /**
   * kártya e09190c8: ha egy szállítói szabály illeszkedett, de emberre hagyta a PDF-et, a sor kimondja, melyik szabály és miért.
   * MI PIROSÍT: ha az ok vagy a szabály neve nem látszik; ha egy ok nélküli sor is kap ilyen sort; ha a név nélküli szabálynál
   * üres zárójel áll.
   */
  it("says which supplier rule matched and why it still left the PDF to a person", async () => {
    api.suggestions.mockResolvedValue({
      items: [
        {
          ...suggestion("doc-o", "RE1.pdf"),
          state: "UNASSIGNED",
          confidence: null,
          ruleRefusal: { reason: "OUTLIER", ruleLabel: "SIA Waterro" },
        },
        {
          ...suggestion("doc-n", "RE2.pdf"),
          ruleRefusal: { reason: "NOT_AUTHENTICATED", ruleLabel: null },
        },
        suggestion("doc-p", "RE3.pdf"),
      ],
      staleAfterDays: 60,
      staleCount: 0,
      supplierRules: { live: true, amountlessAccepted: false },
    });
    render(<MissingInvoicesSuggestionsPage />);
    expect(
      within(await rowOf("RE1.pdf")).getByText(
        "Szabály (SIA Waterro): kiugró összeg (az eddigi legnagyobb háromszorosa fölött)",
      ),
    ).toBeInTheDocument();
    expect(
      within(await rowOf("RE2.pdf")).getByText(
        "Szabály: a feladó nem hitelesített",
      ),
    ).toBeInTheDocument();
    expect(within(await rowOf("RE3.pdf")).queryByText(/^Szabály/)).toBeNull();
  });

  /**
   * acrobot 35565: a döntés nélkül maradt, nem párosodott fájl a határ után
   * FIGYELMEZTETÉST kap, de nem törlődik. MI PIROSÍT: ha a régi fájl jelzés nélkül
   * marad; ha a friss fájl is jelzést kap; ha a jelzés a Jev javaslatára kerül;
   * ha a lap a határt nem a szervertől veszi.
   */
  it("flags a file that has waited past the limit, and says nothing is deleted automatically", async () => {
    api.suggestions.mockResolvedValue({
      items: [
        {
          ...suggestion("doc-old", "OLD.pdf"),
          state: "UNASSIGNED",
          confidence: null,
          stale: true,
        },
        {
          ...suggestion("doc-new", "NEW.pdf"),
          state: "UNASSIGNED",
          confidence: null,
          stale: false,
        },
        suggestion("doc-jev", "JEV.pdf"),
      ],
      staleAfterDays: 45,
      staleCount: 1,
    });
    render(<MissingInvoicesSuggestionsPage />);
    const old = await rowOf("OLD.pdf");
    expect(within(old).getByText("45 napnál régebben vár")).toBeInTheDocument();
    expect(
      within(await rowOf("NEW.pdf")).queryByText(/régebben vár/),
    ).toBeNull();
    expect(
      within(await rowOf("JEV.pdf")).queryByText(/régebben vár/),
    ).toBeNull();
    const banner = screen.getByText(
      /1 nem párosodott fájl 45 napnál régebben vár döntésre/,
    );
    expect(banner).toHaveTextContent("Automatikusan nem törlődnek");
  });

  // Picasso 3.25: the intro under the title was six lines, longer than the empty list below it
  it("the intro under the title is two sentences, and says what happens on accept and on reject", async () => {
    render(<MissingInvoicesSuggestionsPage />);
    await rowOf("WR26-0220.pdf");
    const intro = screen.getByText(
      /A begyűjtés PDF-jei, amelyeket semmi nem kötött/,
    );
    expect(intro.textContent!.length).toBeLessThan(260);
    expect(intro.textContent).toContain(
      "Elfogadva jelöltek lesznek, elvetve törlődik a tartalmuk.",
    );
    expect(intro.textContent).not.toContain("Jev látta");
  });

  it("shows no warning when nothing has waited past the limit", async () => {
    render(<MissingInvoicesSuggestionsPage />);
    await rowOf("WR26-0220.pdf");
    expect(screen.queryByText("Régóta döntésre váró fájlok")).toBeNull();
  });

  /**
   * acrobot 35522/35529: egy nem párosodott fájl egy lépésben hozzárendelhető egy
   * bejövő számlához. MI PIROSÍT: ha a Jev javaslatán is megjelenne a gomb; ha a
   * PDF-es sor is választható lenne; ha a hozzárendelés nem a kiválasztott sorra és
   * fájlra hívna; ha a fájl a listán maradna; ha a hiba elnyelődne.
   */
  it("assigns an untied file to a chosen invoice without a PDF, and the file leaves the list", async () => {
    api.suggestions.mockResolvedValue({
      items: [
        {
          ...suggestion("doc-u", "RE67456.pdf"),
          state: "UNASSIGNED",
          confidence: null,
        },
        suggestion("doc-jev", "JEV.pdf"),
      ],
      staleAfterDays: 60,
      staleCount: 0,
    });
    billingApi.incomingList.mockResolvedValue({
      items: [
        incomingRow("in-1", "J55388", false),
        incomingRow("in-2", "J55000", true),
        incomingRow("mailbox:x", "MB-1", false),
      ],
      pagination: { page: 1, pageSize: 50, totalItems: 3, totalPages: 1 },
    });
    billingApi.assignIncomingDocument.mockResolvedValue({});
    render(<MissingInvoicesSuggestionsPage />);
    const untied = await rowOf("RE67456.pdf");
    expect(
      within(await rowOf("JEV.pdf")).queryByRole("button", {
        name: /bejövő számlához/,
      }),
    ).toBeNull();
    fireEvent.click(
      within(untied).getByRole("button", {
        name: "RE67456.pdf bejövő számlához",
      }),
    );
    fireEvent.change(screen.getByLabelText("Szállító neve vagy adószáma"), {
      target: { value: "Gumi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Keresés" }));
    const list = await screen.findByRole("list", {
      name: "PDF nélküli bejövő számlák",
    });
    expect(billingApi.incomingList.mock.calls[0]![1].get("q")).toBe("Gumi");
    // only the row with no PDF and with a feed record can be chosen
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("J55388")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "J55388 számlához rendel" }),
    );
    await waitFor(() =>
      expect(billingApi.assignIncomingDocument).toHaveBeenCalledWith(
        "token-1",
        "in-1",
        "doc-u",
      ),
    );
    await waitFor(() => expect(screen.queryByText("RE67456.pdf")).toBeNull());
    expect(
      screen.queryByLabelText("Hozzárendelés bejövő számlához"),
    ).toBeNull();
    expect(screen.getByText("JEV.pdf")).toBeInTheDocument();
  });

  it("keeps the file and shows the server's refusal when the assignment fails", async () => {
    api.suggestions.mockResolvedValue({
      items: [
        {
          ...suggestion("doc-u", "RE67456.pdf"),
          state: "UNASSIGNED",
          confidence: null,
        },
      ],
      staleAfterDays: 60,
      staleCount: 0,
    });
    billingApi.incomingList.mockResolvedValue({
      items: [incomingRow("in-1", "J55388", false)],
      pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
    });
    billingApi.assignIncomingDocument.mockRejectedValue(
      new Error("Ennek a számlának már van PDF-je."),
    );
    render(<MissingInvoicesSuggestionsPage />);
    fireEvent.click(
      within(await rowOf("RE67456.pdf")).getByRole("button", {
        name: "RE67456.pdf bejövő számlához",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keresés" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "J55388 számlához rendel" }),
    );
    expect(
      await screen.findByText("Ennek a számlának már van PDF-je."),
    ).toBeInTheDocument();
    expect(screen.getByText("RE67456.pdf")).toBeInTheDocument();
  });

  /** A KONTROLL A JOGRA: olvasó joggal a lista látszik, döntés-gomb nincs. */
  it("a viewer sees the suggestions without the decision buttons", async () => {
    auth.role = "VIEWER";
    render(<MissingInvoicesSuggestionsPage />);
    const a = await rowOf("WR26-0220.pdf");
    expect(within(a).queryByRole("button", { name: "Elfogad" })).toBeNull();
    expect(within(a).queryByRole("button", { name: "Elvet" })).toBeNull();
    expect(within(a).getByRole("button", { name: "PDF" })).toBeInTheDocument();
  });

  it("a decision someone else made first is said out loud, and the list reloads", async () => {
    api.acceptSuggestion.mockRejectedValue(
      new Error("Erről a javaslatról már döntöttek, vagy nem létezik."),
    );
    render(<MissingInvoicesSuggestionsPage />);
    fireEvent.click(
      within(await rowOf("WR26-0220.pdf")).getByRole("button", {
        name: "Elfogad",
      }),
    );
    expect(
      await screen.findByText(
        "Erről a javaslatról már döntöttek, vagy nem létezik.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.suggestions).toHaveBeenCalledTimes(2));
  });
});

/*
  AZ ISMERT SZÁLLÍTÓ SZABÁLYA A LAPON (acrobot 57881, 57884). MI PIROSÍT: ha az "Elfogad és szabály" gomb a sima elfogadás
  végpontját hívná; ha a szabály kulcsa nem az előnézetből jön (az olvasó-hiba figyelmeztetés nélkül névszabály helyett adószámot
  ajánlana); ha a név nélküli névszabály elküldhető; ha a többi függő PDF a megerősítés nélkül elfogadódna; ha a visszavonás
  közben-párosult PDF-et a lap visszavontnak mondaná; ha a szabály kikapcsolása nem a szabályt kapcsolja.
*/
describe("MissingInvoicesSuggestionsPage: supplier rules", () => {
  const openPanel = async (fileName = "WR26-0220.pdf") => {
    render(<MissingInvoicesSuggestionsPage />);
    const row = await rowOf(fileName);
    fireEvent.click(
      within(row).getByRole("button", {
        name: `${fileName} elfogadása szállítói szabállyal`,
      }),
    );
    return screen.findByRole("region", {
      name: "Elfogadás és szállítói szabály",
    });
  };

  it("accepts with a TAX rule from the preview, and takes the other pending PDFs only when ticked", async () => {
    api.acceptWithRule.mockResolvedValue({
      ruleId: "r-1",
      created: true,
      alsoAccepted: 3,
    });
    const panel = await openPanel();
    expect(
      await within(panel).findByText(/Adószám: LV40003005253/),
    ).toBeInTheDocument();
    expect(within(panel).getAllByText(/waterro\.lv/).length).toBeGreaterThan(0);
    fireEvent.click(within(panel).getByRole("checkbox"));
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Elfogad és szabályt hoz létre",
      }),
    );
    await waitFor(() =>
      expect(api.acceptWithRule).toHaveBeenCalledWith("token-1", "doc-a", {
        kind: "TAX",
        alsoPending: true,
      }),
    );
    expect(api.acceptSuggestion).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/létrejött, és 3 további függő PDF is elfogadva/),
    ).toBeInTheDocument();
  });

  it("without the tick the other pending PDFs are not asked for", async () => {
    api.acceptWithRule.mockResolvedValue({
      ruleId: "r-1",
      created: true,
      alsoAccepted: 0,
    });
    const panel = await openPanel();
    await within(panel).findByText(/Adószám: LV40003005253/);
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Elfogad és szabályt hoz létre",
      }),
    );
    await waitFor(() =>
      expect(api.acceptWithRule).toHaveBeenCalledWith("token-1", "doc-a", {
        kind: "TAX",
        alsoPending: false,
      }),
    );
  });

  it("an unstable tax number (a reader error) warns and suggests a name rule; the name is required and goes with the request", async () => {
    api.supplierRulePreview.mockResolvedValue(
      preview({ taxKey: "HU00956903", taxLooksUnstable: true }),
    );
    api.acceptWithRule.mockResolvedValue({
      ruleId: "r-2",
      created: true,
      alsoAccepted: 0,
    });
    const panel = await openPanel();
    expect(
      await within(panel).findByText("Valószínűleg olvasó-hiba az adószámnál"),
    ).toBeInTheDocument();
    const submit = within(panel).getByRole("button", {
      name: "Elfogad és szabályt hoz létre",
    });
    // the name rule is the default here, and it needs the name
    expect(submit).toBeDisabled();
    fireEvent.change(
      within(panel).getByLabelText("A szállító neve a számlán"),
      {
        target: { value: "GLS" },
      },
    );
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(api.acceptWithRule).toHaveBeenCalledWith("token-1", "doc-a", {
        kind: "NAME",
        alsoPending: false,
        vendorName: "GLS",
      }),
    );
  });

  it("a forwarded PDF cannot get a name rule: the option is off", async () => {
    api.supplierRulePreview.mockResolvedValue(
      preview({
        externalSender: false,
        senderDomain: "acropora.hu",
        canCreate: { TAX: true, NAME: false },
      }),
    );
    const panel = await openPanel();
    expect(
      (await within(panel).findAllByText(/saját továbbítótól érkezett/)).length,
    ).toBeGreaterThan(0);
    const radios = within(panel).getAllByRole("radio");
    expect(radios[1]).toBeDisabled();
  });

  it("shows the rule's error and does not close", async () => {
    api.acceptWithRule.mockRejectedValue(
      new Error("A megadott név nem szerepel a PDF szövegében."),
    );
    const panel = await openPanel();
    await within(panel).findByText(/Adószám: LV40003005253/);
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Elfogad és szabályt hoz létre",
      }),
    );
    expect(
      await screen.findByText("A megadott név nem szerepel a PDF szövegében."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Elfogadás és szállítói szabály" }),
    ).toBeInTheDocument();
  });

  const rule = (over: Partial<SupplierRuleView> = {}): SupplierRuleView => ({
    id: "r-1",
    kind: "TAX",
    label: "Waterro",
    key: "LV40003005253",
    senderDomain: "waterro.lv",
    grossCeilings: { EUR: 106300 },
    acceptedCount: 4,
    createdAt: "2026-11-20T10:00:00.000Z",
    disabledAt: null,
    ...over,
  });

  it("lists the active rules and disables the right one; a disabled one is not listed", async () => {
    api.supplierRules
      .mockResolvedValueOnce([
        rule(),
        rule({
          id: "r-0",
          label: "Régi",
          disabledAt: "2026-11-19T10:00:00.000Z",
        }),
      ])
      .mockResolvedValue([]);
    api.disableSupplierRule.mockResolvedValue(undefined);
    render(<MissingInvoicesSuggestionsPage />);
    const list = await screen.findByRole("list", {
      name: "Aktív szállítói szabályok",
    });
    expect(within(list).getByText("Waterro")).toBeInTheDocument();
    expect(
      within(list).getByText(/4 automatikus elfogadás/),
    ).toBeInTheDocument();
    expect(within(list).queryByText("Régi")).toBeNull();
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Waterro szabály kikapcsolása",
      }),
    );
    // only after the confirmation
    expect(api.disableSupplierRule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Kikapcsol" }));
    await waitFor(() =>
      expect(api.disableSupplierRule).toHaveBeenCalledWith("token-1", "r-1"),
    );
  });

  const autoRow = {
    documentId: "doc-x",
    fileName: "auto.pdf",
    sender: "billing@waterro.lv",
    receivedAt: "2026-11-19T08:00:00.000Z",
    acceptedAt: "2026-11-20T08:00:00.000Z",
    ruleId: "r-1",
    invoiceNumber: "WR26-0300",
    gross: "10.00",
    currency: "EUR",
  };

  it("undoes an automatic acceptance and reloads the pending list", async () => {
    api.supplierRules.mockResolvedValue([rule()]);
    api.autoAccepted.mockResolvedValueOnce([autoRow]).mockResolvedValue([]);
    api.undoAutoAccepted.mockResolvedValue("UNDONE");
    render(<MissingInvoicesSuggestionsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "auto.pdf visszavonása" }),
    );
    expect(api.undoAutoAccepted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Visszavon" }));
    await waitFor(() =>
      expect(api.undoAutoAccepted).toHaveBeenCalledWith("token-1", "doc-x"),
    );
    expect(
      await screen.findByText(/visszavonva, újra döntésre vár/),
    ).toBeInTheDocument();
    // the pending list is reloaded (first load + after the undo)
    await waitFor(() =>
      expect(api.suggestions.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("an undo of a PDF paired meanwhile says so and does not claim it was undone", async () => {
    api.supplierRules.mockResolvedValue([rule()]);
    api.autoAccepted.mockResolvedValue([autoRow]);
    api.undoAutoAccepted.mockResolvedValue("IN_USE");
    render(<MissingInvoicesSuggestionsPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "auto.pdf visszavonása" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Visszavon" }));
    expect(
      await screen.findByText(/Közben párosult vagy csatolták/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/visszavonva, újra döntésre vár/)).toBeNull();
    expect(api.suggestions).toHaveBeenCalledTimes(1);
  });

  it("without the manage right there are no rule buttons", async () => {
    auth.role = "VIEWER";
    api.supplierRules.mockResolvedValue([rule()]);
    api.autoAccepted.mockResolvedValue([autoRow]);
    render(<MissingInvoicesSuggestionsPage />);
    await screen.findByText("Waterro");
    expect(
      screen.queryByRole("button", {
        name: /kikapcsolása|visszavonása|szállítói szabállyal/,
      }),
    ).toBeNull();
  });

  // THE SWITCH (INVOICE_SUPPLIER_RULES, off by default; murena 58021): off, the page shows nothing of the rules
  it("with the switch off there is no rule button and no rule list, and nothing is asked for", async () => {
    api.suggestions.mockResolvedValue({
      items: [suggestion("doc-a", "WR26-0220.pdf")],
      staleAfterDays: 60,
      staleCount: 0,
      supplierRules: { live: false, amountlessAccepted: false },
    });
    api.supplierRules.mockResolvedValue([rule()]);
    render(<MissingInvoicesSuggestionsPage />);
    const row = await rowOf("WR26-0220.pdf");
    expect(
      within(row).getByRole("button", { name: "Elfogad" }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: /szállítói szabállyal/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Szállítói szabályok" }),
    ).toBeNull();
    expect(api.supplierRules).not.toHaveBeenCalled();
  });

  // THE SERVER DECIDES WHICH RULE IS POSSIBLE (canCreate; murena 58021), and the page says why none is
  it("names why no rule can be made: an unknown sender, or a forwarded PDF without a tax number", async () => {
    api.supplierRulePreview.mockResolvedValue(
      preview({
        taxKey: null,
        externalSender: false,
        senderDomain: null,
        canCreate: { TAX: false, NAME: false },
      }),
    );
    let panel = await openPanel();
    expect(
      await within(panel).findByText(
        "A feladó ismeretlen, szabály nem vehető fel.",
      ),
    ).toBeInTheDocument();
    expect(within(panel).queryAllByRole("radio")).toHaveLength(0);
    cleanup();
    api.supplierRulePreview.mockResolvedValue(
      preview({
        taxKey: null,
        externalSender: false,
        senderDomain: "acropora.hu",
        canCreate: { TAX: false, NAME: false },
      }),
    );
    panel = await openPanel();
    expect(
      await within(panel).findByText(/szabály csak adószámmal lehet/),
    ).toBeInTheDocument();
  });

  it("follows canCreate, not its own guess: a tax number the server refuses is not offered", async () => {
    api.supplierRulePreview.mockResolvedValue(
      preview({
        taxKey: "LV40003005253",
        canCreate: { TAX: false, NAME: true },
      }),
    );
    const panel = await openPanel();
    const radios = await within(panel).findAllByRole("radio");
    expect(radios[0]).toBeDisabled();
    expect(radios[1]).toBeChecked();
  });
});
