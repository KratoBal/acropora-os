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
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listedSelect } from "@/test/listed-option";
import { pickMonth } from "@/test/month-field";

import { AttendanceSheetPage } from "./attendance-sheet-page";
import { formatAttendanceHours } from "./attendance-sheet-table";

const api = vi.hoisted(() => ({
  employees: vi.fn(),
  sheet: vi.fn(),
  saveDay: vi.fn(),
  deleteDay: vi.fn(),
  sheetPdf: vi.fn(),
  days: vi.fn(),
  printForSignature: vi.fn(),
  signedSheetPdf: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/attendance", () => ({ attendanceApi: api }));
vi.mock("@/components/users/user-attendance-schedule", () => ({
  UserAttendanceSchedule: ({ userId }: { userId: string }) => (
    <div>Munkarend: {userId}</div>
  ),
}));

/*
  WHAT TURNS THIS RED. The page opening without attendance.manage, or asking the API anyway; the sheet not asked for the
  chosen employee and month; a mark not printed in place of the times ("B", "SZ"); the hours not as h:mm or the total
  wrong; a year without its decree shown as an ordinary year; a day mark not sent as the API's input, or a WORKED day
  without times sent at all; going back to the schedule not removing the entry; leave on a non-working day not flagged.
*/
function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "admin-1",
      email: "owner@acropora.local",
      displayName: "Tulaj Tibor",
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

/** A clock after the months these tests show: complete months (the "as of now" rule has its own test below). */
const LATER = new Date("2030-01-01T12:00:00.000Z");

function sheetFor(
  month: string,
  entries: AttendanceDayEntry[],
  signedCopy: AttendanceSheetResponse["signedCopy"] = null,
): AttendanceSheetResponse {
  return {
    userId: "u-1",
    ...attendanceSheet({ month, schedules: [schedule], entries, now: LATER }),
    signedCopy,
  };
}

async function openSheet() {
  render(<AttendanceSheetPage />);
  fireEvent.change(await listedSelect("Munkatárs", "u-1"), {
    target: { value: "u-1" },
  });
  pickMonth("Hónap", "2026-11");
  return screen.findByRole("table", { name: "Jelenléti ív" });
}

describe("AttendanceSheetPage", () => {
  beforeEach(() => {
    auth.session = sessionAs("OWNER");
    api.employees.mockReset().mockResolvedValue({
      items: [
        {
          id: "u-1",
          displayName: "Kovács Anna",
          nickname: null,
          role: "SALES",
          isActive: true,
        },
        {
          id: "u-2",
          displayName: "Régi Béla",
          nickname: null,
          role: "SALES",
          isActive: false,
        },
      ],
    });
    api.sheet
      .mockReset()
      .mockImplementation(async (_t: string, _u: string, month: string) =>
        sheetFor(month, [
          entry("2026-11-13", "SICK"),
          entry("2026-11-20", "LEAVE"),
        ]),
      );
    api.saveDay.mockReset().mockResolvedValue({});
    api.deleteDay.mockReset().mockResolvedValue(undefined);
  });

  it("formats minutes as hours and minutes", () => {
    expect(formatAttendanceHours(540)).toBe("9:00");
    expect(formatAttendanceHours(510)).toBe("8:30");
    expect(formatAttendanceHours(10500)).toBe("175:00");
  });

  it("stays closed without attendance.manage, and asks the API nothing", async () => {
    auth.session = sessionAs("MANAGER");
    render(<AttendanceSheetPage />);
    expect(await screen.findByText("Nincs jogosultságod")).toBeTruthy();
    expect(api.employees).not.toHaveBeenCalled();
    expect(api.sheet).not.toHaveBeenCalled();
  });

  it("shows the chosen employee's month, marks in place of the times, and the totals", async () => {
    const table = await openSheet();
    await waitFor(() =>
      expect(api.sheet).toHaveBeenLastCalledWith(
        "token-1",
        "u-1",
        "2026-11",
        expect.anything(),
      ),
    );
    expect(screen.getByText("Régi Béla (inaktív)")).toBeTruthy();
    const sick = within(table)
      .getByText(/2026\. 11\. 13\./)
      .closest("tr")!;
    expect(within(sick).getAllByText("B")).toHaveLength(2);
    const monday = within(table)
      .getByText(/2026\. 11\. 02\./)
      .closest("tr")!;
    expect(within(monday).getByText("07:00")).toBeTruthy();
    expect(within(monday).getByText("9:00")).toBeTruthy();
    const holiday = within(table)
      .getByText(/2026\. 11\. 01\./)
      .closest("tr")!;
    expect(within(holiday).getByText("Mindenszentek")).toBeTruthy();
    const total = screen.getByLabelText("Összesítés");
    expect(total.textContent).toContain(formatAttendanceHours(19 * 540));
    expect(total.textContent).toContain("Betegség: 1 nap");
    expect(total.textContent).toContain("Szabadság: 1 nap");
    expect(
      screen.queryByText(/áthelyezett munkanapok erre az évre/),
    ).toBeNull();
    expect(screen.getByText("Munkarend: u-1")).toBeTruthy();
  });

  it("says when the year's swapped days are not known", async () => {
    await openSheet();
    pickMonth("Hónap", "2027-02");
    expect(
      await screen.findByText(/áthelyezett munkanapok erre az évre/),
    ).toBeTruthy();
  });

  it("marks a day sick, and reloads the month", async () => {
    await openSheet();
    fireEvent.click(screen.getByLabelText("2026. 11. 16. módosítása"));
    fireEvent.click(screen.getByLabelText("Betegség (B)"));
    fireEvent.click(screen.getByText("Mentés"));
    await waitFor(() =>
      expect(api.saveDay).toHaveBeenCalledWith("token-1", "u-1", "2026-11-16", {
        kind: "SICK",
      }),
    );
    await waitFor(() =>
      expect(api.sheet.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("sends other times, and stops a WORKED day without them", async () => {
    await openSheet();
    fireEvent.click(screen.getByLabelText("2026. 11. 17. módosítása"));
    fireEvent.click(screen.getByLabelText("Eltérő munkaidő"));
    fireEvent.click(screen.getByText("Mentés"));
    expect(
      await screen.findByText(/nem érvényes időpont|érkezést és a távozást/),
    ).toBeTruthy();
    expect(api.saveDay).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Érkezés"), {
      target: { value: "07:00" },
    });
    fireEvent.change(screen.getByLabelText("Távozás"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByText("Mentés"));
    await waitFor(() =>
      expect(api.saveDay).toHaveBeenCalledWith("token-1", "u-1", "2026-11-17", {
        kind: "WORKED",
        start: "07:00",
        end: "18:00",
      }),
    );
  });

  it("asks, then removes the entry when the day goes back to the schedule", async () => {
    await openSheet();
    fireEvent.click(screen.getByLabelText("2026. 11. 13. módosítása"));
    fireEvent.click(screen.getByLabelText("Munkarend szerint"));
    fireEvent.click(screen.getByText("Mentés"));
    expect(
      await screen.findByText("Visszaállítod a napot a munkarendre?"),
    ).toBeTruthy();
    expect(api.deleteDay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Visszaállítás"));
    await waitFor(() =>
      expect(api.deleteDay).toHaveBeenCalledWith(
        "token-1",
        "u-1",
        "2026-11-13",
      ),
    );
    expect(api.saveDay).not.toHaveBeenCalled();
  });

  it("flags leave on a day that is not a working day", async () => {
    await openSheet();
    fireEvent.click(screen.getByLabelText("2026. 11. 14. módosítása"));
    fireEvent.click(screen.getByLabelText("Szabadság (SZ)"));
    expect(screen.getByText(/nem munkanap \(pihenőnap\)/)).toBeTruthy();
  });

  it("never leaves the previous employee's sheet editable while the next one loads", async () => {
    let release: (sheet: AttendanceSheetResponse) => void = () => {};
    api.sheet
      .mockReset()
      .mockImplementation(async (_t: string, userId: string, month: string) =>
        userId === "u-1"
          ? sheetFor(month, [entry("2026-11-13", "SICK")])
          : new Promise<AttendanceSheetResponse>((resolve) => {
              release = resolve;
            }),
      );
    await openSheet();
    expect(screen.getByLabelText("2026. 11. 13. módosítása")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Munkatárs"), {
      target: { value: "u-2" },
    });
    // the first sheet is gone the moment the choice changes, not when the second arrives
    expect(screen.queryByRole("table", { name: "Jelenléti ív" })).toBeNull();
    expect(screen.queryByLabelText("2026. 11. 13. módosítása")).toBeNull();

    release({ ...sheetFor("2026-11", []), userId: "u-2" });
    fireEvent.click(await screen.findByLabelText("2026. 11. 13. módosítása"));
    fireEvent.click(screen.getByLabelText("Szabadság (SZ)"));
    fireEvent.click(screen.getByText("Mentés"));
    await waitFor(() =>
      expect(api.saveDay).toHaveBeenCalledWith("token-1", "u-2", "2026-11-13", {
        kind: "LEAVE",
      }),
    );
  });

  it("opens the month's PDF in a new tab, and says so when the browser blocks it", async () => {
    api.sheetPdf.mockReset().mockResolvedValue(new Blob(["%PDF-"]));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const createObjectURL = vi.fn(() => "blob:sheet");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    await openSheet();
    fireEvent.click(screen.getByText("PDF megtekintése"));
    await waitFor(() =>
      expect(api.sheetPdf).toHaveBeenCalledWith("token-1", "u-1", "2026-11"),
    );
    // the tab is opened in the click, before the PDF arrives (Safari)
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(
      await screen.findByText(/nem engedte megnyitni a PDF-et/),
    ).toBeTruthy();
    open.mockRestore();
  });

  it("prints for signature, then shows the kept copy", async () => {
    api.printForSignature.mockReset().mockResolvedValue(new Blob(["%PDF-"]));
    const tab = { location: { href: "" }, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(tab as unknown as Window);
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:signed"),
      revokeObjectURL: vi.fn(),
    });
    await openSheet();
    api.sheet.mockImplementation(
      async (_t: string, _u: string, month: string) =>
        sheetFor(month, [], {
          id: "copy-1",
          printedAt: "2026-11-30T15:00:00.000Z",
          differs: false,
        }),
    );
    fireEvent.click(screen.getByText("Nyomtatás aláírásra"));
    await waitFor(() =>
      expect(api.printForSignature).toHaveBeenCalledWith(
        "token-1",
        "u-1",
        "2026-11",
      ),
    );
    expect(
      await screen.findByText(
        /Aláírásra nyomtatva: 2026\. 11\. 30\. 16:00, azóta változatlan/,
      ),
    ).toBeTruthy();
    api.signedSheetPdf.mockReset().mockResolvedValue(new Blob(["%PDF-"]));
    fireEvent.click(screen.getByText("Nyomtatott példány"));
    await waitFor(() =>
      expect(api.signedSheetPdf).toHaveBeenCalledWith(
        "token-1",
        "u-1",
        "copy-1",
      ),
    );
    await waitFor(() => expect(tab.location.href).toBe("blob:signed"));
    open.mockRestore();
  });

  it("flags a month that changed since it was printed for signature", async () => {
    api.sheet
      .mockReset()
      .mockImplementation(async (_t: string, _u: string, month: string) =>
        sheetFor(month, [], {
          id: "copy-1",
          printedAt: "2026-11-30T15:00:00.000Z",
          differs: true,
        }),
      );
    await openSheet();
    expect(
      screen.getByText(
        "Az aláírásra nyomtatott példány óta a hónap megváltozott",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Új nyomtatás és aláírás kell/)).toBeTruthy();
    expect(screen.getByText("Nyomtatott példány")).toBeTruthy();
  });

  it("shows the month up to now: today's arrival before the departure, later days empty (Balázs, 2026-11-13)", async () => {
    api.sheet
      .mockReset()
      .mockImplementation(async (_t: string, _u: string, month: string) => ({
        userId: "u-1",
        ...attendanceSheet({
          month,
          schedules: [schedule],
          entries: [entry("2026-11-20", "LEAVE")],
          now: new Date("2026-11-13T10:00:00.000Z"),
        }),
        signedCopy: null,
      }));
    const table = await openSheet();
    const today = within(table)
      .getByText(/2026\. 11\. 13\./)
      .closest("tr")!;
    expect(within(today).getByText("07:00")).toBeTruthy();
    expect(within(today).queryByText("16:00")).toBeNull();
    expect(within(today).queryByText("9:00")).toBeNull();
    const later = within(table)
      .getByText(/2026\. 11\. 20\./)
      .closest("tr")!;
    expect(within(later).queryByText("SZ")).toBeNull();
    // the office sees the advance leave as planned: no time, no mark, not in the total (barracuda on #2520)
    expect(within(later).getByText("Tervezett: Szabadság")).toBeTruthy();
    const total = screen.getByLabelText("Összesítés");
    expect(total.textContent).toContain(formatAttendanceHours(9 * 540));
    expect(total.textContent).toContain("Szabadság: 0 nap");
  });

  it("opens a stored 'other times' day that the sheet cuts with its stored times", async () => {
    api.sheet
      .mockReset()
      .mockImplementation(async (_t: string, _u: string, month: string) => ({
        userId: "u-1",
        ...attendanceSheet({
          month,
          schedules: [schedule],
          entries: [entry("2026-11-18", "WORKED", "07:00", "18:00")],
          now: new Date("2026-11-13T10:00:00.000Z"),
        }),
        signedCopy: null,
      }));
    api.days.mockReset().mockResolvedValue({
      userId: "u-1",
      from: "2026-11-18",
      to: "2026-11-18",
      items: [entry("2026-11-18", "WORKED", "07:00", "18:00")],
    });
    await openSheet();
    fireEvent.click(screen.getByLabelText("2026. 11. 18. módosítása"));
    // the time fields wait for the stored times (barracuda on #2520)
    expect(
      (screen.getByLabelText("Távozás") as HTMLInputElement).disabled,
    ).toBe(true);
    await waitFor(() =>
      expect((screen.getByLabelText("Távozás") as HTMLInputElement).value).toBe(
        "18:00",
      ),
    );
    expect((screen.getByLabelText("Érkezés") as HTMLInputElement).value).toBe(
      "07:00",
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Távozás") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    expect(api.days).toHaveBeenCalledWith(
      "token-1",
      "u-1",
      "2026-11-18",
      "2026-11-18",
      expect.anything(),
    );
  });
});
