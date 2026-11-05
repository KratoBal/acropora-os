import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaidMarkRunView, PaidMarksStatus } from "@/lib/api/paid-marks";

const api = vi.hoisted(() => ({
  latest: vi.fn(),
  status: vi.fn(),
  runNow: vi.fn(),
  feedPull: vi.fn(),
}));
vi.mock("@/lib/api/paid-marks", () => ({ paidMarksApi: api }));
// the backfill panel has its own test (feed-backfill-panel); here it has nothing to show
vi.mock("@/lib/api/feed-backfill", () => ({
  feedBackfillApi: {
    status: vi.fn().mockResolvedValue({
      running: null,
      last: null,
      year: 2026,
      series: [],
      checked: {},
    }),
    start: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/penzugy/napi-jeloles",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

import { PaidMarksPage } from "./paid-marks-page";

/*
  A „FUTTATÁS MOST” LAP (kártya e64540fd). MI PIROSÍT: ha a próba állású forrás terve számlaszám és összeg
  nélkül, vagy beírtként látszik; ha a gomb megerősítés nélkül indít; ha kiállítási jog nélkül is van gomb;
  ha futás közben újra megnyomható; ha az indítás után nem olvas újra.
*/
function as(role: UserRole): Session {
  return {
    id: "s",
    token: "t",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u",
      email: "u@acropora.local",
      displayName: "U",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

const run = (over: Partial<PaidMarkRunView>): PaidMarkRunView => ({
  source: "GLS_COD",
  startedAt: "2026-11-05T06:00:00.000Z",
  finishedAt: "2026-11-05T06:00:05.000Z",
  writtenCount: 3,
  failedCount: 0,
  attentionCount: 0,
  summary: { WRITTEN: 3 },
  attention: [],
  errorCode: null,
  mode: "auto",
  trigger: "schedule",
  triggeredById: null,
  planned: [],
  ...over,
});

const status = (
  running = false,
  nextRunAt: string | null = "2026-11-06T07:00:00.000Z",
): PaidMarksStatus => ({
  running,
  startedAt: running ? "2026-11-05T09:30:00.000Z" : null,
  nextRunAt,
  sources: [
    { source: "GLS_COD", mode: "auto" },
    { source: "FOXPOST", mode: "auto" },
    { source: "SIMPLEPAY", mode: "auto" },
    { source: "BANK_TRANSFER", mode: "dry" },
  ],
});

beforeEach(() => {
  auth.session = as("OWNER");
  api.status.mockReset().mockResolvedValue(status());
  api.runNow.mockReset();
  api.feedPull.mockReset();
  api.latest.mockReset().mockResolvedValue([
    run({}),
    run({
      source: "BANK_TRANSFER",
      mode: "dry",
      writtenCount: 0,
      summary: { PLANNED: 2 },
      trigger: "manual",
      triggeredById: "u",
      planned: [
        {
          invoiceNumber: "ACR-2026/00083",
          amount: "25000",
          date: "2026-11-04",
          sourceRef: "credit-1",
        },
        {
          invoiceNumber: "ACR-2026/00084",
          amount: "75000",
          date: "2026-11-04",
          sourceRef: "credit-1",
        },
      ],
    }),
  ]);
});

describe("PaidMarksPage", () => {
  it("each source shows its switch; the dry one lists what it would mark, with invoice number and amount", async () => {
    render(<PaidMarksPage />);
    const bank = await screen.findByTestId("paid-mark-source-BANK_TRANSFER");
    expect(bank).toHaveTextContent("Próba: csak tervez, nem ír");
    const planned = within(bank).getByTestId("paid-marks-planned");
    expect(planned).toHaveTextContent("ACR-2026/00083");
    expect(planned).toHaveTextContent("ACR-2026/00084");
    expect(planned).toHaveTextContent(/25\s?000/);
    expect(planned).toHaveTextContent(/2 számla/);
    expect(bank).toHaveTextContent("kézi indítás");
    expect(bank).not.toHaveTextContent("Beírva");
    const gls = screen.getByTestId("paid-mark-source-GLS_COD");
    expect(gls).toHaveTextContent("Automatikus: beírja");
    expect(gls).toHaveTextContent("Beírva: 3");
    expect(screen.getByTestId("paid-mark-source-FOXPOST")).toHaveTextContent(
      "Még nem futott.",
    );
  });

  it("starts the run only after the confirmation, then reads again", async () => {
    api.runNow.mockResolvedValue({ status: "started", sources: [] });
    render(<PaidMarksPage />);
    const button = await screen.findByRole("button", { name: "Futtatás most" });
    fireEvent.click(button);
    expect(api.runNow).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Futtatás most" }),
    );
    await waitFor(() => expect(api.runNow).toHaveBeenCalledWith("t"));
    expect(await screen.findByText(/A futás elindult/)).toBeInTheDocument();
    await waitFor(() => expect(api.latest).toHaveBeenCalledTimes(2));
  });

  // e64540fd fix: the header said a fixed "7:00", the server's UTC hour; it is 08:00 in Budapest in winter
  it("the header says the next daily run in Budapest time, or that none is scheduled", async () => {
    const { unmount } = render(<PaidMarksPage />);
    expect(
      await screen.findByText(/naponta 08:00-kor fut magától/),
    ).toBeInTheDocument();
    unmount();
    api.status.mockResolvedValue(status(false, null));
    render(<PaidMarksPage />);
    expect(
      await screen.findByText(/napi futása most nincs ütemezve/),
    ).toBeInTheDocument();
  });

  it("a run in flight cannot be started again", async () => {
    api.status.mockResolvedValue(status(true));
    render(<PaidMarksPage />);
    const button = await screen.findByRole("button", { name: "Fut…" });
    expect(button).toBeDisabled();
  });

  it("without the issue right there is no button", async () => {
    auth.session = as("VIEWER");
    api.latest.mockResolvedValue([glsNotFound()]);
    render(<PaidMarksPage />);
    await screen.findByTestId("paid-mark-sources");
    expect(screen.queryByRole("button", { name: "Futtatás most" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Lekérés a Számlázz.hu-ból" }),
    ).toBeNull();
  });

  /*
    „LEKÉRÉS A SZÁMLÁZZ.HU-BÓL” (aeddb2c3, acrobot 43506). MI PIROSÍT: ha a gomb nem a „nincs a Számlázz.hu feedben”
    sornál, vagy egy nem pontos számnál is áll; ha az előnézet nélkül húz be; ha a megerősítő ablak nem mutatja, mi
    kerülne be; ha a behúzás nem pontosan azt az egy számot kéri.
  */
  it("pulls a missing feed invoice: a preview first, the pull only after the confirmation", async () => {
    api.latest.mockResolvedValue([glsNotFound()]);
    api.feedPull
      .mockResolvedValueOnce([
        {
          number: "ACRW-2026/00469",
          outcome: "WOULD_STORE",
          detail:
            "SZ, bruttó 28900.0 HUF, fizetve 0.00, kifizetések elem nélkül",
        },
      ])
      .mockResolvedValueOnce([
        {
          number: "ACRW-2026/00469",
          outcome: "STORED",
          detail: "SZ, bruttó 28900.0 HUF",
          stored: "NEW",
          projected: "PROJECTED",
        },
      ]);
    render(<PaidMarksPage />);
    const gls = await screen.findByTestId("paid-mark-source-GLS_COD");
    // one button: the line with an exact number that is missing from the feed, not the other NOT_FOUND
    const buttons = within(gls).getAllByRole("button", {
      name: "Lekérés a Számlázz.hu-ból",
    });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    await waitFor(() =>
      expect(api.feedPull).toHaveBeenCalledWith(
        "t",
        ["ACRW-2026/00469"],
        false,
      ),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("bruttó 28900.0 HUF");
    expect(api.feedPull).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Behúzás" }));
    await waitFor(() =>
      expect(api.feedPull).toHaveBeenLastCalledWith(
        "t",
        ["ACRW-2026/00469"],
        true,
      ),
    );
    expect(await screen.findByTestId("feed-pull-result")).toHaveTextContent(
      "ACRW-2026/00469: behúzva; a következő futás már párosítja",
    );
  });
});

function glsNotFound(): PaidMarkRunView {
  return run({
    attentionCount: 3,
    attention: [
      {
        reference: "ACRW-2026/00469",
        reason: "NOT_FOUND",
        detail: "GLS 2026-09-10; nincs a Számlázz.hu feedben",
      },
      {
        reference: "ACRW-2026/00470",
        reason: "NOT_FOUND",
        detail: "GLS 2026-09-10; a feedben csak EBIZ forrással",
      },
      {
        reference: "2026-11-05",
        reason: "NO_CREDIT",
        detail: "utalt 79950 Ft",
      },
    ],
  });
}
