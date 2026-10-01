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

const api = vi.hoisted(() => ({
  suggestions: vi.fn(),
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

beforeEach(() => {
  auth.role = "OWNER";
  for (const fn of Object.values(api)) fn.mockReset();
  api.suggestions.mockResolvedValue({
    items: [
      suggestion("doc-a", "WR26-0220.pdf"),
      suggestion("doc-b", "inv-67.pdf"),
    ],
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
