import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  GlsCodReportDetail,
  GlsCodReportListResponse,
  Session,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickMonth } from "@/test/month-field";
import { urlNavigation } from "@/test/url-navigation";

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

vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);
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
  urlNavigation.reset("/penzugy/elszamolasok/gls");
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
  /*
    A RÉSZLET A LISTA HELYÉN ÁLL (ugyanaz az URL), ezért a nyíl GOMB, nem link: a kattintás a kijelölést törli, és sehova nem navigál.
    MI PIROSÍT: ha a nyíl linkké válik (útvonalat kapna), ha a kattintás URL-t ír vagy lapot vált, ha a részlet a kattintás után is marad.
  */
  it("the arrow in the detail clears the selection and navigates nowhere", async () => {
    render(createElement(GlsSettlementsPage));
    fireEvent.click((await screen.findAllByTestId("gls-utalas"))[0]!);
    await screen.findByRole("heading", { name: /GLS utalás ·/ });
    const replaced = urlNavigation.replace.mock.calls.length;
    expect(screen.queryByRole("link", { name: "Elszámolások" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Elszámolások" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /GLS utalás ·/ }),
      ).toBeNull(),
    );
    expect(screen.getAllByTestId("gls-utalas")[0]).toBeInTheDocument();
    expect(urlNavigation.push).not.toHaveBeenCalled();
    expect(urlNavigation.replace.mock.calls.length).toBe(replaced);
  });

  it("when on, names the last AUTOMATIC run, not the newest button run", async () => {
    const run = {
      messagesSeen: 1,
      duplicateCount: 0,
      failedCount: 0,
      status: "APPLIED" as const,
    };
    api.syncStatus.mockResolvedValue({
      state: "ENABLED",
      canRunNow: true,
      intervalMinutes: 60,
      lastRun: {
        ...run,
        trigger: "MANUAL",
        startedAt: "2026-09-29T09:00:00.000Z",
        documentsRead: 4,
      },
      lastScheduledRun: {
        ...run,
        trigger: "SCHEDULED",
        startedAt: "2026-09-29T08:00:00.000Z",
        documentsRead: 1,
      },
    });
    render(createElement(GlsSettlementsPage));
    expect(
      await screen.findByText(/Utolsó automatikus futás: .*1 új dokumentum/),
    ).toBeTruthy();
    expect(screen.queryByText(/4 új dokumentum/)).toBeNull();
  });

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
    pickMonth("A riport hónapja", "2026-08");
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
        (_, element) =>
          element?.tagName === "P" &&
          Boolean(
            element.textContent?.endsWith(
              "Ok: a Gmail-feldolgozás kapcsolója értéke se nem true, se nem false. A GLS-fájlokat addig kézzel töltsd fel.",
            ),
          ),
      ),
    ).toBeTruthy();
  });

  it("offers no pull by hand without a Gmail key", async () => {
    render(createElement(GlsSettlementsPage));
    await screen.findByText(
      (_, element) =>
        element?.tagName === "P" &&
        Boolean(
          element.textContent?.endsWith(
            "Ok: be van kapcsolva, de nincs Gmail-kulcs. A GLS-fájlokat addig kézzel töltsd fel.",
          ),
        ),
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
      // The line names the last AUTOMATIC run (2026-09-29): a failed timer
      // run is exactly what it must not hide.
      lastScheduledRun: {
        status: "FAILED",
        trigger: "SCHEDULED",
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

  it("GLS-DETAIL-VIEW: the detail takes the list's place, with the fee invoices, and goes back", async () => {
    api.invoices.mockResolvedValue([
      {
        id: "inv-1",
        invoiceNumber: "GLS-KIT-1",
        invoiceDate: "2026-09-18",
        currency: "HUF",
        feeTotal: "12880",
        cardFeeTotal: "0",
        parcelCount: 42,
        fileName: "gls.pdf",
        createdAt: "2026-09-18T08:00:00.000Z",
      },
    ]);
    render(createElement(GlsSettlementsPage));
    fireEvent.click(
      await screen.findByText("100031291_HUF_20260903_080032.xlsx"),
    );
    expect(
      await screen.findByRole("heading", { name: /GLS utalás ·/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Utánvét-utalások" }),
    ).toBeNull();
    expect(screen.getAllByTestId("gls-sor")).toHaveLength(2);
    expect(screen.getByText("GLS-KIT-1")).toBeInTheDocument();
    expect(screen.getByTestId("szamok-sav")).toHaveTextContent("1 / 2");
    fireEvent.click(screen.getByRole("button", { name: "Elszámolások" }));
    expect(
      await screen.findByRole("heading", { name: "Utánvét-utalások" }),
    ).toBeInTheDocument();
  });

  it("GLS-WEBSHOP-PARCEL: a webshop parcel's line says how it was paired, and why a webshop line waits", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      lines: [
        {
          ...detail.lines[0]!,
          resolutionSource: "WEBSHOP_PARCEL",
        },
        {
          ...detail.lines[1]!,
          errorCode: "WEBSHOP_ORDER_AMBIGUOUS",
        },
        {
          ...detail.lines[1]!,
          id: "line-3",
          rowNumber: 11,
          errorCode: "WEBSHOP_INVOICE_AMBIGUOUS",
        },
      ],
    });
    render(createElement(GlsSettlementsPage));
    fireEvent.click(
      await screen.findByText("100031291_HUF_20260903_080032.xlsx"),
    );
    const lines = await screen.findAllByTestId("gls-sor");
    expect(lines[0]).toHaveTextContent("Párosítva webshop-csomagból");
    expect(lines[1]).toHaveTextContent(
      "A csomagszámhoz több webshop-rendelés tartozik",
    );
    expect(lines[2]).toHaveTextContent(
      "A webshop-rendelésnek több élő számlája van",
    );
  });

  it("GLS-MONTH-SUMMARY: the month's transfers, parcels and fee invoices, from the loaded list", async () => {
    api.invoices.mockResolvedValue([
      {
        id: "inv-1",
        invoiceNumber: "GLS-KIT-1",
        invoiceDate: "2026-09-18",
        currency: "HUF",
        feeTotal: "12880",
        cardFeeTotal: "0",
        parcelCount: 42,
        fileName: "gls.pdf",
        createdAt: "2026-09-18T08:00:00.000Z",
      },
    ]);
    render(createElement(GlsSettlementsPage));
    pickMonth("A riport hónapja", "2026-09");
    expect(
      await screen.findByText("1 utánvét-utalás · 2 csomag · 1 GLS díjszámla"),
    ).toBeInTheDocument();
    pickMonth("A riport hónapja", "2026-08");
    expect(
      screen.getByText("0 utánvét-utalás · 0 csomag · 0 GLS díjszámla"),
    ).toBeInTheDocument();
  });

  /**
   * barracuda's #1653 review: the list endpoint neither filters by month nor
   * sums, so the summary counts from the latest 100 and says so when that
   * window does not reach back to the month's start.
   */
  it("GLS-MONTH-WINDOW: 120 transfers, 50 loaded, an older month: the summary does not claim the whole month", async () => {
    const day = (i: number) =>
      new Date(Date.UTC(2026, 9, 5) - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const latest = Array.from({ length: 50 }, (_, i) => ({
      ...reports.items[0]!,
      id: `report-${i}`,
      fileName: `gls-${i}.xlsx`,
      transferDate: day(i),
    }));
    api.list.mockImplementation(
      async (_token: string, query: { page?: number; pageSize?: number }) => ({
        items:
          query.pageSize === 100
            ? latest
            : latest.slice(
                ((query.page ?? 1) - 1) * (query.pageSize ?? 20),
                (query.page ?? 1) * (query.pageSize ?? 20),
              ),
        pagination: {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 20,
          totalItems: 120,
          totalPages: Math.ceil(120 / (query.pageSize ?? 20)),
        },
      }),
    );
    render(createElement(GlsSettlementsPage));
    await screen.findByLabelText("A riport hónapja, év");
    // the loaded window reaches back to 2026-08-17: September is whole
    pickMonth("A riport hónapja", "2026-09");
    expect(
      await screen.findByText(/^30 utánvét-utalás · 60 csomag/),
    ).toBeInTheDocument();
    // August starts before the window: the summary says it is partial
    pickMonth("A riport hónapja", "2026-08");
    expect(
      screen.getByText(
        /^A legutóbbi 50 utalásból, a hónap régebbi utalásai nélkül: 15 utánvét-utalás/,
      ),
    ).toBeInTheDocument();
    // the pager counts from the server's total and asks it for the next page
    expect(screen.getByText(/^1–20 \/ 120$/)).toBeInTheDocument();
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő" }),
    );
    await waitFor(() =>
      expect(api.list).toHaveBeenCalledWith("token-OWNER", {
        page: 2,
        pageSize: 20,
      }),
    );
    expect(await screen.findByText(/^21–40 \/ 120$/)).toBeInTheDocument();
  });
  // a lap két listát kér: a táblázatét (20 soros lapok) és a havi kártya ablakát (100 sor, "a legutóbbiak"); a rendezés CSAK az elsőé
  const tableQueries = () =>
    api.list.mock.calls
      .map((call) => call[1] as Record<string, unknown>)
      .filter((query) => query.pageSize === 20);
  const windowQueries = () =>
    api.list.mock.calls
      .map((call) => call[1] as Record<string, unknown>)
      .filter((query) => query.pageSize === 100);

  it("sorts the table by a header, as server queries, and never the monthly window", async () => {
    render(createElement(GlsSettlementsPage));
    await screen.findAllByTestId("gls-utalas");
    expect(tableQueries().at(-1)).not.toHaveProperty("sort");

    fireEvent.click(screen.getByRole("button", { name: /Összeg/ }));
    await waitFor(() =>
      expect(tableQueries().at(-1)).toMatchObject({
        sort: "total",
        direction: "asc",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Összeg/ }));
    await waitFor(() =>
      expect(tableQueries().at(-1)).toMatchObject({
        sort: "total",
        direction: "desc",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Összeg/ }));
    await waitFor(() =>
      expect(tableQueries().at(-1)).not.toHaveProperty("sort"),
    );
    // a havi kártya ablaka a legutóbbi utalásokat kéri, a tábla sorrendjétől függetlenül
    expect(windowQueries().length).toBeGreaterThan(0);
    for (const query of windowQueries())
      expect(query).not.toHaveProperty("sort");
  });

  it("sends the right server field for the date and the file headers", async () => {
    render(createElement(GlsSettlementsPage));
    await screen.findAllByTestId("gls-utalas");
    for (const [name, field] of [
      ["Utalás napja", "transferDate"],
      ["Fájl", "fileName"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() =>
        expect(tableQueries().at(-1)).toMatchObject({
          sort: field,
          direction: "asc",
        }),
      );
      fireEvent.click(screen.getByRole("button", { name }));
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() =>
        expect(tableQueries().at(-1)).not.toHaveProperty("sort"),
      );
    }
  });

  it("a new sort goes back to the first page", async () => {
    api.list.mockResolvedValue({
      ...reports,
      pagination: { page: 1, pageSize: 20, totalItems: 120, totalPages: 6 },
    });
    render(createElement(GlsSettlementsPage));
    await screen.findAllByTestId("gls-utalas");
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő" }),
    );
    await waitFor(() =>
      expect(tableQueries().at(-1)).toMatchObject({ page: 2 }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Fájl/ }));
    await waitFor(() =>
      expect(tableQueries().at(-1)).toMatchObject({
        page: 1,
        sort: "fileName",
      }),
    );
  });

  it("the pairing and the state have no sort button", async () => {
    render(createElement(GlsSettlementsPage));
    await screen.findAllByTestId("gls-utalas");
    expect(screen.queryByRole("button", { name: /Párosítva/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Állapot/ })).toBeNull();
  });
});
