import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthenticatedUser, ContentResults } from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import { ContentResultsPanel, resultWeeks } from "./content-results-panel";

/*
  THE ITEM'S RESULTS (T5.5 S8). What turns this red: an outgoing link without the item's id, or a non-web address
  "tracked"; numbers offered on an item that has not gone out; a never-entered number shown as 0; a week list that starts
  before the sending week or runs past the current one; a save that sends an empty field as 0; the entry form shown to
  someone who cannot write.
*/
const api = vi.hoisted(() => ({ results: vi.fn(), saveWeek: vi.fn() }));
vi.mock("@/lib/api/content-results", () => ({ contentResultsApi: api }));
const auth = vi.hoisted(() => ({ user: {} as Partial<AuthenticatedUser> }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { token: "t", user: auth.user } }),
}));

const RESULTS: ContentResults = {
  contentId: "c1",
  sentAt: "2026-11-04T10:00:00.000Z",
  weeks: [
    {
      weekStart: "2026-11-02",
      reach: 1200,
      reactions: 40,
      opens: null,
      clicks: 0,
      preorders: null,
      orders: null,
      updatedAt: "2026-11-09T10:00:00.000Z",
    },
  ],
  totals: {
    reach: 1200,
    reactions: 40,
    opens: null,
    clicks: 0,
    preorders: null,
    orders: null,
  },
};

describe("resultWeeks", () => {
  it("from the sending week to the current one, the latest first", () => {
    expect(
      resultWeeks("2026-11-04T10:00:00.000Z", new Date("2026-11-15T12:00:00Z")),
    ).toEqual(["2026-11-09", "2026-11-02"]);
  });
});

describe("ContentResultsPanel", () => {
  it("builds the tracking link with the item's id, and refuses a non-web address", () => {
    auth.user = { id: "u1", role: "MANAGER" } as AuthenticatedUser;
    render(
      <ContentResultsPanel
        contentId="c1"
        channel="FACEBOOK_POST"
        sentAt={null}
      />,
    );
    const input = screen.getByLabelText(/Mérőparaméteres hivatkozás/);
    fireEvent.change(input, {
      target: { value: "https://acropora.hu/termek/x" },
    });
    expect(screen.getByTestId("tracking-url").textContent).toContain(
      "utm_content=c1",
    );
    fireEvent.change(input, { target: { value: "mailto:info@acropora.hu" } });
    expect(screen.getByText(/Ez nem webcím/)).toBeTruthy();
    // not sent: no numbers asked
    expect(screen.getByText(/a kiküldés után/)).toBeTruthy();
    expect(api.results).not.toHaveBeenCalled();
  });

  it("a sent item shows its totals with '–' for what was never entered (0 stays 0), and a week's save sends empty fields as null", async () => {
    auth.user = { id: "u1", role: "MANAGER" } as AuthenticatedUser;
    api.results.mockResolvedValue(RESULTS);
    api.saveWeek.mockResolvedValue(RESULTS);
    render(
      <ContentResultsPanel
        contentId="c1"
        channel="FACEBOOK_POST"
        sentAt="2026-11-04T10:00:00.000Z"
      />,
    );
    const totals = await screen.findByTestId("results-totals");
    expect(totals.textContent).toContain("Megnyitás –");
    expect(totals.textContent).toContain("Kattintás a webshopra 0");
    fireEvent.change(screen.getByLabelText("Elérés"), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hét mentése" }));
    await waitFor(() => expect(api.saveWeek).toHaveBeenCalled());
    const [, , week, values] = api.saveWeek.mock.calls[0]!;
    expect(week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(values).toEqual({
      reach: 300,
      reactions: null,
      opens: null,
      clicks: null,
      preorders: null,
      orders: null,
    });
  });

  it("no entry form without content.manage", async () => {
    auth.user = {
      id: "u3",
      role: "VIEWER",
      permissions: ["content.view"],
    } as unknown as AuthenticatedUser;
    api.results.mockResolvedValue(RESULTS);
    render(
      <ContentResultsPanel
        contentId="c1"
        channel="FACEBOOK_POST"
        sentAt="2026-11-04T10:00:00.000Z"
      />,
    );
    await screen.findByTestId("results-totals");
    expect(screen.queryByRole("button", { name: "Hét mentése" })).toBeNull();
  });
});
