import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  PartnerOrderCandidateDto,
  PartnerOrderDetailDto,
  PartnerOrderListResponse,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PartnerOrderDetailPage } from "./partner-order-detail-page";
import { PartnerOrderListPage } from "./partner-order-list-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/megrendelesek",
  useSearchParams: () => navigation.search,
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  candidates: vi.fn(),
  create: vi.fn(),
  detail: vi.fn(),
  uploadDocument: vi.fn(),
  downloadDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));
vi.mock("@/lib/api/partner-orders", () => ({ partnerOrdersApi: api }));

const certificates = vi.hoisted(() => ({
  listForPartnerOrder: vi.fn(),
  issueForPartnerOrder: vi.fn(),
  downloadDocument: vi.fn(),
}));
const quotes = vi.hoisted(() => ({ pdf: vi.fn() }));
vi.mock("@/lib/api/quotes", () => ({ quotesApi: quotes }));
const invoices = vi.hoisted(() => ({
  byCertificate: vi.fn(),
  downloadPdf: vi.fn(),
}));
vi.mock("@/lib/api/maintenance-invoice", () => ({
  maintenanceInvoiceApi: invoices,
}));
vi.mock("@/lib/api/completion-certificates", () => ({
  completionCertificatesApi: certificates,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "Balázs",
        role: "ADMIN",
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const CHAIN = {
  INQUIRY: 0,
  QUOTE: 0,
  SIGNED_ORDER_FORM: 1,
  COMPLETION: 0,
  SIGNED_COMPLETION: 0,
  INVOICE: 0,
};

const LIST: PartnerOrderListResponse = {
  items: [
    {
      id: "o1",
      orderNumber: "MR-2026-0042",
      quoteId: "q1",
      quoteNumber: "AJ-2026-0042",
      title: "Állatkerti felújítás",
      status: "OPEN",
      customerId: "c1",
      customerName: "Teszt Állatkert",
      quoteAccepted: true,
      netTotal: "25000",
      currency: "HUF",
      chain: { ...CHAIN, OTHER: 0 },
      openLines: 1,
      totalLines: 2,
      createdAt: "2026-11-04T10:00:00Z",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
};

const CANDIDATE: PartnerOrderCandidateDto = {
  quoteId: "q7",
  quoteNumber: "AJ-2026-0051",
  title: "Vízmérés",
  customerName: "Másik Állatkert",
  acceptedAt: "2026-11-03T09:00:00Z",
};

function detail(
  over: Partial<PartnerOrderDetailDto> = {},
): PartnerOrderDetailDto {
  return {
    id: "o1",
    orderNumber: "MR-2026-0042",
    status: "OPEN",
    quoteId: "q1",
    quoteNumber: "AJ-2026-0042",
    quoteVersionNumber: 2,
    quoteAccepted: true,
    title: "Állatkerti felújítás",
    currency: "HUF",
    priceDisplay: "NET",
    customer: {
      id: "c1",
      name: "Teszt Állatkert",
      taxNumber: "12345678-2-42",
      address: "1146 Budapest, Állatkerti krt. 6",
    },
    lines: [
      {
        quoteItemId: "i1",
        position: 1,
        name: "Szűrő csere",
        description: null,
        quantity: "2",
        unit: "db",
        unitNetPrice: "10000",
        vatRatePercent: "27",
        netAmount: "20000",
        rounded: { net: "20000", vat: "5400", gross: "25400" },
        wasOptional: false,
      },
      {
        quoteItemId: "i2",
        position: 2,
        name: "Extra tisztítás",
        description: null,
        quantity: "1",
        unit: "alkalom",
        unitNetPrice: "5000",
        vatRatePercent: "27",
        netAmount: "5000",
        rounded: { net: "5000", vat: "1350", gross: "6350" },
        wasOptional: true,
      },
    ],
    totals: {
      net: "25000",
      vat: "6750",
      gross: "31750",
      byRate: [
        { vatRatePercent: "27", net: "25000", vat: "6750", gross: "31750" },
      ],
    },
    documents: [
      {
        id: "d1",
        step: "SIGNED_ORDER_FORM",
        fileName: "alairt-megrendeloplap.pdf",
        contentType: "application/pdf",
        sizeBytes: 2048,
        uploadedByName: "Luca",
        createdAt: "2026-11-04T11:00:00Z",
      },
    ],
    systemDocuments: [],
    createdAt: "2026-11-04T10:00:00Z",
    createdByName: "Luca",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.search = new URLSearchParams();
  api.list.mockResolvedValue(LIST);
  api.candidates.mockResolvedValue([]);
});

/**
 * A tiltott tároló: a `window.localStorage` ELÉRÉSE dob (privát ablak, tiltott oldaladat), nem csak az olvasás. A
 * `Storage.prototype` kémje ebben a környezetben nem fogja meg, ezért a tulajdonságot cseréljük.
 */
function blockStorage() {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  return () => {
    if (original) Object.defineProperty(window, "localStorage", original);
  };
}

describe("a megrendelések listája", () => {
  it("shows the order, the partner, the net total and where the chain stands", async () => {
    render(<PartnerOrderListPage />);
    const row = (await screen.findByText("MR-2026-0042")).closest("tr")!;
    expect(within(row).getByText("Teszt Állatkert")).toBeInTheDocument();
    expect(within(row).getByText("25 000 Ft")).toBeInTheDocument();
    expect(within(row).getByText("Nyitott")).toBeInTheDocument();
    // the signed order form is attached, the rest of the chain is not
    expect(within(row).getByText("Megrendelőlap ✓")).toBeInTheDocument();
    expect(within(row).getByText("TIG")).toBeInTheDocument();
    expect(within(row).queryByText("TIG ✓")).not.toBeInTheDocument();
  });

  /*
    S4 (38caeac2). MI PIROSIT: ha a hatralek oszlop a teljesitett es a nyitott tetelt egyformanak mutatja, vagy a
    lemondott megrendelest is hatralekosnak; ha a szuro nem az API-nak megy at (a cim marad valtozatlan); ha egy
    ismeretlen cimbeli ertek szuronek szamit; ha a suru mod nem allitja a sormagassagot, nem jegyzodik meg, vagy
    a nem mukodo tarolo a lapot elviszi.
  */
  it("shows the open lines of each order, and nothing for a cancelled one", async () => {
    api.list.mockResolvedValue({
      ...LIST,
      items: [
        LIST.items[0]!,
        { ...LIST.items[0]!, id: "o2", orderNumber: "MR-2", openLines: 0 },
        {
          ...LIST.items[0]!,
          id: "o3",
          orderNumber: "MR-3",
          status: "CANCELLED",
        },
      ],
      total: 3,
    });
    render(<PartnerOrderListPage />);
    const open = (await screen.findByText("MR-2026-0042")).closest("tr")!;
    expect(within(open).getByText("1 / 2 tétel")).toBeInTheDocument();
    const done = screen.getByText("MR-2").closest("tr")!;
    expect(within(done).getByText("Teljesítve")).toBeInTheDocument();
    const cancelled = screen.getByText("MR-3").closest("tr")!;
    expect(within(cancelled).queryByText(/tétel/)).not.toBeInTheDocument();
    expect(within(cancelled).getByText("—")).toBeInTheDocument();
  });

  it("sends the chain and open line filters to the API, and a value it does not know is no filter", async () => {
    navigation.search = new URLSearchParams("stage=AWAITING_SIGNATURE&open=1");
    render(<PartnerOrderListPage />);
    await screen.findByText("MR-2026-0042");
    const query = api.list.mock.calls.at(-1)![1] as URLSearchParams;
    expect(query.get("stage")).toBe("AWAITING_SIGNATURE");
    expect(query.get("open")).toBe("1");
  });

  it("drops a stage it does not know instead of sending it", async () => {
    navigation.search = new URLSearchParams("stage=SOMETHING_ELSE");
    render(<PartnerOrderListPage />);
    await screen.findByText("MR-2026-0042");
    const query = api.list.mock.calls.at(-1)![1] as URLSearchParams;
    expect(query.has("stage")).toBe(false);
  });

  it("changing the filters writes them to the address and goes back to the first page", async () => {
    render(<PartnerOrderListPage />);
    await screen.findByText("MR-2026-0042");
    fireEvent.change(screen.getByLabelText("Hol tart"), {
      target: { value: "AWAITING_INVOICE" },
    });
    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/megrendelesek?stage=AWAITING_INVOICE",
      { scroll: false },
    );
    fireEvent.click(screen.getByLabelText("Csak teljesítetlen tétellel"));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/megrendelesek?open=1",
      { scroll: false },
    );
  });

  it("dense rows: the row gets lower, the choice is remembered, and a blocked storage does not break the page", async () => {
    window.localStorage.removeItem("acropora.partnerOrders.dense");
    render(<PartnerOrderListPage />);
    const row = () => screen.getByText("MR-2026-0042").closest("tr")!;
    await screen.findByText("MR-2026-0042");
    expect(row().className).toContain("md:h-[72px]");
    fireEvent.click(screen.getByRole("button", { name: "Sűrű sorok" }));
    expect(row().className).toContain("md:h-[44px]");
    expect(window.localStorage.getItem("acropora.partnerOrders.dense")).toBe(
      "1",
    );
    const restore = blockStorage();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Tágas sorok" }));
      expect(row().className).toContain("md:h-[72px]");
    } finally {
      restore();
    }
  });

  // MI PIROSIT: ha az elso olvasas hibaja (privat ablak, tiltott tarolo) kivetelkent a lap renderelesig jutna
  it("a storage that throws on the first read leaves the page standing, in the default density", async () => {
    const restore = blockStorage();
    try {
      render(<PartnerOrderListPage />);
      const row = (await screen.findByText("MR-2026-0042")).closest("tr")!;
      expect(row.className).toContain("md:h-[72px]");
    } finally {
      restore();
    }
  });

  it("starts dense when the browser remembers it", async () => {
    window.localStorage.setItem("acropora.partnerOrders.dense", "1");
    render(<PartnerOrderListPage />);
    const row = (await screen.findByText("MR-2026-0042")).closest("tr")!;
    await waitFor(() => expect(row.className).toContain("md:h-[44px]"));
    window.localStorage.removeItem("acropora.partnerOrders.dense");
  });

  it("opens the order on a click", async () => {
    render(<PartnerOrderListPage />);
    fireEvent.click(await screen.findByText("MR-2026-0042"));
    expect(navigation.push).toHaveBeenCalledWith("/megrendelesek/o1");
  });

  it("offers an accepted quote without an order and carries it on", async () => {
    api.candidates.mockResolvedValue([CANDIDATE]);
    api.create.mockResolvedValue({ id: "o9" });
    render(<PartnerOrderListPage />);
    expect(await screen.findByText("AJ-2026-0051")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Megrendelés létrehozása" }),
    );
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("token-1", "q7"),
    );
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/megrendelesek/o9"),
    );
  });

  it("shows the server's sentence when the order cannot be made", async () => {
    api.candidates.mockResolvedValue([CANDIDATE]);
    api.create.mockRejectedValue(
      new Error("Megrendelés csak elfogadott ajánlatból hozható létre."),
    );
    render(<PartnerOrderListPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Megrendelés létrehozása" }),
    );
    expect(
      await screen.findByText(
        "Megrendelés csak elfogadott ajánlatból hozható létre.",
      ),
    ).toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("egy megrendelés", () => {
  beforeEach(() => {
    api.detail.mockResolvedValue(detail());
    // the certificate panel stays loading: its table repeats the line names, and a
    // list that resolves before the assertions would make them ambiguous (CI #2158)
    certificates.listForPartnerOrder.mockReturnValue(new Promise(() => {}));
  });

  /*
    A LÁNC RENDSZER-DOKUMENTUMAI (kártya 88649353; Balázs 17:40 UTC; acrobot 42589). MI PIROSÍT: ha az
    ajánlat PDF-je, a TIG vagy a számla nem a saját lépésében jelenik meg; ha a lépés darabszáma nem
    számolja őket; ha a letöltés nem a fajtája végpontján megy; ha törölhetőnek látszanak.
  */
  // acrobot 42859: a storno'd invoice stays listed with its mark, and the step does not count it
  it("shows a storno'd invoice marked, and does not count it as the chain's invoice", async () => {
    api.detail.mockResolvedValue(
      detail({
        systemDocuments: [
          {
            kind: "INVOICE_PDF",
            step: "INVOICE",
            label: "Számla ACRS-2026-12 · Sztornózva (ACRS-2026-13)",
            invoiceId: "inv-1",
            invoiceNumber: "ACRS-2026-12",
            createdAt: "2026-11-04T13:00:00Z",
            stornoInvoiceNumber: "ACRS-2026-13",
          },
        ],
      }),
    );
    render(<PartnerOrderDetailPage orderId="o1" />);
    const item = (
      await screen.findByRole("button", {
        name: "Számla ACRS-2026-12 · Sztornózva (ACRS-2026-13)",
      })
    ).closest("li")!;
    expect(within(item).getByText("Sztornózva")).toBeInTheDocument();
    const step = item.closest("section")!;
    expect(within(step).queryByText(/\d+ db/)).not.toBeInTheDocument();
  });

  it("shows the system-made documents in their steps, counted, downloadable, not deletable", async () => {
    api.detail.mockResolvedValue(
      detail({
        systemDocuments: [
          {
            kind: "QUOTE_PDF",
            step: "QUOTE",
            label: "Ajánlat AJ-2026-0042 · 2. verzió",
            quoteId: "q1",
            versionId: "v2",
            createdAt: "2026-11-01T09:00:00Z",
          },
          {
            kind: "CERTIFICATE_DOCUMENT",
            step: "COMPLETION",
            label: "Teljesítési igazolás TI-2026-008",
            certificateId: "cert-1",
            documentId: "d9",
            fileName: "TI-2026-008.pdf",
            createdAt: "2026-11-04T12:00:00Z",
          },
          {
            kind: "INVOICE_PDF",
            step: "INVOICE",
            label: "Számla ACRS-2026-12",
            invoiceId: "inv-1",
            invoiceNumber: "ACRS-2026-12",
            createdAt: "2026-11-04T13:00:00Z",
            stornoInvoiceNumber: null,
          },
        ],
      }),
    );
    quotes.pdf.mockResolvedValue(new Blob(["%PDF"]));
    invoices.downloadPdf.mockResolvedValue(new Blob(["%PDF"]));
    certificates.downloadDocument.mockResolvedValue(new Blob(["%PDF"]));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<PartnerOrderDetailPage orderId="o1" />);
    const quoteButton = await screen.findByRole("button", {
      name: "Ajánlat AJ-2026-0042 · 2. verzió",
    });
    expect(
      quoteButton.closest("section")!.querySelector("h4"),
    ).toHaveTextContent("1 db");
    fireEvent.click(quoteButton);
    await waitFor(() =>
      expect(quotes.pdf).toHaveBeenCalledWith("token-1", "q1", "v2"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Teljesítési igazolás TI-2026-008" }),
    );
    await waitFor(() =>
      expect(certificates.downloadDocument).toHaveBeenCalledWith(
        "token-1",
        "cert-1",
        "d9",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Számla ACRS-2026-12" }),
    );
    await waitFor(() =>
      expect(invoices.downloadPdf).toHaveBeenCalledWith("token-1", "inv-1"),
    );
    // only the uploaded file has a delete button
    expect(screen.getAllByRole("button", { name: "Törlés" })).toHaveLength(1);
  });

  it("offers the completion certificate on a forint order, with the order's lines", async () => {
    certificates.listForPartnerOrder.mockResolvedValue([]);
    render(<PartnerOrderDetailPage orderId="o1" />);
    expect(await screen.findByText("Teljesítési igazolás")).toBeInTheDocument();
    // the panel asks in its own effect, after the heading is on the page (CI #2168, a loaded runner)
    await waitFor(() =>
      expect(certificates.listForPartnerOrder).toHaveBeenCalledWith(
        "token-1",
        "o1",
      ),
    );
  });

  it("does not offer it on an order in another currency (the certificate rounds to whole forints)", async () => {
    api.detail.mockResolvedValue(detail({ currency: "EUR" }));
    render(<PartnerOrderDetailPage orderId="o1" />);
    expect(await screen.findByText("Szűrő csere")).toBeInTheDocument();
    expect(screen.queryByText("Teljesítési igazolás")).not.toBeInTheDocument();
    expect(certificates.listForPartnerOrder).not.toHaveBeenCalled();
  });

  it("shows the lines with quantity, unit, unit price and the totals per rate", async () => {
    render(<PartnerOrderDetailPage orderId="o1" />);
    expect(await screen.findByText("Szűrő csere")).toBeInTheDocument();
    const row = screen.getByText("Extra tisztítás").closest("tr")!;
    expect(within(row).getByText("alkalom")).toBeInTheDocument();
    expect(within(row).getByText("(választott opció)")).toBeInTheDocument();
    expect(screen.getByText("Bruttó összesen").parentElement).toHaveTextContent(
      "31 750 Ft",
    );
    expect(
      screen.getByText("1146 Budapest, Állatkerti krt. 6"),
    ).toBeInTheDocument();
  });

  it("switches the unit price and the line amount to gross, display only", async () => {
    render(<PartnerOrderDetailPage orderId="o1" />);
    const first = (await screen.findByText("Szűrő csere")).closest("tr")!;
    expect(within(first).getByText("10 000 Ft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bruttó" }));
    // the unit price is 10 000 net at 27% = 12 700 gross; the line amount is the server's rounded gross, 25 400
    expect(within(first).getByText("12 700 Ft")).toBeInTheDocument();
    expect(within(first).getByText("25 400 Ft")).toBeInTheDocument();
    // the totals block stays exact, from the server
    expect(screen.getByText("Bruttó összesen").parentElement).toHaveTextContent(
      "31 750 Ft",
    );
  });

  it("shows a line's amount as the server rounded it, never its own arithmetic", async () => {
    const base = detail();
    api.detail.mockResolvedValue(
      detail({
        lines: base.lines.map((line, index) =>
          index === 0
            ? {
                ...line,
                rounded: { net: "20001", vat: "5400", gross: "25401" },
              }
            : line,
        ),
      }),
    );
    render(<PartnerOrderDetailPage orderId="o1" />);
    const first = (await screen.findByText("Szűrő csere")).closest("tr")!;
    expect(within(first).getByText("20 001 Ft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bruttó" }));
    expect(within(first).getByText("25 401 Ft")).toBeInTheDocument();
  });

  it("warns that the acceptance changed, and still shows the signed lines", async () => {
    api.detail.mockResolvedValue(detail({ quoteAccepted: false }));
    render(<PartnerOrderDetailPage orderId="o1" />);
    expect(
      await screen.findByText("Az ajánlat elfogadása azóta megváltozott"),
    ).toBeInTheDocument();
    expect(screen.getByText("Szűrő csere")).toBeInTheDocument();
  });

  it("attaches a file to the chosen step", async () => {
    api.uploadDocument.mockResolvedValue({});
    render(<PartnerOrderDetailPage orderId="o1" />);
    await screen.findByText("Szűrő csere");
    const input = screen.getByLabelText(
      "Aláírt teljesítésigazolás fájl kiválasztása",
    );
    const file = new File(["%PDF-1.4"], "tig.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(api.uploadDocument).toHaveBeenCalledWith(
        "token-1",
        "o1",
        "SIGNED_COMPLETION",
        file,
      ),
    );
  });

  it("shows the server's sentence when the upload fails", async () => {
    api.uploadDocument.mockRejectedValue(
      new Error("Csak érvényes PDF, JPEG vagy PNG fájl tölthető fel."),
    );
    render(<PartnerOrderDetailPage orderId="o1" />);
    await screen.findByText("Szűrő csere");
    fireEvent.change(screen.getByLabelText("Egyéb fájl kiválasztása"), {
      target: {
        files: [new File(["x"], "x.exe", { type: "application/x-msdownload" })],
      },
    });
    expect(
      await screen.findByText(
        "Csak érvényes PDF, JPEG vagy PNG fájl tölthető fel.",
      ),
    ).toBeInTheDocument();
  });

  it("deletes a document only after the confirmation", async () => {
    api.deleteDocument.mockResolvedValue({ deleted: true });
    render(<PartnerOrderDetailPage orderId="o1" />);
    await screen.findByText("alairt-megrendeloplap.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    expect(api.deleteDocument).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Törlés",
      }),
    );
    await waitFor(() =>
      expect(api.deleteDocument).toHaveBeenCalledWith("token-1", "o1", "d1"),
    );
  });
});
