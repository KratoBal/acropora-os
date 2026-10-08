import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  SimplePayReportDetail,
  SimplePayReportListResponse,
  Session,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SimplePaySettlementsPage } from "./simplepay-settlements-page";

const api = vi.hoisted(() => ({
  upload: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  reprocess: vi.fn(),
  approveLine: vi.fn(),
  syncStatus: vi.fn(),
  syncNow: vi.fn(),
  downloadMonthly: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

// a lap a Figma 45 · OS / Settlements óta `PilotThemeRoot` alatt áll (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api/simplepay-settlements", () => ({
  simplePaySettlementsApi: api,
}));

function session(role: "OWNER" | "SALES" | "WAREHOUSE"): Session {
  return {
    id: `session-${role}`,
    token: `token-${role}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: role,
      email: `${role.toLowerCase()}@acropora.local`,
      displayName: role,
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

// the 2026-07-27..31 report's shape: two payments paired, the 140 140 Ft
// order without an invoice yet (Luca's "még nem teljesített rendelés")
const reports: SimplePayReportListResponse = {
  items: [
    {
      id: "report-1",
      fileName: "report_20260805.csv",
      reportDate: "2026-08-05",
      periodStart: "2026-07-27",
      periodEnd: "2026-07-31",
      currency: "HUF",
      amountTotal: "167923",
      commissionTotal: "4120",
      netTotal: "163803",
      lineCount: 2,
      resolvedLineCount: 1,
      status: "NEEDS_REVIEW",
      warnings: [],
      createdAt: "2026-09-30T08:00:00.000Z",
    },
  ],
  pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
};

const detail: SimplePayReportDetail = {
  ...reports.items[0]!,
  lines: [
    {
      id: "line-1",
      rowNumber: 1,
      transactionStatus: "COMPLETED",
      simplePayTransactionId: "885281967",
      merchantTransactionId: "106611996T883216",
      transactionAt: "2026-07-30 13:12:30",
      amount: "8330",
      commission: "217",
      netAmount: "8113",
      orderNumber: "UNAS-47679-883216",
      orderTotal: "8330",
      invoiceNumbers: ["ACRW-2026/00437"],
      status: "RESOLVED",
      resolutionSource: "ORDER_KEY",
      updatedAt: "2026-09-30T08:00:00.000Z",
    },
    {
      id: "line-2",
      rowNumber: 2,
      transactionStatus: "COMPLETED",
      simplePayTransactionId: "885438006",
      merchantTransactionId: "106638476T608888",
      transactionAt: "2026-07-30 18:45:29",
      amount: "140140",
      commission: "3416",
      netAmount: "136724",
      orderNumber: "UNAS-47679-608888",
      orderTotal: "140140",
      invoiceNumbers: [],
      status: "NEEDS_REVIEW",
      errorCode: "ORDER_NOT_INVOICED",
      updatedAt: "2026-09-30T08:00:01.000Z",
    },
  ],
};

beforeEach(() => {
  auth.session = session("OWNER");
  api.list.mockReset().mockResolvedValue(reports);
  api.detail.mockReset().mockResolvedValue(detail);
  api.syncStatus.mockReset().mockResolvedValue({
    state: "DISABLED_NOT_SET",
    canRunNow: false,
    intervalMinutes: 60,
  });
  api.approveLine.mockReset().mockResolvedValue({
    ...detail,
    status: "COMPLETED",
    resolvedLineCount: 2,
    lines: [
      detail.lines[0]!,
      {
        ...detail.lines[1]!,
        status: "RESOLVED",
        resolutionSource: "MANUAL",
        errorCode: undefined,
        invoiceNumbers: ["ACRW-2026/00510"],
      },
    ],
  });
  api.upload.mockReset();
});

/**
 * A SIMPLEPAY ELSZÁMOLÁS OLDALA. MI PIROSÍT: ha a lista nem mutatja az
 * összesent, a jutalékot és az utaltat (Luca táblájának három száma); ha a
 * számla nélküli rendelés nem a saját okával áll; ha a jóváhagyás nem a sor
 * verziójával megy; ha a kikapcsolt behúzás oka nem látszik; ha olvasó
 * jogosultsággal feltöltés vagy jóváhagyás kínálkozik.
 */
describe("SimplePaySettlementsPage", () => {
  it("lists each weekly report with its total, commission and transfer", async () => {
    render(createElement(SimplePaySettlementsPage));
    const [row] = await screen.findAllByTestId("simplepay-kimutatas");
    expect(row).toHaveTextContent("2026. 07. 27. – 2026. 07. 31.");
    expect(row).toHaveTextContent(/167\s923 Ft/);
    expect(row).toHaveTextContent("4120 Ft");
    expect(row).toHaveTextContent(/163\s803 Ft/);
    expect(row).toHaveTextContent("1 / 2");
    expect(
      screen.getByText(/GMAIL_SIMPLEPAY_SYNC_ENABLED\) nincs beállítva/),
    ).toBeInTheDocument();
  });

  it("shows each payment's order and invoice, and why a payment waits", async () => {
    render(createElement(SimplePaySettlementsPage));
    fireEvent.click((await screen.findAllByTestId("simplepay-kimutatas"))[0]!);
    const lines = await screen.findAllByTestId("simplepay-sor");
    expect(lines[0]).toHaveTextContent("UNAS-47679-883216");
    expect(lines[0]).toHaveTextContent("ACRW-2026/00437");
    expect(lines[1]).toHaveTextContent("A rendelésnek még nincs számlája");
  });

  it("approves a waiting payment with the line's version", async () => {
    render(createElement(SimplePaySettlementsPage));
    fireEvent.click((await screen.findAllByTestId("simplepay-kimutatas"))[0]!);
    const input = await screen.findByLabelText("Számlaszám – 106638476T608888");
    fireEvent.change(input, { target: { value: " ACRW-2026/00510 " } });
    fireEvent.click(screen.getByRole("button", { name: "Jóváhagyás" }));
    await waitFor(() =>
      expect(api.approveLine).toHaveBeenCalledWith(
        "token-OWNER",
        "report-1",
        "line-2",
        {
          invoiceNumber: "ACRW-2026/00510",
          expectedUpdatedAt: "2026-09-30T08:00:01.000Z",
        },
      ),
    );
    expect(
      await screen.findByText(
        "A fizetés jóváhagyva, a kimutatás minden sora párosítva.",
      ),
    ).toBeInTheDocument();
  });

  it("downloads the chosen month's file", async () => {
    api.downloadMonthly.mockReset().mockResolvedValue(undefined);
    render(createElement(SimplePaySettlementsPage));
    await screen.findAllByTestId("simplepay-kimutatas");
    fireEvent.change(screen.getByLabelText("A havi fájl hónapja"), {
      target: { value: "2026-08" },
    });
    fireEvent.click(screen.getByRole("button", { name: "XLSX letöltése" }));
    await waitFor(() =>
      expect(api.downloadMonthly).toHaveBeenCalledWith("token-OWNER", 2026, 8),
    );
  });

  // SALES has finance.view and not finance.manage (packages/types auth.ts)
  it("offers no upload and no approval to a viewer without finance.manage", async () => {
    auth.session = session("SALES");
    render(createElement(SimplePaySettlementsPage));
    fireEvent.click((await screen.findAllByTestId("simplepay-kimutatas"))[0]!);
    await screen.findAllByTestId("simplepay-sor");
    expect(
      screen.queryByRole("button", { name: "Kimutatás feltöltése" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Jóváhagyás" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Újrafeldolgozás" }),
    ).toBeNull();
  });

  it("tells a user without finance.view that the page is closed", async () => {
    auth.session = session("WAREHOUSE");
    render(createElement(SimplePaySettlementsPage));
    expect(
      await screen.findByText("Nincs hozzáférésed a SimplePay elszámolásokhoz"),
    ).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("SP-MONTH-SUMMARY: the month's weekly reports and their totals, from the loaded list", async () => {
    render(createElement(SimplePaySettlementsPage));
    fireEvent.change(await screen.findByLabelText("A havi fájl hónapja"), {
      target: { value: "2026-07" },
    });
    expect(
      await screen.findByText(
        /^1 heti kimutatás · Összesen 167\s923 Ft · Jutalék 4120 Ft · Utalt 163\s803 Ft$/,
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("A havi fájl hónapja"), {
      target: { value: "2026-06" },
    });
    expect(
      screen.getByText(/^0 heti kimutatás · Összesen 0 Ft/),
    ).toBeInTheDocument();
  });
});
