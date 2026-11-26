import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthenticatedUser, ContentTemplateRule } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import {
  ContentCalendarTemplatePage,
  templateTimingLabel,
} from "./content-calendar-template-page";

/*
  THE CALENDAR TEMPLATE PAGE (T5.5 S4). What turns this red: a row's timing said wrongly (before for after, the start
  for the last day); an event kind with no rows silently missing; a switched-off row looking like a live one; an edit
  that does not send the row's updatedAt; a one-day arrival offered an end anchor; the edit buttons shown to someone
  who cannot write; a failed read shown as an empty template.
*/
const api = vi.hoisted(() => ({
  template: vi.fn(),
  createTemplateRule: vi.fn(),
  updateTemplateRule: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
}));
vi.mock("@/lib/api/content-calendar", () => ({ contentCalendarApi: api }));
const auth = vi.hoisted(() => ({ user: {} as Partial<AuthenticatedUser> }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { token: "token-1", user: auth.user } }),
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

const rule = (over: Partial<ContentTemplateRule>): ContentTemplateRule => ({
  id: "r1",
  eventKind: "SALE",
  label: "Bejelentés",
  channel: "FACEBOOK_POST",
  anchor: "START",
  offsetDays: -3,
  active: true,
  sortOrder: 1,
  updatedAt: "2026-11-15T10:00:00.000Z",
  ...over,
});
const SEEDED = [
  rule({
    id: "t55-livestock-preorder",
    eventKind: "LIVESTOCK_ARRIVAL",
    label: "Előjegyzés-felhívás",
    offsetDays: -7,
  }),
  rule({ id: "t55-sale-announce" }),
  rule({
    id: "t55-sale-last-day",
    label: "Emlékeztető az utolsó napon",
    anchor: "END",
    offsetDays: 0,
  }),
  rule({
    id: "t55-sale-newsletter",
    label: "Hírlevél",
    channel: "NEWSLETTER",
    offsetDays: 0,
    active: false,
  }),
];

// no mockReset: with a reset, vitest reports a handled mockRejectedValue as the test's own failure
beforeEach(() => {
  auth.user = { id: "u1", role: "MANAGER" } as AuthenticatedUser;
  api.template.mockClear();
  api.updateTemplateRule.mockClear();
  api.createTemplateRule.mockClear();
  api.saveSettings.mockClear();
  api.settings.mockResolvedValue({ newsletterMinDays: null, updatedAt: null });
});

describe("templateTimingLabel", () => {
  it("says before, on and after, from the start or the last day, and the arrival's day for a one-day arrival", () => {
    expect(
      templateTimingLabel({
        eventKind: "SALE",
        anchor: "START",
        offsetDays: -3,
      }),
    ).toBe("3 nappal a kezdet előtt");
    expect(
      templateTimingLabel({ eventKind: "SALE", anchor: "END", offsetDays: 0 }),
    ).toBe("az utolsó napon");
    expect(
      templateTimingLabel({ eventKind: "SALE", anchor: "END", offsetDays: 2 }),
    ).toBe("2 nappal az utolsó nap után");
    expect(
      templateTimingLabel({
        eventKind: "LIVESTOCK_ARRIVAL",
        anchor: "START",
        offsetDays: 0,
      }),
    ).toBe("az érkezés napján");
    expect(
      templateTimingLabel({
        eventKind: "LIVESTOCK_ARRIVAL",
        anchor: "START",
        offsetDays: 1,
      }),
    ).toBe("1 nappal az érkezés után");
  });
});

