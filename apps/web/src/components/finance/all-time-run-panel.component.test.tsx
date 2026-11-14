import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AllTimePreview } from "@/lib/api/paid-marks";

const api = vi.hoisted(() => ({ allTimePreview: vi.fn(), runNow: vi.fn() }));
vi.mock("@/lib/api/paid-marks", () => ({ paidMarksApi: api }));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

import { AllTimeRunPanel } from "./all-time-run-panel";

/*
  A KORHATÁR NÉLKÜLI FUTÁS (acrobot 43822: "Ne menjen vakon"). MI PIROSÍT: ha a beírás az előnézet előtt is
  megnyomható; ha az előnézet nem forrásonként mutatja a darabot és a sorokat, vagy maga ír; ha a beírás megerősítés
  nélkül indul, vagy a megerősítés nem mondja meg, hány jelölés megy ki forrásonként; ha a beírás nem korhatár nélkül
  indul; ha egy elbukott forrás eltakarja a többit; ha a már futó futás mellett "elindult"-at mond.
*/
const preview: AllTimePreview[] = [
  {
    source: "BANK_TRANSFER",
    mode: "auto",
    planned: [
      {
        invoiceNumber: "2026/00069",
        amount: "120000",
        date: "2026-09-07",
        sourceRef: "credit-zoo",
      },
      {
        invoiceNumber: "2026/00070",
        amount: "80000",
        date: "2026-09-07",
        sourceRef: "credit-zoo",
      },
    ],
    skipped: { LOGGED_BEFORE: 12, ALREADY_PAID: 3 },
    attentionCount: 3,
    summary: { PLANNED: 2 },
    errorCode: null,
  },
  {
    source: "GLS_COD",
    mode: "dry",
    planned: [
      {
        invoiceNumber: "ACRW-2026/00419",
        amount: "28900",
        date: "2026-08-20",
        sourceRef: "gls-1",
      },
    ],
    skipped: {},
    attentionCount: 0,
    summary: { PLANNED: 1 },
    errorCode: null,
  },
  {
    source: "FOXPOST",
    mode: "auto",
    planned: [],
    skipped: {},
    attentionCount: 0,
    summary: {},
    errorCode: "FOXPOST_READ_FAILED",
  },
];

beforeEach(() => {
  api.allTimePreview.mockReset().mockResolvedValue(preview);
  api.runNow.mockReset().mockResolvedValue({ status: "started", sources: [] });
});

describe("AllTimeRunPanel", () => {
  it("the write waits for the preview; the preview shows each source's count and lines and writes nothing", async () => {
    render(<AllTimeRunPanel token="t" onStarted={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Beírás korhatár nélkül" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Előnézet korhatár nélkül" }),
    );
    const bank = await screen.findByTestId("all-time-preview-BANK_TRANSFER");
    expect(bank).toHaveTextContent("kifizetettre jelölne 2 számlát");
    expect(bank).toHaveTextContent("2026/00069");
    expect(bank).toHaveTextContent("figyelmet kérne 3");
    // acrobot 43886: what the writer would leave out is said per reason, not counted as a mark
    expect(bank).toHaveTextContent(
      "kimarad: már beírva 12, a feed szerint fizetve 3",
    );
    expect(
      screen.getByTestId("all-time-preview-GLS_COD"),
    ).not.toHaveTextContent("kimarad");
    expect(screen.getByTestId("all-time-preview-GLS_COD")).toHaveTextContent(
      "próba: csak tervezné 1 számlát",
    );
    expect(screen.getByTestId("all-time-preview-FOXPOST")).toHaveTextContent(
      "az előnézet nem sikerült (FOXPOST_READ_FAILED)",
    );
    expect(api.runNow).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Beírás korhatár nélkül" }),
    ).toBeEnabled();
  });

  it("the write asks first, names the count per writing source, then runs without an age limit", async () => {
    const onStarted = vi.fn();
    render(<AllTimeRunPanel token="t" onStarted={onStarted} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Előnézet korhatár nélkül" }),
    );
    await screen.findByTestId("all-time-preview");
    fireEvent.click(
      screen.getByRole("button", { name: "Beírás korhatár nélkül" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Az automatikus források 2 számlát jelölnek kifizetettre",
    );
    expect(dialog).toHaveTextContent("Banki átutalás: 2");
    expect(api.runNow).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Beírás" }));
    await waitFor(() =>
      expect(api.runNow).toHaveBeenCalledWith("t", { allTime: true }),
    );
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
  });

  it("a run already in flight: it says the run did not start", async () => {
    api.runNow.mockResolvedValue({ status: "running" });
    const onStarted = vi.fn();
    render(<AllTimeRunPanel token="t" onStarted={onStarted} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Előnézet korhatár nélkül" }),
    );
    await screen.findByTestId("all-time-preview");
    fireEvent.click(
      screen.getByRole("button", { name: "Beírás korhatár nélkül" }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Beírás",
      }),
    );
    expect(
      await screen.findByText(/a korhatár nélküli NEM indult el/),
    ).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
