import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type AttendanceSchedule,
  type Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserAttendanceSchedule } from "./user-attendance-schedule";

const api = vi.hoisted(() => ({
  schedules: vi.fn(),
  saveSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/attendance", () => ({ attendanceApi: api }));

/*
  WHAT TURNS THIS RED. The section shown without attendance.manage (users.manage alone is not enough), or on a partner or
  machine account; the grid not started from the newest version; a free day sent as a working one, or a working day without
  its times; a bad week sent at all (the shared check must stop it on the screen); the start day not sent; a failed read
  shown as "no schedule yet".
*/
function sessionAs(
  role: Session["user"]["role"],
  permissions?: Session["user"]["permissions"],
): Session {
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
      ...(permissions ? { permissions } : {}),
    },
  };
}

const newest: AttendanceSchedule = {
  validFrom: "2026-11-01",
  days: [
    { weekday: 1, start: "07:00", end: "16:00" },
    { weekday: 2, start: "07:00", end: "16:00" },
  ],
  updatedAt: "2026-11-01T08:00:00.000Z",
};
const older: AttendanceSchedule = {
  validFrom: "2026-01-01",
  days: [{ weekday: 1, start: "08:00", end: "16:00" }],
  updatedAt: "2026-01-01T08:00:00.000Z",
};

describe("UserAttendanceSchedule", () => {
  beforeEach(() => {
    auth.session = sessionAs("OWNER");
    api.schedules
      .mockReset()
      .mockResolvedValue({ userId: "u-1", items: [newest, older] });
    api.saveSchedule.mockReset().mockResolvedValue(newest);
    api.deleteSchedule.mockReset().mockResolvedValue(undefined);
  });

  it("starts the grid from the newest version and lists every version", async () => {
    render(<UserAttendanceSchedule userId="u-1" role="SALES" />);
    expect(await screen.findByText("2026. 11. 01. naptól")).toBeTruthy();
    expect(screen.getByText("2026. 01. 01. naptól")).toBeTruthy();
    expect(screen.getByText("H 07:00-16:00, K 07:00-16:00")).toBeTruthy();
    expect(
      (screen.getByLabelText("Hétfő: dolgozik") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Hétfő: érkezés") as HTMLInputElement).value,
    ).toBe("07:00");
    expect(
      (screen.getByLabelText("Szerda: dolgozik") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByLabelText("Szerda: érkezés") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("sends only the working days, with the start day", async () => {
    render(<UserAttendanceSchedule userId="u-1" role="SALES" />);
    await screen.findByText("2026. 11. 01. naptól");
    fireEvent.click(screen.getByLabelText("Kedd: dolgozik"));
    fireEvent.click(screen.getByLabelText("Szombat: dolgozik"));
    fireEvent.change(screen.getByLabelText("Szombat: érkezés"), {
      target: { value: "09:00" },
    });
    fireEvent.change(screen.getByLabelText("Szombat: távozás"), {
      target: { value: "13:00" },
    });
    fireEvent.click(screen.getByText("Munkarend mentése"));
    await waitFor(() => expect(api.saveSchedule).toHaveBeenCalledTimes(1));
    const [token, userId, validFrom, days] = api.saveSchedule.mock.calls[0]!;
    expect([token, userId]).toEqual(["token-1", "u-1"]);
    expect(validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(days).toEqual([
      { weekday: 1, start: "07:00", end: "16:00" },
      { weekday: 6, start: "09:00", end: "13:00" },
    ]);
  });

  it("stops a working day without its times on the screen", async () => {
    render(<UserAttendanceSchedule userId="u-1" role="SALES" />);
    await screen.findByText("2026. 11. 01. naptól");
    fireEvent.click(screen.getByLabelText("Péntek: dolgozik"));
    fireEvent.click(screen.getByText("Munkarend mentése"));
    expect(await screen.findByText(/nem érvényes időpont/)).toBeTruthy();
    expect(api.saveSchedule).not.toHaveBeenCalled();
  });

  it("asks before removing a version, then removes it by its start day", async () => {
    render(<UserAttendanceSchedule userId="u-1" role="SALES" />);
    await screen.findByText("2026. 11. 01. naptól");
    fireEvent.click(screen.getAllByText("Törlés")[1]!);
    expect(
      await screen.findByText("Törlöd ezt a munkarend-változatot?"),
    ).toBeTruthy();
    expect(api.deleteSchedule).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", { name: "Törlés" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(api.deleteSchedule).toHaveBeenCalledWith(
        "token-1",
        "u-1",
        "2026-01-01",
      ),
    );
  });

  it("shows a failed read as an error, not as an empty schedule", async () => {
    api.schedules.mockReset().mockRejectedValue(new Error("Hálózati hiba"));
    render(<UserAttendanceSchedule userId="u-1" role="SALES" />);
    expect(await screen.findByText("Hálózati hiba")).toBeTruthy();
    expect(screen.queryByText("Még nincs munkarend")).toBeNull();
    expect(screen.queryByText("Munkarend mentése")).toBeNull();
  });

  it("stays hidden without attendance.manage, and on a partner or machine account", async () => {
    auth.session = sessionAs("MANAGER");
    const { container, rerender } = render(
      <UserAttendanceSchedule userId="u-1" role="SALES" />,
    );
    expect(container.textContent).toBe("");

    // granted one by one, it shows
    auth.session = sessionAs("MANAGER", [
      ...ROLE_PERMISSIONS.MANAGER,
      PERMISSIONS.ATTENDANCE_MANAGE,
    ]);
    rerender(<UserAttendanceSchedule userId="u-2" role="SALES" />);
    expect(await screen.findByText("Munkarend")).toBeTruthy();

    auth.session = sessionAs("OWNER");
    for (const role of ["PARTNER_SERVICE", "CONTENT_AGENT"] as const) {
      rerender(<UserAttendanceSchedule userId="u-3" role={role} />);
      expect(container.textContent).toBe("");
    }
    expect(api.schedules).not.toHaveBeenCalledWith(
      "token-1",
      "u-3",
      expect.anything(),
    );
  });
});
