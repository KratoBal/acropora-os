import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AuthenticatedUser,
  CalendarEvent,
  ContentCalendarEntry,
  ContentCalendarFeed,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { ContentCalendarPage } from "./content-calendar-page";

/*
  THE CONTENT CALENDAR PAGE (T5.5 S3). What turns this red: a failed read shown as an empty calendar (spec 8B); the
  loading state shown as "nothing this week"; a sale without the time of its data (spec 8A); an entry that does not
  lead to its source, or a link to a page the viewer may not open; an event edit that does not send the record's
  updatedAt (a stale form would overwrite a newer one); the new-event button shown to someone who cannot write; a full
  month day that hides its extra entries without saying so; a running sale repeated on every day instead of once in
  the band above the days (acrobot 53185); a multi-day entry repeated on every day of the phone list; opening the slots
  without saying what did not open and why.
*/
const api = vi.hoisted(() => ({
  feed: vi.fn(),
  event: vi.fn(),
  responsibleOptions: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  openSlots: vi.fn(),
  gaps: vi.fn(),
}));
vi.mock("@/lib/api/content-calendar", () => ({ contentCalendarApi: api }));

const auth = vi.hoisted(() => ({
  user: {} as Partial<AuthenticatedUser>,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { token: "token-1", user: auth.user } }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tartalom/naptar",
  useSearchParams: () => new URLSearchParams(),
}));
const query = vi.hoisted(() => ({
  params: new URLSearchParams(),
  update: vi.fn(),
}));
vi.mock("@/lib/navigation/use-url-query", async (original) => ({
  ...(await original<typeof import("@/lib/navigation/use-url-query")>()),
  useUrlQuery: () => ({ params: query.params, update: query.update }),
}));

const MANAGER = { id: "u1", role: "MANAGER" } as AuthenticatedUser;

const feed = (
  entries: ContentCalendarEntry[],
  over: Partial<ContentCalendarFeed> = {},
): ContentCalendarFeed => ({
  queriedAt: "2026-11-15T09:30:00.000Z",
  from: "2026-11-09",
  to: "2026-11-15",
  entries,
  withoutDay: { purchaseOrders: 0 },
  ...over,
});

const HOLIDAY: ContentCalendarEntry = {
  kind: "EVENT",
  key: "event:e1",
  title: "Zárva: leltár",
  startsOn: "2026-11-12",
  endsOn: "2026-11-12",
  eventId: "e1",
  eventKind: "HOLIDAY",
  location: "Mindkét bolt",
  responsible: { id: "u2", name: "Luca" },
};
const SALE: ContentCalendarEntry = {
  kind: "SALE",
  key: "sale:1",
  title: "Akció: Energy 50 ml",
  startsOn: "ismeretlen",
  endsOn: null,
  source: "UNAS tükör",
  openEnded: true,
  products: [{ id: "p1", name: "Energy 50 ml" }],
};
const CONTENT: ContentCalendarEntry = {
  kind: "CONTENT",
  key: "content:c1",
  title: "Új halak a héten",
  startsOn: "2026-11-13",
  endsOn: "2026-11-13",
  contentId: "c1",
  channel: "FACEBOOK_POST",
  state: "DRAFTING",
  scheduledFor: null,
};
const PURCHASE: ContentCalendarEntry = {
  kind: "PURCHASE_ARRIVAL",
  key: "purchase:o1:2026-11-11",
  title: "Beszerzés érkezik: Só",
  startsOn: "2026-11-11",
  endsOn: "2026-11-11",
  purchaseOrderId: "o1",
  products: [{ id: "p2", name: "Só" }],
};

const STORED: CalendarEvent = {
  id: "e1",
  kind: "HOLIDAY",
  title: "Zárva: leltár",
  startsOn: "2026-11-12",
  endsOn: "2026-11-12",
  location: "Mindkét bolt",
  responsible: { id: "u2", name: "Luca" },
  createdAt: "2026-11-15T08:00:00.000Z",
  updatedAt: "2026-11-15T08:10:00.000Z",
};

// no mockReset: with a reset, vitest reports a handled mockRejectedValue as the test's own failure
beforeEach(() => {
  auth.user = MANAGER;
  query.params = new URLSearchParams("nap=2026-11-15");
  query.update.mockClear();
  api.feed.mockClear();
  api.updateEvent.mockClear();
  api.responsibleOptions.mockResolvedValue([{ id: "u2", name: "Luca" }]);
  api.gaps.mockClear();
  api.gaps.mockResolvedValue({
    queriedAt: "2026-11-15T09:30:00.000Z",
    from: "2026-11-15",
    to: "2026-11-28",
    events: [],
    collisions: [],
    newsletter: { minDaysBetween: null, tooClose: [] },
  });
});

