import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  IncomingDocumentListItem,
  IncomingDocumentListResponse,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { urlNavigation } from "@/test/url-navigation";

import { BillingDocumentListPage } from "./billing-document-list-page";

/**
 * A SZÁMLÁZÁS HÁROM NÉZETE (Balázs újraterv-promptja, acrobot 25869, B szelet):
 * a csempék, a bejövő lista (Figma 374:651) és a nyugták üres állapota (Figma
 * 374:1033), a #1367 végpontjain.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);

const api = vi.hoisted(() => ({
  list: vi.fn(),
  incomingList: vi.fn(),
  receipts: vi.fn(),
  cashRegisterReceipts: vi.fn().mockResolvedValue({
    day: "2026-10-03",
    page: 1,
    pageSize: 50,
    total: 0,
    items: [],
    summary: { count: 0, total: "0", payments: [] },
    gaps: [],
    lastRun: null,
  }),
}));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));

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
        role: "OWNER",
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

function incoming(
  overrides: Partial<IncomingDocumentListItem>,
): IncomingDocumentListItem {
  return {
    id: "in-1",
    origin: "SZAMLAZZ",
    documentNumber: "TM-2026-1847",
    kindCode: "SZ",
    kindLabel: "Számla",
    invoiceFormat: "ELECTRONIC",
    cancelled: false,
    supplierName: "Tropic Marin GmbH",
    supplierTaxNumber: "DE811449062",
    issueDate: "2026-09-28",
    fulfillmentDate: "2026-09-28",
    dueDate: "2026-10-12",
    paymentMethod: "Átutalás",
    currency: "EUR",
    exchangeRate: "392.18",
    netAmount: "1284.40",
    vatAmount: "346.79",
    grossAmount: "1631.19",
    paymentState: "PAID",
    paidAmount: "1631.19",
    lastPaymentDate: "2026-09-30",
    paymentSource: "SZAMLAZZ",
    paymentConflict: false,
    bankMatch: {
      state: "PAIRED",
      reason: null,
      debits: [
        { bookingDate: "2026-09-30", amount: "639720", currency: "HUF" },
      ],
    },
    hasPdf: false,
    ...overrides,
  };
}

const page = (
  items: IncomingDocumentListItem[],
): IncomingDocumentListResponse => ({
  items,
  pagination: {
    page: 1,
    pageSize: 25,
    totalItems: items.length,
    totalPages: 1,
  },
  facets: {
    kindCodes: [
      { code: "D", label: "Díjbekérő" },
      { code: "SZ", label: "Számla" },
    ],
    currencies: ["EUR", "HUF"],
  },
});

const lastIncomingQuery = () =>
  Object.fromEntries(api.incomingList.mock.calls.at(-1)![1] as URLSearchParams);

beforeEach(() => {
  urlNavigation.reset("/penzugy/szamlazas");
  api.list.mockReset().mockResolvedValue({
    items: [],
    pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
  });
  api.incomingList.mockReset().mockResolvedValue(
    page([
      incoming({}),
      incoming({
        id: "in-2",
        documentNumber: "AF-2026/188",
        invoiceFormat: "PAPER",
        supplierName: "Aqua-Fauna Kft.",
        supplierTaxNumber: "12345678-2-42",
        currency: "HUF",
        exchangeRate: null,
        netAmount: "382835",
        vatAmount: "103365",
        grossAmount: "486200",
        paymentState: "UNKNOWN",
        paidAmount: "0",
        lastPaymentDate: null,
        bankMatch: { state: "UNPAIRED", reason: null, debits: [] },
      }),
      incoming({
        id: "in-3",
        documentNumber: "D-2026/9",
        kindCode: "D",
        kindLabel: "Díjbekérő",
        paymentState: "UNPAID",
        paidAmount: "0",
        lastPaymentDate: null,
        bankMatch: { state: "NOT_TO_PAIR", reason: "PROFORMA", debits: [] },
      }),
    ]),
  );
  api.receipts.mockReset().mockResolvedValue({ received: 0, items: [] });
});

// MI PIROSÍT: ha a nézet nem az URL-ből jönne (frissítés után a kimenő
// nyílna); ha a váltás egy kimenő szűrőt átvinne; ha a nyíl-billentyű már
// maga váltana (adatot töltene), vagy egyáltalán nem vinné a fókuszt.
describe("the billing view tiles", () => {
  it("the outgoing view is the default, the URL picks another, and a switch clears the other view's filters", async () => {
    urlNavigation.reset("/penzugy/szamlazas", "origin=EXTERNAL&page=2");
    render(<BillingDocumentListPage />);
    expect(screen.getByRole("tab", { name: /Kimenő számlák/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(api.list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("tab", { name: /Bejövő számlák/ }));
    expect(urlNavigation.search).toBe("nezet=bejovo");
    expect(
      await screen.findByRole("tab", { name: /Bejövő számlák/ }),
    ).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(api.incomingList).toHaveBeenCalled());
    expect(
      screen.getByText(/Beszállítói számlák a Számlázz.hu pénzügyi/),
    ).toBeInTheDocument();
  });

  it("arrows move the focus, Enter switches", async () => {
    render(<BillingDocumentListPage />);
    const outgoing = screen.getByRole("tab", { name: /Kimenő számlák/ });
    outgoing.focus();
    fireEvent.keyDown(outgoing, { key: "ArrowLeft" });
    const receipts = screen.getByRole("tab", { name: /Nyugták/ });
    expect(receipts).toHaveFocus();
    expect(urlNavigation.search).toBe("");
    fireEvent.keyDown(receipts, { key: "ArrowRight" });
    expect(outgoing).toHaveFocus();
    // a gomb a natív Entert kattintássá alakítja; a jsdom ezt nem, ezért kattintás
    fireEvent.click(receipts);
    expect(urlNavigation.search).toBe("nezet=nyugtak");
  });
});

// MI PIROSÍT: ha a fizetés napja hiányozna a „Fizetve” alól; ha a jelvény és az
// állapot-oszlop más színt mondana ugyanarra az állapotra; ha a hiányzó
// kifizetés-adat „Nincs fizetve” lenne; ha a deviza két tizedese vagy a
// forint egésze elveszne; ha a sor a kimenő adatlapra nyílna.
describe("the incoming list", () => {
  it("shows the Figma columns, the derived states and the amounts per currency", async () => {
    urlNavigation.reset("/penzugy/szamlazas", "nezet=bejovo");
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    expect(rows).toHaveLength(3);
    const [eur, huf, proforma] = rows.map((row) => within(row));
    expect(eur!.getByText("Normál · E-számla")).toBeInTheDocument();
    // a fizetés a kimenő listával azonos jelvény és dátumírás (#1368)
    expect(eur!.getAllByText("Fizetve")).toHaveLength(2);
    expect(eur!.getByText("2026. 09. 30.")).toBeInTheDocument();
    expect(eur!.getByText("Bankkal párosodott")).toBeInTheDocument();
    // a hu-HU a négyjegyűt nem csoportosítja (CLDR), mint az app többi összege
    expect(eur!.getByText("Bruttó 1631,19")).toBeInTheDocument();
    expect(eur!.getByText("392,18")).toBeInTheDocument();
    expect(huf!.getByText("Normál · Papír alapú")).toBeInTheDocument();
    expect(huf!.getAllByText("Nincs adat")).toHaveLength(2);
    expect(huf!.queryByText("Nincs fizetve")).toBeNull();
    expect(huf!.getByText("Nincs banki pár")).toBeInTheDocument();
    // a DOM-szöveg normalizált: a hu-HU ezres-elválasztó (NBSP) itt szóköz
    expect(huf!.getByText("Bruttó 486 200")).toBeInTheDocument();
    expect(proforma!.getByText("Nem párosítandó")).toBeInTheDocument();
    // a jelvény és az állapot-oszlop felirata ugyanazt a színt mondja
    const unpaid = proforma!.getAllByText("Nincs fizetve");
    expect(unpaid).toHaveLength(2);
    for (const label of unpaid)
      expect(label).toHaveClass("text-pilot-grey-700");
    expect(screen.getByText("3 bejövő számla")).toBeInTheDocument();

    fireEvent.click(huf!.getByText("Aqua-Fauna Kft."));
    expect(urlNavigation.push).toHaveBeenLastCalledWith(
      "/penzugy/szamlazas/bejovo/in-2",
    );
  });

  /*
    A CSAK POSTAFIÓKOS, FIZETETT SZÁMLA (kártya 096607af). MI PIROSÍT: a sor a
    formátumot írná a forrás helyett; a név nélküli rekord üres cellát kapna;
    a nem ismert nettó számnak látszana; a sor a feed-adatlapra vinne (404).
  */
  it("a mailbox-only paid invoice says where it comes from, and opens no feed page", async () => {
    api.incomingList.mockResolvedValue(
      page([
        incoming({
          id: "mailbox:mail-amblard",
          origin: "MAILBOX",
          documentNumber: "F2602896",
          invoiceFormat: null,
          supplierName: "",
          supplierTaxNumber: null,
          currency: "HUF",
          exchangeRate: null,
          netAmount: null,
          vatAmount: null,
          grossAmount: null,
          paymentState: "PAID",
          paidAmount: "179520",
          lastPaymentDate: "2026-09-16",
          paymentSource: "BANK_PAIRING",
          bankMatch: { state: "PAIRED", reason: null, debits: [] },
        }),
      ]),
    );
    urlNavigation.reset("/penzugy/szamlazas", "nezet=bejovo");
    render(<BillingDocumentListPage />);
    const row = await screen.findByRole("row", {
      name: /F2602896, név nélkül, csak postafiókból ismert$/,
    });
    const cells = within(row);
    expect(cells.getByText("Normál · Postafiókból")).toBeInTheDocument();
    expect(cells.getByText("(név nélkül)")).toBeInTheDocument();
    expect(cells.getByText("Nettó —")).toBeInTheDocument();
    expect(cells.getByText("Bruttó —")).toBeInTheDocument();
    expect(cells.getAllByText("Fizetve").length).toBeGreaterThan(0);
    const before = urlNavigation.push.mock.calls.length;
    fireEvent.click(cells.getByText("F2602896"));
    expect(urlNavigation.push.mock.calls.length).toBe(before);
  });

  it("the filters go to the request from the URL: a month as its first and last day, on the fulfillment date", async () => {
    urlNavigation.reset(
      "/penzugy/szamlazas",
      "nezet=bejovo&datum=teljesites&fizetes=PARTIAL&bank=UNPAIRED&tipus=D&penznem=EUR&q=tropic",
    );
    render(<BillingDocumentListPage />);
    await waitFor(() => expect(api.incomingList).toHaveBeenCalled());
    expect(lastIncomingQuery()).toEqual({
      page: "1",
      pageSize: "25",
      q: "tropic",
      dateBasis: "FULFILLMENT",
      paymentState: "PARTIAL",
      kindCode: "D",
      currency: "EUR",
      bankMatch: "UNPAIRED",
    });

    // a február az utolsó nap próbája: 28 vagy 29, soha 30 vagy 31
    const month = [
      ...(
        screen.getByRole("combobox", { name: "Időszak" }) as HTMLSelectElement
      ).options,
    ]
      .map((option) => option.value)
      .find((value) => value.endsWith("-02"))!;
    const leap = Number(month.slice(0, 4)) % 4 === 0;
    fireEvent.change(screen.getByRole("combobox", { name: "Időszak" }), {
      target: { value: month },
    });
    await waitFor(() =>
      expect(lastIncomingQuery()).toMatchObject({
        from: `${month}-01`,
        to: `${month}-${leap ? "29" : "28"}`,
      }),
    );
    expect(new URLSearchParams(urlNavigation.search).get("idoszak")).toBe(
      month,
    );

    fireEvent.click(screen.getByRole("button", { name: "Szűrők törlése" }));
    expect(urlNavigation.search).toBe("nezet=bejovo");
  });
});

// MI PIROSÍT: ha a beérkezett, de még nem auditált nyugták üres listának
// látszanának; ha a nulla nyugta hibaként jelenne meg.
describe("the receipts view", () => {
  it("says no receipt has arrived yet, or how many arrived and why they are not shown", async () => {
    urlNavigation.reset("/penzugy/szamlazas", "nezet=nyugtak");
    const { unmount } = render(<BillingDocumentListPage />);
    fireEvent.click(screen.getByRole("button", { name: "Számlázz.hu" }));
    expect(
      await screen.findByText("Még nem érkezett nyugta az adatkapcsolaton"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();

    api.receipts.mockResolvedValue({ received: 3, items: [] });
    render(<BillingDocumentListPage />);
    fireEvent.click(screen.getByRole("button", { name: "Számlázz.hu" }));
    expect(
      await screen.findByText("3 nyugta érkezett az adatkapcsolaton"),
    ).toBeInTheDocument();
    expect(screen.getByText(/még nem auditáltuk/)).toBeInTheDocument();
  });
});
