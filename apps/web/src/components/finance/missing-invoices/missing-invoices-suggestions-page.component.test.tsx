import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  InvoiceCollectionSuggestion,
  Session,
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
  });
  api.collectionItems.mockResolvedValue({
    items: [],
    counts: {},
    limit: 200,
    truncated: false,
  });
  api.acceptSuggestion.mockResolvedValue(undefined);
  api.rejectSuggestion.mockResolvedValue(undefined);
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
