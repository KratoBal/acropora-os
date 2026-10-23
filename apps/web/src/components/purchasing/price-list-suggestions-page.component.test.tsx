import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  Session,
  SupplierPriceSuggestionItem,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PriceListSuggestionsPage } from "./price-list-suggestions-page";

/**
 * A NÉV ALAPÚ PÁROSÍTÁSI JAVASLATOK LISTÁJA (task arlista-nev-javaslat-felulet).
 * Kitalált termékek. MI PIROSÍT: ha egy cikkszámnál két jelölt is kijelölhető
 * lenne (a jóváhagyás a többit törli); ha a döntés nem a kijelölteket küldené;
 * ha az olvasó joggal döntő gomb volna; ha a kihagyott döntés nem látszana; ha
 * a hiba elnyelődne; ha a lapozás a szűrőt vagy a lap szélét elvesztené.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/beszerzes/arlistak/javaslatok",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  suggestions: vi.fn(),
  approveSuggestions: vi.fn(),
  rejectSuggestions: vi.fn(),
}));
vi.mock("@/lib/api/price-lists", () => ({ priceListsApi: api }));
const suppliersApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi }));

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

const item = (
  overrides: Partial<SupplierPriceSuggestionItem> = {},
): SupplierPriceSuggestionItem => ({
  id: "sg-1",
  supplierId: "sup-1",
  supplierName: "Hertlein",
  supplierSku: "H-1",
  listedName: "Exbrand Reef Salt tengeri só 2 kg",
  listedBrand: "Exbrand",
  gtin: "04260119453555",
  unitPrice: "12.5",
  currency: "EUR",
  variantId: "v-1",
  variantName: "Exbrand Reef Salt 2kg",
  variantSku: "SKU-1",
  score: 0.91,
  basis: { commonWords: ["reef", "salt"], sizes: ["2000g"], brand: "exbrand" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "OWNER";
  api.suggestions.mockResolvedValue({
    total: 2,
    items: [
      item({ id: "sg-1" }),
      item({
        id: "sg-2",
        variantId: "v-2",
        variantName: "Exbrand Reef Salt 500g",
        variantSku: "SKU-2",
        score: 0.78,
        basis: { commonWords: ["reef", "salt"], sizes: [], brand: null },
      }),
      item({
        id: "sg-3",
        supplierSku: "H-2",
        listedName: "Exbrand Component A 2000 ml",
        variantId: "v-3",
        variantName: "Exbrand Component A 2000ml",
        variantSku: "SKU-3",
      }),
    ],
  });
  api.approveSuggestions.mockResolvedValue({ decided: 1, skipped: 0 });
  api.rejectSuggestions.mockResolvedValue({ decided: 1, skipped: 0 });
  suppliersApi.list.mockResolvedValue({
    items: [{ id: "sup-1", name: "Hertlein" }],
    pagination: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
  });
});

const candidate = (name: string) =>
  screen.getByRole("checkbox", { name: `${name} jelölése` });

describe("PriceListSuggestionsPage", () => {
  it("shows each sku once with its candidates beneath, the score and what the suggestion rests on", async () => {
    render(<PriceListSuggestionsPage />);
    expect(
      await screen.findByText(
        /Hertlein · H-1 · Exbrand Reef Salt tengeri só 2 kg/,
      ),
    ).toBeInTheDocument();
    // both skus' rows carry the listed barcode; the first sku has two candidates
    expect(screen.getAllByText(/vonalkód 04260119453555/)).toHaveLength(2);
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getAllByText(/egyezés 91%/)).toHaveLength(2);
    expect(screen.getByText(/egyezés 78%/)).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /közös szavak: reef, salt · kiszerelés: 2000g · márka: exbrand/,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/2 függő cikkszám; a lapon 1-2/),
    ).toBeInTheDocument();
  });

  it("lets one candidate per sku be picked: picking the other replaces it", async () => {
    render(<PriceListSuggestionsPage />);
    await screen.findByText(/H-1/);
    fireEvent.click(candidate("Exbrand Reef Salt 2kg"));
    expect(candidate("Exbrand Reef Salt 2kg")).toBeChecked();
    fireEvent.click(candidate("Exbrand Reef Salt 500g"));
    expect(candidate("Exbrand Reef Salt 500g")).toBeChecked();
    expect(candidate("Exbrand Reef Salt 2kg")).not.toBeChecked();
    fireEvent.click(candidate("Exbrand Reef Salt 500g"));
    expect(candidate("Exbrand Reef Salt 500g")).not.toBeChecked();
  });

  it("approves exactly the picked candidates, reports the result and reloads", async () => {
    api.approveSuggestions.mockResolvedValue({ decided: 2, skipped: 1 });
    render(<PriceListSuggestionsPage />);
    await screen.findByText(/H-1/);
    fireEvent.click(candidate("Exbrand Reef Salt 500g"));
    fireEvent.click(candidate("Exbrand Component A 2000ml"));
    fireEvent.click(
      screen.getByRole("button", { name: "Kijelöltek jóváhagyása (2)" }),
    );
    await waitFor(() =>
      expect(api.approveSuggestions).toHaveBeenCalledWith("token-1", [
        "sg-2",
        "sg-3",
      ]),
    );
    expect(
      await screen.findByText(
        "2 jóváhagyva, 1 kihagyva (közben döntöttek róla, vagy a cikkszámnak lett kötése).",
      ),
    ).toBeInTheDocument();
    expect(api.suggestions.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects exactly the picked candidates", async () => {
    render(<PriceListSuggestionsPage />);
    await screen.findByText(/H-1/);
    fireEvent.click(candidate("Exbrand Reef Salt 2kg"));
    fireEvent.click(
      screen.getByRole("button", { name: "Kijelöltek elutasítása" }),
    );
    await waitFor(() =>
      expect(api.rejectSuggestions).toHaveBeenCalledWith("token-1", ["sg-1"]),
    );
    expect(api.approveSuggestions).not.toHaveBeenCalled();
  });

  it("picks the best candidate of every sku in one click", async () => {
    render(<PriceListSuggestionsPage />);
    await screen.findByText(/H-1/);
    fireEvent.click(
      screen.getByRole("button", {
        name: "A legjobb jelölt kijelölése mindenhol",
      }),
    );
    expect(candidate("Exbrand Reef Salt 2kg")).toBeChecked();
    expect(candidate("Exbrand Reef Salt 500g")).not.toBeChecked();
    expect(candidate("Exbrand Component A 2000ml")).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Kijelöltek jóváhagyása (2)" }),
    ).toBeEnabled();
  });

  it("keeps the decision buttons off until something is picked", async () => {
    render(<PriceListSuggestionsPage />);
    await screen.findByText(/H-1/);
    expect(
      screen.getByRole("button", { name: "Kijelöltek jóváhagyása (0)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Kijelöltek elutasítása" }),
    ).toBeDisabled();
  });

  it("gives a viewer the list without checkboxes or decision buttons", async () => {
    auth.role = "VIEWER";
    render(<PriceListSuggestionsPage />);
    await screen.findByText(/H-1/);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /jóváhagyása/ })).toBeNull();
  });

  it("shows the server's refusal of a decision instead of swallowing it", async () => {
    api.approveSuggestions.mockRejectedValueOnce(
      new Error("Nincs jogosultság."),
    );
    render(<PriceListSuggestionsPage />);
    await screen.findByText(/H-1/);
    fireEvent.click(candidate("Exbrand Reef Salt 2kg"));
    fireEvent.click(
      screen.getByRole("button", { name: "Kijelöltek jóváhagyása (1)" }),
    );
    expect(await screen.findByText("Nincs jogosultság.")).toBeInTheDocument();
  });

  it("filters by supplier and starts from the first page again", async () => {
    render(<PriceListSuggestionsPage />);
    await screen.findByText(/H-1/);
    await screen.findByRole("option", { name: "Hertlein" });
    fireEvent.change(screen.getByLabelText("Beszállító"), {
      target: { value: "sup-1" },
    });
    await waitFor(() =>
      expect(api.suggestions).toHaveBeenLastCalledWith(
        "token-1",
        "sup-1",
        0,
        expect.anything(),
      ),
    );
  });

  it("says plainly when nothing is pending, and shows a load error", async () => {
    api.suggestions.mockResolvedValueOnce({ total: 0, items: [] });
    const { unmount } = render(<PriceListSuggestionsPage />);
    expect(await screen.findByText("Nincs függő javaslat")).toBeInTheDocument();
    unmount();
    api.suggestions.mockRejectedValueOnce(new Error("Nincs kapcsolat."));
    render(<PriceListSuggestionsPage />);
    expect(await screen.findByText("Nincs kapcsolat.")).toBeInTheDocument();
  });

  it("pages forward by a hundred and keeps the filter", async () => {
    api.suggestions.mockResolvedValue({
      total: 250,
      items: [item({ id: "sg-1" })],
    });
    render(<PriceListSuggestionsPage />);
    await screen.findByText(/H-1/);
    fireEvent.click(screen.getByRole("button", { name: "Következő lap" }));
    await waitFor(() =>
      expect(api.suggestions).toHaveBeenLastCalledWith(
        "token-1",
        "",
        100,
        expect.anything(),
      ),
    );
    expect(screen.getByRole("button", { name: "Előző lap" })).toBeEnabled();
    const nav = screen.getByRole("button", { name: "Következő lap" });
    expect(within(nav.parentElement!).getAllByRole("button")).toHaveLength(2);
  });
});
