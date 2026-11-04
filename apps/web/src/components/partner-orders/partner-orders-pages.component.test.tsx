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
  beforeEach(() => api.detail.mockResolvedValue(detail()));

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
    // 10 000 net at 27% = 12 700 gross; the line 20 000 net = 25 400 gross
    expect(within(first).getByText("12 700 Ft")).toBeInTheDocument();
    expect(within(first).getByText("25 400 Ft")).toBeInTheDocument();
    // the totals block stays exact, from the server
    expect(screen.getByText("Bruttó összesen").parentElement).toHaveTextContent(
      "31 750 Ft",
    );
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
