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
}));
vi.mock("@/lib/api/paid-marks", () => ({ paidMarksApi: api }));
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

const status = (running = false): PaidMarksStatus => ({
  running,
  startedAt: running ? "2026-11-05T09:30:00.000Z" : null,
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

  it("a run in flight cannot be started again", async () => {
    api.status.mockResolvedValue(status(true));
    render(<PaidMarksPage />);
    const button = await screen.findByRole("button", { name: "Fut…" });
    expect(button).toBeDisabled();
  });

  it("without the issue right there is no button", async () => {
    auth.session = as("VIEWER");
    render(<PaidMarksPage />);
    await screen.findByTestId("paid-mark-sources");
    expect(screen.queryByRole("button", { name: "Futtatás most" })).toBeNull();
  });
});
