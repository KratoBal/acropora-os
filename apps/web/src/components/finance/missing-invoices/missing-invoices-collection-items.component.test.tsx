import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { InvoiceCollectionItemsResponse } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionItemsSection } from "./missing-invoices-collection-items";

/**
 * A GYŰJTŐ ÍTÉLETEI (acrobot 35522, J55388): Balázs maga lássa, mi lett egy
 * levél PDF-jéből.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const api = vi.hoisted(() => ({ collectionItems: vi.fn() }));
vi.mock("@/lib/api/missing-invoices", () => ({ missingInvoicesApi: api }));

const counts: InvoiceCollectionItemsResponse["counts"] = {
  STORED: 410,
  SUGGESTED: 2,
  UNMATCHED: 33,
  NOT_INVOICE: 120,
  OWN_INVOICE: 4,
  DUPLICATE: 9,
  TOO_LARGE: 0,
  UNREADABLE: 1,
};

const response = (
  overrides: Partial<InvoiceCollectionItemsResponse> = {},
): InvoiceCollectionItemsResponse => ({
  items: [
    {
      id: "i-1",
      source: "INFO_MAIL",
      externalId: "msg-1",
      fileName: "Számla J55388 - 2026-10-22.pdf",
      verdict: "UNMATCHED",
      documentId: null,
      createdAt: "2026-10-22T14:10:00.000Z",
    },
    {
      id: "i-2",
      source: "BALAZS_MAIL",
      externalId: "msg-2",
      fileName: "FX01071477.pdf",
      verdict: "STORED",
      documentId: "doc-2",
      createdAt: "2026-10-22T14:11:00.000Z",
    },
  ],
  counts,
  limit: 200,
  truncated: false,
  ...overrides,
});

beforeEach(() => {
  api.collectionItems.mockReset();
  api.collectionItems.mockResolvedValue(response());
});

describe("CollectionItemsSection", () => {
  /**
   * MI PIROSÍT: ha az ítélet nem magyar szó és magyarázat lenne; ha a forrás
   * nyers azonosító maradna; ha a darabszám nem a szűrő nevén állna; ha a
   * Budapest szerinti idő nem jelenne meg (14:10 UTC = 16:10 nyári időben).
   */
  it("shows the file, the source, the verdict with its meaning, and the time in Budapest", async () => {
    render(<CollectionItemsSection token="token-1" />);
    const row = (
      await screen.findByText("Számla J55388 - 2026-10-22.pdf")
    ).closest("tr")!;
    expect(within(row).getByText("info@ levelek")).toBeInTheDocument();
    expect(within(row).getByText("Nem párosodott")).toBeInTheDocument();
    expect(within(row).getByText(/Nincs tárolva/)).toBeInTheDocument();
    expect(within(row).getByText(/16:10/)).toBeInTheDocument();
    const stored = screen.getByText("FX01071477.pdf").closest("tr")!;
    expect(within(stored).getByText("balazs@ levelek")).toBeInTheDocument();
    expect(within(stored).getByText("Tárolva")).toBeInTheDocument();
  });

  /** barracuda #1827: MI PIROSÍT: ha a visszatartott sorból a fájlnév helyett üres cella vagy "null" látszik. */
  it("says the file name is withheld where the server withholds it, and still shows the verdict", async () => {
    api.collectionItems.mockResolvedValueOnce(
      response({
        items: [
          {
            id: "i-9",
            source: "BALAZS_MAIL",
            externalId: null,
            fileName: null,
            verdict: "NOT_INVOICE",
            documentId: null,
            createdAt: "2026-10-22T14:12:00.000Z",
          },
        ],
      }),
    );
    render(<CollectionItemsSection token="token-1" />);
    const hint = await screen.findByText(
      "A fájlnév nem látszik (a balazs@ postafiók magánlevelezés)",
    );
    const row = hint.closest("tr")!;
    expect(within(row).getByText("Nem számla")).toBeInTheDocument();
    expect(within(row).getByText("balazs@ levelek")).toBeInTheDocument();
    expect(screen.queryByText("null")).toBeNull();
  });

  it("puts the count on each verdict filter, from the server's counts", async () => {
    render(<CollectionItemsSection token="token-1" />);
    await screen.findByText("FX01071477.pdf");
    expect(
      screen.getByRole("button", { name: "Nem párosodott (33)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tárolva (410)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Túl nagy (0)" }),
    ).toBeInTheDocument();
  });

  /** MI PIROSÍT: ha a szűrő nem a szervernek szól, hanem a betöltött sorokat szűri. */
  it("asks the server for the chosen verdict, and for all of them again on Mind", async () => {
    render(<CollectionItemsSection token="token-1" />);
    await screen.findByText("FX01071477.pdf");
    expect(api.collectionItems).toHaveBeenLastCalledWith(
      "token-1",
      { verdict: "" },
      expect.anything(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Nem párosodott (33)" }),
    );
    await waitFor(() =>
      expect(api.collectionItems).toHaveBeenLastCalledWith(
        "token-1",
        { verdict: "UNMATCHED" },
        expect.anything(),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Nem párosodott (33)" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Mind" }));
    await waitFor(() =>
      expect(api.collectionItems).toHaveBeenLastCalledWith(
        "token-1",
        { verdict: "" },
        expect.anything(),
      ),
    );
  });

  it("says when the list is cut, and when there is nothing", async () => {
    api.collectionItems.mockResolvedValueOnce(
      response({ truncated: true, limit: 200 }),
    );
    const { unmount } = render(<CollectionItemsSection token="token-1" />);
    expect(
      await screen.findByText("Csak a legutóbbi 200 sor látszik."),
    ).toBeInTheDocument();
    unmount();

    api.collectionItems.mockResolvedValueOnce(response({ items: [] }));
    render(<CollectionItemsSection token="token-1" />);
    expect(
      await screen.findByText("Nincs ilyen ítéletű fájl."),
    ).toBeInTheDocument();
  });

  it("shows the server's error instead of an empty list", async () => {
    api.collectionItems.mockRejectedValueOnce(new Error("Nincs jogosultság."));
    render(<CollectionItemsSection token="token-1" />);
    expect(await screen.findByText("Nincs jogosultság.")).toBeInTheDocument();
    expect(screen.queryByText("Nincs ilyen ítéletű fájl.")).toBeNull();
  });
});