describe("ContentCalendarPage", () => {
  it("steps back to the content list with the shared arrow link", async () => {
    api.feed.mockReturnValue(new Promise(() => {}));
    render(<ContentCalendarPage />);
    const back = await screen.findByRole("link", { name: "Tartalom" });
    expect(back.getAttribute("href")).toBe("/tartalom");
  });

  it("the template link is drawn as a small secondary button, and stays a link (Picasso 3.26)", async () => {
    api.feed.mockReturnValue(new Promise(() => {}));
    render(<ContentCalendarPage />);
    const template = await screen.findByRole("link", { name: "Sablon" });
    expect(template.getAttribute("href")).toBe("/tartalom/naptar/sablon");
    expect(template.className).toContain("border-dusk-200");
    expect(template.className).toContain("h-8");
    expect(template.className).not.toContain("underline");
  });

  it("reads the Monday-to-Sunday week of the URL day, and shows the loading state, not an empty calendar, while it waits", async () => {
    api.feed.mockReturnValue(new Promise(() => {}));
    render(<ContentCalendarPage />);
    expect(screen.getByTestId("calendar-loading")).toBeTruthy();
    expect(
      screen.queryByText("Ebben az időszakban nincs bejegyzés"),
    ).toBeNull();
    expect(api.feed).toHaveBeenCalledWith(
      "token-1",
      "2026-11-09",
      "2026-11-15",
      expect.anything(),
    );
  });

  it("a month view reads the whole weeks of the month", async () => {
    query.params = new URLSearchParams("nezet=honap&nap=2026-11-15");
    api.feed.mockResolvedValue(feed([]));
    render(<ContentCalendarPage />);
    await screen.findByText("Ebben az időszakban nincs bejegyzés");
    expect(api.feed).toHaveBeenCalledWith(
      "token-1",
      "2026-10-26",
      "2026-12-06",
      expect.anything(),
    );
  });

  it("an empty range says so", async () => {
    api.feed.mockResolvedValue(feed([]));
    render(<ContentCalendarPage />);
    expect(
      await screen.findByText("Ebben az időszakban nincs bejegyzés"),
    ).toBeTruthy();
  });

  it("a failed read says the data is not available, and is NOT an empty calendar", async () => {
    api.feed.mockRejectedValue(
      new ApiError("A naptár adatai most nem olvashatók.", 503),
    );
    render(<ContentCalendarPage />);
    expect(await screen.findByText("Az adat nem elérhető")).toBeTruthy();
    expect(screen.getByText(/nem üres naptár/)).toBeTruthy();
    expect(
      screen.queryByText("Ebben az időszakban nincs bejegyzés"),
    ).toBeNull();
    expect(screen.queryByTestId("calendar-grid")).toBeNull();
  });

  it("shows each entry with its kind and details, every sale with the time of its data, and links to the sources", async () => {
    api.feed.mockResolvedValue(
      feed([SALE, PURCHASE, HOLIDAY, CONTENT], {
        withoutDay: { purchaseOrders: 2 },
      }),
    );
    render(<ContentCalendarPage />);
    await screen.findAllByText("Zárva: leltár");
    // the list (phone) and the grid (desktop) are both in the DOM; CSS picks one
    expect(screen.getByTestId("calendar-list")).toBeTruthy();
    expect(screen.getByTestId("calendar-grid")).toBeTruthy();
    const sale = screen.getAllByRole("link", { name: "Akció: Energy 50 ml" });
    expect(sale[0]!.getAttribute("href")).toBe("/products/p1");
    expect(
      screen.getAllByText(/az adat ideje: nov\. 15\. 10:30/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/ismeretlen kezdet – nyitott vég/).length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getAllByRole("link", { name: "Új halak a héten" })[0]!
        .getAttribute("href"),
    ).toBe("/tartalom/c1");
    expect(
      screen
        .getAllByRole("link", { name: "Beszerzés érkezik: Só" })[0]!
        .getAttribute("href"),
    ).toBe("/beszerzes/o1");
    expect(screen.getAllByText(/felelős: Luca/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/2 nyitott beszerzési rendelésnek nincs várt napja/),
    ).toBeTruthy();
  });

  it("a sale that runs through the whole week stands once, in the band above the days, and in no day", async () => {
    api.feed.mockResolvedValue(feed([SALE, CONTENT]));
    render(<ContentCalendarPage />);
    await screen.findAllByText("Új halak a héten");
    const links = (id: string) =>
      Array.from(screen.getByTestId(id).querySelectorAll("a")).filter(
        (a) => a.textContent === "Akció: Energy 50 ml",
      );
    expect(links("calendar-throughout")).toHaveLength(1);
    expect(screen.getByText("Az egész héten")).toBeTruthy();
    expect(links("calendar-list")).toHaveLength(0);
    expect(links("calendar-grid")).toHaveLength(0);
  });

  it("a multi-day entry inside the week stands once on the phone list, on its first day, and on each of its days in the grid", async () => {
    const event: ContentCalendarEntry = {
      ...HOLIDAY,
      key: "event:e9",
      eventId: "e9",
      title: "Nyílt napok",
      startsOn: "2026-11-12",
      endsOn: "2026-11-14",
    };
    api.feed.mockResolvedValue(feed([event]));
    render(<ContentCalendarPage />);
    await screen.findAllByText("Nyílt napok");
    const titles = (id: string) =>
      Array.from(screen.getByTestId(id).querySelectorAll("button")).filter(
        (b) => b.textContent === "Nyílt napok",
      );
    expect(titles("calendar-list")).toHaveLength(1);
    expect(titles("calendar-grid")).toHaveLength(3);
    expect(screen.queryByTestId("calendar-throughout")).toBeNull();
  });

  it("no link to a page the viewer may not open, and no new-event button without content.manage", async () => {
    auth.user = {
      id: "u3",
      role: "VIEWER",
      permissions: ["content.view"],
    } as unknown as AuthenticatedUser;
    api.feed.mockResolvedValue(feed([PURCHASE, HOLIDAY]));
    render(<ContentCalendarPage />);
    await screen.findAllByText("Beszerzés érkezik: Só");
    expect(
      screen.queryByRole("link", { name: "Beszerzés érkezik: Só" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Új esemény" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Tartalom-helyek nyitása" }),
    ).toBeNull();
    // the event is not editable either: plain text, no button
    expect(screen.queryByRole("button", { name: "Zárva: leltár" })).toBeNull();
  });

  it("an event opens freshly read, and saving sends that record's updatedAt", async () => {
    api.feed.mockResolvedValue(feed([HOLIDAY]));
    api.event.mockResolvedValue(STORED);
    api.updateEvent.mockResolvedValue(STORED);
    render(<ContentCalendarPage />);
    const [button] = await screen.findAllByRole("button", {
      name: "Zárva: leltár",
    });
    fireEvent.click(button!);
    const title = await screen.findByLabelText("Cím");
    fireEvent.change(title, { target: { value: "Zárva: leltár, délután" } });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalled());
    expect(api.updateEvent).toHaveBeenCalledWith(
      "token-1",
      "e1",
      {
        kind: "HOLIDAY",
        title: "Zárva: leltár, délután",
        startsOn: "2026-11-12",
        endsOn: "2026-11-12",
        location: "Mindkét bolt",
        responsibleUserId: "u2",
      },
      "2026-11-15T08:10:00.000Z",
    );
    // the calendar is read again after the save
    await waitFor(() => expect(api.feed).toHaveBeenCalledTimes(2));
  });

  it("a stale edit is refused with a sentence that says the change was not saved", async () => {
    api.feed.mockResolvedValue(feed([HOLIDAY]));
    api.event.mockResolvedValue(STORED);
    api.updateEvent.mockRejectedValue(new ApiError("ütközés", 409));
    render(<ContentCalendarPage />);
    const [button] = await screen.findAllByRole("button", {
      name: "Zárva: leltár",
    });
    fireEvent.click(button!);
    await screen.findByLabelText("Cím");
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText(/közben valaki módosította/)).toBeTruthy();
  });

  it("opening the slots asks for the week shown, says what opened, what existed and what did not open and why, and reads the calendar again", async () => {
    api.feed.mockResolvedValue(feed([HOLIDAY]));
    api.openSlots.mockResolvedValue({
      from: "2026-11-09",
      to: "2026-11-15",
      opened: [
        {
          contentId: "c9",
          title: "Bejelentés: Akció",
          plannedOn: "2026-11-17",
        },
      ],
      existing: 2,
      skipped: { pastDay: 1, openEnded: 1, unknownDay: 0 },
    });
    render(<ContentCalendarPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Tartalom-helyek nyitása" }),
    );
    expect(await screen.findByText("1 új tartalom-hely nyílt")).toBeTruthy();
    expect(api.openSlots).toHaveBeenCalledWith(
      "token-1",
      "2026-11-09",
      "2026-11-15",
    );
    const summary = screen.getByText(/2 már megvolt/).textContent ?? "";
    expect(summary).toMatch(/1 nem nyílt, mert a napja elmúlt/);
    expect(summary).toMatch(/1 nem nyílt, mert az akció nyitott végű/);
    expect(summary).not.toMatch(/ismeretlen/);
    await waitFor(() => expect(api.feed).toHaveBeenCalledTimes(2));
    // what is missing changed: the gap panel reads again too
    await waitFor(() => expect(api.gaps).toHaveBeenCalledTimes(2));
  });

  it("a full month day names how many more entries it holds", async () => {
    query.params = new URLSearchParams("nezet=honap&nap=2026-11-15");
    const many = [1, 2, 3, 4, 5].map((n): ContentCalendarEntry => ({
      ...CONTENT,
      key: `content:c${n}`,
      contentId: `c${n}`,
      title: `Poszt ${n}`,
    }));
    api.feed.mockResolvedValue(feed(many));
    render(<ContentCalendarPage />);
    expect(await screen.findByText("+2 további")).toBeTruthy();
  });
});
