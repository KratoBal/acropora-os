import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  attendanceSheet,
  type AttendanceDayEntry,
  type AttendanceSheetResponse,
  type Session,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OwnAttendancePage } from "./own-attendance-page";

const api = vi.hoisted(() => ({
  mySheet: vi.fn(),
  markOwnDay: vi.fn(),
  clearOwnDay: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/attendance", () => ({ attendanceApi: api }));

/*
  WHAT TURNS THIS RED. A partner or machine account offered a sheet; the month not asked for the signed-in user (the client
  sends no user id at all); a day offered for editing that is today, in the past, or carries an admin's other mark (sick,
  other times); a mark sent as anything but leave or day off; an own mark removed without a confirmation.
*/
function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u-1",
      email: "anna@acropora.local",
      displayName: "Kovács Anna",
      nickname: null,
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

const schedule = {
  validFrom: "2026-10-01",
  days: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    start: "07:00",
    end: "16:00",
  })),
  updatedAt: "2026-10-01T08:00:00.000Z",
};
const entry = (
  date: string,
  kind: AttendanceDayEntry["kind"],
  start: string | null = null,
  end: string | null = null,
): AttendanceDayEntry => ({
  date,
  kind,
  start,
  end,
  updatedAt: "2026-11-13T09:00:00.000Z",
});
const sheetFor = (month: string): AttendanceSheetResponse => ({
  userId: "u-1",
  ...attendanceSheet({
    now: new Date("2026-11-13T09:00:00.000Z"),
    month,
    schedules: [schedule],
    entries: [
      entry("2026-11-17", "SICK"),
      entry("2026-11-18", "WORKED", "07:00", "18:00"),
      { ...entry("2026-11-19", "LEAVE"), setByEmployee: true },
      // an admin's booked leave: shown, not offered to change (barracuda on #2516)
      { ...entry("2026-11-24", "LEAVE"), setByEmployee: false },
    ],
  }),
  signedCopy: null,
});

describe("OwnAttendancePage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 13 November 2026, 10:00 in Budapest
    vi.setSystemTime(new Date("2026-11-13T09:00:00.000Z"));
    auth.session = sessionAs("SALES");
    api.mySheet
      .mockReset()
      .mockImplementation(async (_t: string, month: string) => sheetFor(month));
    api.markOwnDay.mockReset().mockResolvedValue({});
    api.clearOwnDay.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("shows the own month, and offers only future days without an admin's other mark", async () => {
    render(<OwnAttendancePage />);
    await screen.findByRole("table", { name: "Jelenléti ív" });
    expect(api.mySheet).toHaveBeenCalledWith(
      "token-1",
      "2026-11",
      expect.anything(),
    );
    for (const day of ["13", "12", "17", "18", "24"])
      expect(
        screen.queryByLabelText(`2026. 11. ${day}. módosítása`),
        day,
      ).toBeNull();
    for (const day of ["14", "16", "19", "30"])
      expect(
        screen.getByLabelText(`2026. 11. ${day}. módosítása`),
      ).toBeTruthy();
  });

  it("marks a day off, and only leave or a day off", async () => {
    render(<OwnAttendancePage />);
    fireEvent.click(await screen.findByLabelText("2026. 11. 16. módosítása"));
    expect(screen.queryByLabelText("Betegség (B)")).toBeNull();
    fireEvent.click(screen.getByLabelText("Szabadnap"));
    fireEvent.click(screen.getByText("Mentés"));
    await waitFor(() =>
      expect(api.markOwnDay).toHaveBeenCalledWith(
        "token-1",
        "2026-11-16",
        "DAY_OFF",
      ),
    );
  });

  it("asks before removing an own mark", async () => {
    render(<OwnAttendancePage />);
    fireEvent.click(await screen.findByLabelText("2026. 11. 19. módosítása"));
    fireEvent.click(screen.getByLabelText("Nincs jelölés"));
    fireEvent.click(screen.getByText("Mentés"));
    expect(await screen.findByText("Törlöd a jelölésedet?")).toBeTruthy();
    expect(api.clearOwnDay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Törlés"));
    await waitFor(() =>
      expect(api.clearOwnDay).toHaveBeenCalledWith("token-1", "2026-11-19"),
    );
  });

  it("says so to an account without a sheet, and asks nothing", async () => {
    auth.session = sessionAs("PARTNER_SERVICE");
    render(<OwnAttendancePage />);
    expect(
      await screen.findByText("Ehhez a fiókhoz nem tartozik jelenléti ív"),
    ).toBeTruthy();
    expect(api.mySheet).not.toHaveBeenCalled();
  });

  it("keeps the sheet's sideways scroll inside its card on a phone", async () => {
    render(<OwnAttendancePage />);
    const table = await screen.findByRole("table", { name: "Jelenléti ív" });
    // the scroll box is positioned, so the header's sr-only label cannot widen the page (stage, 390 px)
    expect(table.parentElement?.className).toContain("relative");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });

  it("shows the employee's own advance leave as planned, and no times on later days", async () => {
    render(<OwnAttendancePage />);
    const table = await screen.findByRole("table", { name: "Jelenléti ív" });
    const planned = within(table)
      .getByText(/2026\. 11\. 19\./)
      .closest("tr")!;
    expect(within(planned).getByText("Tervezett: Szabadság")).toBeTruthy();
    expect(within(planned).queryByText("SZ")).toBeNull();
    const monday = within(table)
      .getByText(/2026\. 11\. 16\./)
      .closest("tr")!;
    expect(within(monday).queryByText("07:00")).toBeNull();
  });
});