describe("ContentCalendarTemplatePage", () => {
  it("steps back to the calendar with the shared arrow link", async () => {
    api.template.mockResolvedValue(SEEDED);
    render(<ContentCalendarTemplatePage />);
    const back = await screen.findByRole("link", { name: "Naptár" });
    expect(back.getAttribute("href")).toBe("/tartalom/naptar");
  });

  it("lists every event kind, its rows with channel and timing, a switched-off row as such, and a kind without rows says so", async () => {
    api.template.mockResolvedValue(SEEDED);
    render(<ContentCalendarTemplatePage />);
    expect(await screen.findByText("Előjegyzés-felhívás")).toBeTruthy();
    expect(screen.getByText(/7 nappal az érkezés előtt/)).toBeTruthy();
    expect(screen.getByText(/Facebook poszt · az utolsó napon/)).toBeTruthy();
    expect(screen.getByText(/Hírlevél · a kezdet napján/)).toBeTruthy();
    expect(screen.getByText("kikapcsolva")).toBeTruthy();
    // purchase arrival, shop event, holiday: no rows, said
    expect(
      screen.getAllByText(/Ehhez az eseményhez nincs sablon-sor/),
    ).toHaveLength(3);
  });

  it("an edit sends the row's updatedAt, and the new days", async () => {
    api.template.mockResolvedValue(SEEDED);
    api.updateTemplateRule.mockResolvedValue(SEEDED[1]);
    render(<ContentCalendarTemplatePage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Bejelentés szerkesztése" }),
    );
    fireEvent.change(screen.getByLabelText("Hány nappal"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.updateTemplateRule).toHaveBeenCalled());
    expect(api.updateTemplateRule).toHaveBeenCalledWith(
      "token-1",
      "t55-sale-announce",
      {
        label: "Bejelentés",
        channel: "FACEBOOK_POST",
        anchor: "START",
        offsetDays: -5,
        active: true,
      },
      "2026-11-15T10:00:00.000Z",
    );
    await waitFor(() => expect(api.template).toHaveBeenCalledTimes(2));
  });

  it("a one-day arrival's form offers no end anchor; a sale's does", async () => {
    api.template.mockResolvedValue(SEEDED);
    render(<ContentCalendarTemplatePage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Előjegyzés-felhívás szerkesztése",
      }),
    );
    expect(screen.queryByLabelText("Melyik naphoz")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mégse" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Bejelentés szerkesztése" }),
    );
    expect(screen.getByLabelText("Melyik naphoz")).toBeTruthy();
  });

  it("a stale edit says the change was not saved", async () => {
    api.template.mockResolvedValue(SEEDED);
    api.updateTemplateRule.mockRejectedValue(new ApiError("ütközés", 409));
    render(<ContentCalendarTemplatePage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Bejelentés szerkesztése" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText(/közben valaki módosította/)).toBeTruthy();
  });

  it("no edit or new-row buttons without content.manage", async () => {
    auth.user = {
      id: "u3",
      role: "VIEWER",
      permissions: ["content.view"],
    } as unknown as AuthenticatedUser;
    api.template.mockResolvedValue(SEEDED);
    render(<ContentCalendarTemplatePage />);
    await screen.findByText("Előjegyzés-felhívás");
    expect(screen.queryByRole("button", { name: /szerkesztése/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Új sor" })).toBeNull();
  });

  it("the newsletter frequency says when it is not set, and saves a number or clears with an empty field", async () => {
    api.template.mockResolvedValue(SEEDED);
    api.saveSettings.mockResolvedValue({
      newsletterMinDays: 7,
      updatedAt: "2026-11-15T11:00:00.000Z",
    });
    render(<ContentCalendarTemplatePage />);
    expect(await screen.findByText(/Nincs beállítva/)).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText("Legalább ennyi nap két hírlevél között"),
      { target: { value: "7" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Gyakoriság mentése" }));
    expect(
      await screen.findByText("Két hírlevél között legalább 7 nap."),
    ).toBeTruthy();
    expect(api.saveSettings).toHaveBeenCalledWith("token-1", 7);
    fireEvent.change(
      screen.getByLabelText("Legalább ennyi nap két hírlevél között"),
      { target: { value: "" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Gyakoriság mentése" }));
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenLastCalledWith("token-1", null),
    );
  });

  it("a failed read is an error, not an empty template", async () => {
    api.template.mockRejectedValue(new ApiError("nem olvasható", 503));
    render(<ContentCalendarTemplatePage />);
    expect(await screen.findByText("A sablon nem elérhető")).toBeTruthy();
    expect(
      screen.queryByText(/Ehhez az eseményhez nincs sablon-sor/),
    ).toBeNull();
  });
});
