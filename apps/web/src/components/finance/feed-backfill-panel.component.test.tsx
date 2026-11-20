import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedBackfillStatus } from "@/lib/api/feed-backfill";

const api = vi.hoisted(() => ({ status: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/api/feed-backfill", () => ({ feedBackfillApi: api }));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

import { FeedBackfillPanel } from "./feed-backfill-panel";

/*
  A FEED VISSZATÖLTÉSE (6fd8c574; acrobot 43766, 43768). MI PIROSÍT: ha az ACRW sorozat nem külön sorban mondja meg,
  hányat ismer a Számlázz.hu; ha a behúzás megerősítés nélkül indul, vagy nem a behúzható darabot mondja; ha az
  ellenőrzés a behúzást kéri (vagy fordítva); ha kiállítási jog nélkül is van gomb; ha a behúzás
  megerősítése nem mondja meg, hogy a régi jóváírások párosítása nem indul magától (acrobot 43822).
*/
const status = (
  over: Partial<FeedBackfillStatus> = {},
): FeedBackfillStatus => ({
  running: null,
  last: null,
  control: null,
  year: 2026,
  series: [
    { series: "2026", highest: "2026/00120", missing: 70 },
    { series: "ACRW-2026", highest: "ACRW-2026/00508", missing: 405 },
  ],
  checked: {
    "ACRW-2026": { WOULD_STORE: 300, NOT_FOUND: 100, ERROR: 5 },
    "2026": { WOULD_STORE: 2, NOT_FOUND: 68 },
  },
  ...over,
});

beforeEach(() => {
  api.status.mockReset().mockResolvedValue(status());
  api.start.mockReset().mockResolvedValue({
    status: "started",
    phase: "apply",
    total: 302,
  });
});

describe("FeedBackfillPanel", () => {
  it("each series on its own line: what is missing, what Számlázz.hu knows and does not", async () => {
    render(<FeedBackfillPanel token="t" canRun />);
    const acrw = await screen.findByTestId("feed-backfill-series-ACRW-2026");
    expect(acrw).toHaveTextContent("A feedből hiányzik: 405");
    expect(acrw).toHaveTextContent("a Számlázz.hu ismeri: 300");
    expect(acrw).toHaveTextContent("nem ismeri: 100");
    expect(acrw).toHaveTextContent("hiba: 5");
    expect(screen.getByTestId("feed-backfill-series-2026")).toHaveTextContent(
      "a Számlázz.hu ismeri: 2",
    );
  });

  /*
    A MI FIÓKUNKON KÍVÜLI SOROZAT (acrobot 58095). MI PIROSÍT: ha a kimaradt sorozat hiányszámot, "ismeri" számlálót vagy
    bármi, a Számlázz.hu-s visszatöltésre utaló szöveget mutat; ha nem a kért mondat áll ott; ha a gombok darabszáma a
    kimaradt sorozatot is viszi; ha minden sorozat kimaradt, és a gomb mégis él; ha a kimaradt sorozat kontroll-bukásként
    riasztást ad.
  */
  const foreignStatus = (all = false) =>
    status({
      series: [
        { series: "2026", highest: "2026/00120", missing: 70 },
        { series: "ACRW-2026", highest: "ACRW-2026/00508", missing: 405 },
      ],
      checked: {
        // an older "known" answer of a series later judged foreign must not count in the pull button either
        "ACRW-2026": { NOT_OUR_ACCOUNT: 1, WOULD_STORE: 3 },
        "2026": all
          ? { NOT_OUR_ACCOUNT: 1 }
          : { WOULD_STORE: 2, NOT_FOUND: 68 },
      },
    });

  it("a series outside our Számlázz.hu account shows one sentence, no counters, and is not in the buttons' counts", async () => {
    api.status.mockResolvedValue(foreignStatus());
    render(<FeedBackfillPanel token="t" canRun />);
    const acrw = await screen.findByTestId("feed-backfill-series-ACRW-2026");
    expect(
      within(acrw).getByText(
        "Ezeket a Cashman állítja ki, a hiányzókat a NAV-ból töltjük be.",
      ),
    ).toBeInTheDocument();
    expect(acrw).not.toHaveTextContent("hiányzik");
    expect(acrw).not.toHaveTextContent("a Számlázz.hu ismeri");
    // the other series keeps its counters and the button counts only it
    expect(screen.getByTestId("feed-backfill-series-2026")).toHaveTextContent(
      "a Számlázz.hu ismeri: 2",
    );
    expect(
      screen.getByRole("button", { name: "Behúzás (2 számla)" }),
    ).toBeEnabled();
  });

  it("when every series is outside the account, both buttons are off", async () => {
    api.status.mockResolvedValue(foreignStatus(true));
    render(<FeedBackfillPanel token="t" canRun />);
    await screen.findByTestId("feed-backfill-foreign-2026");
    expect(
      screen.getByRole("button", { name: "Ellenőrzés a Számlázz.hu-nál" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Behúzás (0 számla)" }),
    ).toBeDisabled();
  });

  it("a foreign control result is not a control failure alert", async () => {
    api.status.mockResolvedValue({
      ...foreignStatus(),
      control: {
        checkedAt: "2026-11-20T12:00:00Z",
        results: [
          {
            series: "ACRW-2026",
            number: "ACRW-2026/00508",
            outcome: "NOT_FOUND",
            detail: "7",
            passed: false,
            foreign: true,
          },
        ],
      },
    });
    render(<FeedBackfillPanel token="t" canRun />);
    await screen.findByTestId("feed-backfill-series-ACRW-2026");
    expect(
      screen.queryByTestId("feed-backfill-control-failed"),
    ).not.toBeInTheDocument();
  });

  it("the pull asks first, names how many, and only then pulls", async () => {
    render(<FeedBackfillPanel token="t" canRun />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Behúzás (302 számla)" }),
    );
    expect(api.start).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("302 számlát");
    fireEvent.click(within(dialog).getByRole("button", { name: "Behúzás" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith("t", true));
  });

  it("the check asks the dry round", async () => {
    render(<FeedBackfillPanel token="t" canRun />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ellenőrzés a Számlázz.hu-nál",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ellenőrzés" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith("t", false));
  });

  it("without the issue right there is no button", async () => {
    render(<FeedBackfillPanel token="t" canRun={false} />);
    await screen.findByTestId("feed-backfill");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the pull says the old credits are not paired by themselves (acrobot 43822)", async () => {
    render(<FeedBackfillPanel token="t" canRun />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Behúzás (302 számla)" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "nem indul magától",
    );
  });

  // acrobot 57804: 542 "nem ismeri" válasz mellett 0 hiba látszott, miközben a kérdezés alakja rossz volt
  it("a failed control is shown with the Számlázz.hu's own words, and the old unchecked answers are not counted as unknown", async () => {
    api.status.mockResolvedValue(
      status({
        checked: { "ACRW-2026": { UNVERIFIED: 469 } },
        control: {
          checkedAt: "2026-11-20T09:00:00Z",
          results: [
            {
              series: "ACRW-2026",
              number: "ACRW-2026/00571",
              outcome: "NOT_FOUND",
              detail: "a Számlázz.hu 7-es hibakóddal felelt: Hiányzó adat",
              passed: false,
              diagnostics: [
                "ACRW-2026/00571, PDF-lekérés: megvan (PDF 1234 bájt)",
                "az OS által kiállított E-2026-5, XML-lekérdezés: 7-es hibakód",
              ],
            },
          ],
        },
      }),
    );
    render(<FeedBackfillPanel token="t" canRun />);
    const failed = await screen.findByTestId("feed-backfill-control-failed");
    expect(failed).toHaveTextContent("ACRW-2026/00571");
    expect(failed).toHaveTextContent("7-es hibakóddal felelt: Hiányzó adat");
    // the diagnostics tell a broken request shape from a number the key does not see
    expect(failed).toHaveTextContent("PDF-lekérés: megvan (PDF 1234 bájt)");
    expect(failed).toHaveTextContent("E-2026-5, XML-lekérdezés: 7-es hibakód");
    const acrw = screen.getByTestId("feed-backfill-series-ACRW-2026");
    expect(acrw).toHaveTextContent("nem ismeri: 0");
    expect(acrw).toHaveTextContent("ellenőrzésre vár");
    expect(acrw).toHaveTextContent("469");
    expect(screen.queryByTestId("feed-backfill-control-ok")).toBeNull();
  });

  it("a control that stopped the round on the press is named in the notice and in the failed list", async () => {
    api.start.mockResolvedValue({
      status: "control-failed",
      control: [
        {
          series: "2026",
          number: "2026/00090",
          outcome: "ERROR",
          detail: "a Számlázz.hu hibát jelzett (hibakód 3): Hibás kulcs",
          passed: false,
        },
      ],
    });
    render(<FeedBackfillPanel token="t" canRun />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ellenőrzés a Számlázz.hu-nál",
      }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Ellenőrzés",
      }),
    );
    expect(
      await screen.findByTestId("feed-backfill-control-failed"),
    ).toHaveTextContent("2026/00090: a Számlázz.hu hibát jelzett");
    expect(
      screen.getByText(/A kontroll nem sikerült: a kör nem kérdezett tovább/),
    ).toBeInTheDocument();
  });

  it("a passed control is reported and shows no failure", async () => {
    api.status.mockResolvedValue(
      status({
        control: {
          checkedAt: "2026-11-20T09:00:00Z",
          results: [
            {
              series: "2026",
              number: "2026/00090",
              outcome: "WOULD_STORE",
              detail: "SZ",
              passed: true,
            },
          ],
        },
      }),
    );
    render(<FeedBackfillPanel token="t" canRun />);
    expect(
      await screen.findByTestId("feed-backfill-control-ok"),
    ).toHaveTextContent("2026/00090 megvan a Számlázz.hu-ban");
    expect(screen.queryByTestId("feed-backfill-control-failed")).toBeNull();
  });
});
