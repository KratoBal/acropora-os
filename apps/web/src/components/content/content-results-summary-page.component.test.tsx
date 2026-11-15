import { render, screen } from "@testing-library/react";
import type { AuthenticatedUser, ContentResultsSummary } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { ContentResultsSummaryPage } from "./content-results-summary-page";

/*
  THE RESULTS SUMMARY PAGE (T5.5 S8). What turns this red: a failed read shown as "no results"; an average or a best
  item missing; an unmeasured number shown as 0; the pre-registrations or the dayparts not shown.
*/
const api = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock("@/lib/api/content-results", () => ({ contentResultsApi: api }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "t",
      user: { id: "u1", role: "MANAGER" } as AuthenticatedUser,
    },
  }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const SUMMARY: ContentResultsSummary = {
  from: "2026-11",
  to: "2026-11",
  byChannel: [
    {
      channel: "FACEBOOK_POST",
      items: 3,
      measured: 2,
      avgReach: 600,
      avgClicks: null,
      best: { contentId: "a", title: "Új halak", reach: 1000 },
      worst: { contentId: "b", title: "Vízcsere", reach: 200 },
    },
  ],
  preorders: [{ contentId: "a", title: "Új halak", preorders: 5 }],
  byDaypart: [
    { daypart: "reggel", measured: 0, avgReach: null },
    { daypart: "este", measured: 2, avgReach: 600 },
  ],
};

describe("ContentResultsSummaryPage", () => {
  it("shows per channel the counts, the averages ('–' when unmeasured), the best and the worst; the pre-registrations; the dayparts", async () => {
    api.summary.mockResolvedValue(SUMMARY);
    render(<ContentResultsSummaryPage />);
    expect(await screen.findByText(/3 kiment, ebből 2 mért/)).toBeTruthy();
    expect(screen.getByText(/átlagos kattintás –/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Vízcsere" }).getAttribute("href"),
    ).toBe("/tartalom/b");
    expect(screen.getByText(/5 előjegyzés/)).toBeTruthy();
    expect(screen.getByText(/este: 2 mért tétel/)).toBeTruthy();
  });

  it("a failed read is an error, not 'no results'", async () => {
    api.summary.mockRejectedValue(new ApiError("nem olvasható", 503));
    render(<ContentResultsSummaryPage />);
    expect(await screen.findByText("Az eredmények nem elérhetők")).toBeTruthy();
    expect(screen.queryByText(/nem ment ki tartalom/)).toBeNull();
  });
});
