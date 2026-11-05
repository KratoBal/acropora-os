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
  ellenőrzés a behúzást kéri (vagy fordítva); ha kiállítási jog nélkül is van gomb; ha a lap nem mondja meg, hogy a
  behúzás után elindult-e a korhatár nélküli kifizetett-jelölés.
*/
const status = (
  over: Partial<FeedBackfillStatus> = {},
): FeedBackfillStatus => ({
  running: null,
  last: null,
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

  it("after a pull it says whether the paid marks ran without an age limit", async () => {
    api.status.mockResolvedValue(
      status({
        last: {
          phase: "apply",
          finishedAt: "2026-11-05T20:40:00.000Z",
          done: 302,
          rerun: "running",
        },
      }),
    );
    render(<FeedBackfillPanel token="t" canRun />);
    expect(await screen.findByTestId("feed-backfill-last")).toHaveTextContent(
      "a korhatár nélküli NEM indult el",
    );
  });
});
