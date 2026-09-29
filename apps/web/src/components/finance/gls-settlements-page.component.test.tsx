import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  GlsCodReportDetail,
  GlsCodReportListResponse,
  Session,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlsSettlementsPage } from "./gls-settlements-page";

const api = vi.hoisted(() => ({
  upload: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  reprocess: vi.fn(),
  approveLine: vi.fn(),
  invoices: vi.fn(),
  downloadReport: vi.fn(),
  syncStatus: vi.fn(),
  syncNow: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api/gls-settlements", () => ({
  glsSettlementsApi: api,
}));

function session(role: "OWNER" | "WAREHOUSE"): Session {
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

const reports: GlsCodReportListResponse = {
  items: [
    {
      id: "report-1",
      fileName: "100031291_HUF_20260903_080032.xlsx",
      transferDate: "2026-09-03",
      currency: "HUF",
      total: "56350",
      lineCount: 2,
      resolvedLineCount: 1,
      status: "NEEDS_REVIEW",
      createdAt: "2026-09-29T08:00:00.000Z",
    },
  ],
  pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
};

const detail: GlsCodReportDetail = {
  ...reports.items[0]!,
  lines: [
    {
      id: "line-1",
      rowNumber: 9,
      parcelNumber: "1000000001",
      codReference: "ACRW-2026/00001",
      amount: "28900",
      invoiceNumbers: ["ACRW-2026/00001"],
      status: "RESOLVED",
      resolutionSource: "INVOICE_NUMBER",
      updatedAt: "2026-09-29T08:00:00.000Z",
    },
    {
      id: "line-2",
      rowNumber: 10,
      parcelNumber: "1000000002",
      codReference: "2026/00002",
      amount: "27450",
      invoiceNumbers: [],
      status: "NEEDS_REVIEW",
      errorCode: "PREFIX_MISSING",
      suggestedInvoiceNumber: "ACRW-2026/00002",
      updatedAt: "2026-09-29T08:00:01.000Z",
    },
  ],
};

beforeEach(() => {
  auth.session = session("OWNER");
  api.list.mockReset().mockResolvedValue(reports);
  api.invoices.mockReset().mockResolvedValue([]);
  api.detail.mockReset().mockResolvedValue(detail);
  api.approveLine.mockReset().mockResolvedValue({
    ...detail,
    status: "COMPLETED",
    lines: [
      detail.lines[0]!,
      {
        ...detail.lines[1]!,
        status: "RESOLVED",
        resolutionSource: "MANUAL",
        invoiceNumbers: ["ACRW-2026/00002"],
      },
    ],
  });
  api.upload.mockReset();
  api.syncStatus.mockReset().mockResolvedValue({
    state: "NO_KEY",
    canRunNow: false,
    intervalMinutes: 60,
  });
  api.syncNow.mockReset();
});

describe("GlsSettlementsPage", () => {
  it("opens a transfer and approves the open line with the suggested number", async () => {
    render(createElement(GlsSettlementsPage));
    fireEvent.click(
      await screen.findByText("100031291_HUF_20260903_080032.xlsx"),
    );

    expect(await screen.findByText("Előtag nélküli számlaszám")).toBeTruthy();
    const input = screen.getByLabelText(
      "Számlaszám – 1000000002",
    ) as HTMLInputElement;
    expect(input.value).toBe("ACRW-2026/00002");

    fireEvent.click(screen.getByRole("button", { name: "Jóváhagyás" }));
    await waitFor(() =>
      expect(api.approveLine).toHaveBeenCalledWith(
        "token-OWNER",
        "report-1",
        "line-2",
        {
          invoiceNumber: "ACRW-2026/00002",
          expectedUpdatedAt: "2026-09-29T08:00:01.000Z",
        },
      ),
    );
    expect(
      await screen.findByText(
        "A tétel jóváhagyva, az utalás minden sora párosítva.",
      ),
    ).toBeTruthy();
  });

  it("uploads every chosen file and says what each one was", async () => {
    api.upload
      .mockResolvedValueOnce({
        kind: "COD_REPORT",
        id: "report-2",
        duplicate: false,
        newlyResolvedLineCount: 3,
      })
      .mockResolvedValueOnce({
        kind: "INVOICE_ATTACHMENT",
        id: "invoice-1",
        duplicate: true,
        newlyResolvedLineCount: 0,
      })
      .mockResolvedValueOnce({
        kind: "COMPENSATION_LETTER",
        id: "letter-1",
        duplicate: false,
        newlyResolvedLineCount: 0,
      });
    render(createElement(GlsSettlementsPage));
    const files = [
      new File(["a"], "utanvet.xlsx"),
      new File(["b"], "SettlementDocument_HU00000001.xlsx"),
      new File(["c"], "100031291_20260910.pdf"),
    ];
    fireEvent.change(screen.getByLabelText("GLS fájlok feltöltése"), {
      target: { files },
    });
    expect(
      await screen.findByText(
        "utanvet.xlsx: utánvét-részletező beolvasva, 3 sor párosítva. SettlementDocument_HU00000001.xlsx: ez a számlamelléklet már bent volt. 100031291_20260910.pdf: kompenzációs értesítő beolvasva, a havi fájlban az utalás napjához kerül.",
      ),
    ).toBeTruthy();
    expect(api.upload).toHaveBeenCalledTimes(3);
    expect(
      (screen.getByLabelText("GLS fájlok feltöltése") as HTMLInputElement)
        .accept,
    ).toBe(".xlsx,.pdf");
  });

  it("shows no page to someone without finance.view", () => {
    auth.session = session("WAREHOUSE");
    render(createElement(GlsSettlementsPage));
    expect(
      screen.getByText("Nincs hozzáférésed a GLS elszámolásokhoz"),
    ).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("downloads the chosen month's accountant file", async () => {
    api.downloadReport.mockReset().mockResolvedValue(undefined);
    render(createElement(GlsSettlementsPage));
    fireEvent.change(screen.getByLabelText("A riport hónapja"), {
      target: { value: "2026-08" },
    });
    fireEvent.click(screen.getByRole("button", { name: "XLSX letöltése" }));
    await waitFor(() =>
      expect(api.downloadReport).toHaveBeenCalledWith("token-OWNER", 2026, 8),
    );
  });

  it("says on the page that the Gmail pull is off, and why", async () => {
    api.syncStatus.mockResolvedValue({
      state: "DISABLED_UNRECOGNISED",
      canRunNow: true,
      intervalMinutes: 60,
    });
    render(createElement(GlsSettlementsPage));
    expect(
      await screen.findByText(
        "Ok: a kapcsoló (GMAIL_GLS_SYNC_ENABLED) értéke se nem true, se nem false. A GLS-fájlokat addig kézzel töltsd fel.",
      ),
    ).toBeTruthy();
  });

  it("offers no pull by hand without a Gmail key", async () => {
    render(createElement(GlsSettlementsPage));
    await screen.findByText(
      "Ok: be van kapcsolva, de nincs Gmail-kulcs. A GLS-fájlokat addig kézzel töltsd fel.",
    );
    expect(
      screen.queryByRole("button", { name: "Gmail ellenőrzése most" }),
    ).toBeNull();
  });

  it("shows the last run when the pull is on, and pulls by hand", async () => {
    api.syncStatus.mockResolvedValue({
      state: "ENABLED",
      canRunNow: true,
      intervalMinutes: 60,
      lastRun: {
        status: "FAILED",
        startedAt: "2026-09-29T09:00:00.000Z",
        messagesSeen: 0,
        documentsRead: 0,
        duplicateCount: 0,
        failedCount: 0,
        errorCode: "GLS_GMAIL_AUTH_FAILED",
      },
    });
    api.syncNow.mockResolvedValue({
      status: "APPLIED",
      startedAt: "2026-09-29T10:00:00.000Z",
      messagesSeen: 3,
      documentsRead: 1,
      duplicateCount: 1,
      failedCount: 1,
    });
    render(createElement(GlsSettlementsPage));
    expect(
      await screen.findByText(/sikertelen \(GLS_GMAIL_AUTH_FAILED\)/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Gmail ellenőrzése most" }),
    );
    expect(
      await screen.findByText(
        "Gmail ellenőrzés kész: 3 GLS-levél, 1 új dokumentum, 1 már bent volt, 1 nem olvasható.",
      ),
    ).toBeTruthy();
  });
});
