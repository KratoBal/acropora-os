import { render, screen } from "@testing-library/react";
import type { ContentCalendarGaps } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import {
  ContentCalendarGapsPanel,
  daysLeftLabel,
} from "./content-calendar-gaps-panel";

/*
  THE GAP PANEL (T5.5 S6). What turns this red: a failed read shown as "nothing missing"; a missing event without its
  slots, their state and the time left; a late slot not said to be late; an approved slot of a sale with an unknown
  Omnibus value shown as plainly approved; a collision or a too-close newsletter pair not named; the unset frequency
  not said.
*/
const api = vi.hoisted(() => ({ gaps: vi.fn() }));
vi.mock("@/lib/api/content-calendar", () => ({ contentCalendarApi: api }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const GAPS: ContentCalendarGaps = {
  queriedAt: "2026-11-15T09:30:00.000Z",
  from: "2026-11-15",
  to: "2026-11-28",
  events: [
    {
      eventKey: "sale:a",
      kind: "SALE",
      title: "Akció: Energy",
      startsOn: "2026-11-20",
      endsOn: "2026-11-24",
      omnibusUnknown: 1,
      missing: true,
      slots: [
        {
          ruleId: "announce",
          label: "Bejelentés",
          channel: "FACEBOOK_POST",
          plannedOn: "2026-11-17",
          daysLeft: 2,
          status: "APPROVED",
          contentId: "c1",
          done: false,
        },
        {
          ruleId: "news",
          label: "Hírlevél",
          channel: "NEWSLETTER",
          plannedOn: "2026-11-13",
          daysLeft: -2,
          status: "NOT_OPENED",
          contentId: null,
          done: false,
        },
      ],
    },
    {
      eventKey: "event:e1",
      kind: "SHOP_EVENT",
      title: "Nyílt nap",
      startsOn: "2026-11-22",
      endsOn: "2026-11-22",
      omnibusUnknown: 0,
      missing: false,
      slots: [],
    },
  ],
  collisions: [
    {
      day: "2026-11-19",
      channel: "FACEBOOK_POST",
      items: [
        { contentId: "d", title: "D" },
        { contentId: "e", title: "E" },
        { contentId: "f", title: "F" },
      ],
    },
  ],
  newsletter: {
    minDaysBetween: 7,
    tooClose: [
      {
        first: {
          contentId: "n1",
          title: "Novemberi hírlevél",
          day: "2026-11-16",
        },
        second: {
          contentId: "n2",
          title: "Akciós hírlevél",
          day: "2026-11-20",
        },
        days: 4,
      },
    ],
  },
};

// no beforeEach mockClear: with it, vitest reports a handled mockRejectedValue as the test's own failure

describe("daysLeftLabel", () => {
  it("says today, the days left, and how late", () => {
    expect(daysLeftLabel(0)).toBe("ma");
    expect(daysLeftLabel(3)).toBe("3 nap múlva");
    expect(daysLeftLabel(-2)).toBe("2 napja késik");
  });
});

describe("ContentCalendarGapsPanel", () => {
  it("lists only the missing events with each slot's state and time left; an approved slot without Omnibus is not plain approved", async () => {
    api.gaps.mockResolvedValue(GAPS);
    render(<ContentCalendarGapsPanel token="t" refresh={0} />);
    expect(await screen.findByText("Hiányzik: Akció: Energy")).toBeTruthy();
    expect(screen.queryByText("Hiányzik: Nyílt nap")).toBeNull();
    expect(screen.getByText("jóváhagyva, de Omnibus nélkül")).toBeTruthy();
    expect(screen.getByText(/1 termék Omnibus-értéke ismeretlen/)).toBeTruthy();
    expect(screen.getByText("nincs megnyitva")).toBeTruthy();
    expect(screen.getByText("2 napja késik")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Bejelentés" }).getAttribute("href"),
    ).toBe("/tartalom/c1");
  });

  it("names a collision and a too-close newsletter pair", async () => {
    api.gaps.mockResolvedValue(GAPS);
    render(<ContentCalendarGapsPanel token="t" refresh={0} />);
    expect(await screen.findByText(/Ütközés nov\. 19\.: 3 tétel/)).toBeTruthy();
    expect(screen.getByText(/Túl sűrű hírlevél/).textContent).toMatch(
      /4 nap, a beállítás legalább 7/,
    );
  });

  it("says when nothing is missing, and that the newsletter rule is off without the setting", async () => {
    api.gaps.mockResolvedValue({
      ...GAPS,
      events: [GAPS.events[1]!],
      collisions: [],
      newsletter: { minDaysBetween: null, tooClose: [] },
    });
    render(<ContentCalendarGapsPanel token="t" refresh={0} />);
    expect(
      await screen.findByText("Minden esemény tartalma kész."),
    ).toBeTruthy();
    expect(
      screen.getByText(/hírlevél-gyakoriság nincs beállítva/),
    ).toBeTruthy();
  });

  it("a failed read is an error, not 'nothing missing'", async () => {
    api.gaps.mockRejectedValue(new ApiError("nem olvasható", 503));
    render(<ContentCalendarGapsPanel token="t" refresh={0} />);
    expect(await screen.findByText("A hiány-lista nem elérhető")).toBeTruthy();
    expect(screen.queryByText("Minden esemény tartalma kész.")).toBeNull();
  });
});
