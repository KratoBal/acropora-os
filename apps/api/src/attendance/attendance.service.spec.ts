import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { UserRole } from "@acropora/types";

import {
  dateOnly,
  type DayRow,
  type ScheduleRow,
} from "./attendance-records.js";
import type { AttendanceRepository } from "./attendance.repository.js";
import {
  ATTENDANCE_NOT_AN_EMPLOYEE,
  AttendanceService,
} from "./attendance.service.js";

/*
  WHAT TURNS THIS RED. A partner or machine account given a sheet, or an unknown user answered with anything but 404; a bad
  date, a bad week or a bad day entry reaching the store (the 400 must come before any write); times stored as anything but
  minutes, or stored on a mark; the week not Monday first; the actor not passed as the author; a removal of nothing answered
  as a success; a day range backwards or longer than a year read at all; past dates refused (they are writable on purpose).
*/
const updatedAt = new Date("2026-11-13T09:00:00.000Z");

function build(role: UserRole | null = "SALES") {
  const writes: unknown[] = [];
  const repository: Partial<AttendanceRepository> = {
    employee: async (id) => (role ? { id, role } : null),
    schedules: async () => [],
    days: async (_userId, from, to) => {
      writes.push({ read: [from.toISOString(), to.toISOString()] });
      return [];
    },
    saveSchedule: async (input) => {
      writes.push({ saveSchedule: input });
      return {
        validFrom: input.validFrom,
        updatedAt,
        days: input.days,
      } satisfies ScheduleRow;
    },
    deleteSchedule: async (input) => {
      writes.push({ deleteSchedule: input });
      return input.validFrom.getTime() === dateOnly("2026-11-01").getTime();
    },
    saveDay: async (input) => {
      writes.push({ saveDay: input });
      return {
        date: input.date,
        kind: input.kind,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        updatedAt,
      } satisfies DayRow;
    },
    deleteDay: async (input) => {
      writes.push({ deleteDay: input });
      return input.date.getTime() === dateOnly("2026-11-13").getTime();
    },
  };
  return {
    service: new AttendanceService(repository as AttendanceRepository),
    writes,
  };
}

describe("AttendanceService: whose sheet", () => {
  it("answers 404 for an unknown user and 400 for a partner or machine account", async () => {
    await assert.rejects(build(null).service.schedules("x"), NotFoundException);
    for (const role of [
      "PARTNER_SERVICE",
      "CONTENT_AGENT",
      "ASSISTANT",
    ] as const) {
      const { service, writes } = build(role);
      await assert.rejects(
        service.saveDay("p-1", "2026-11-13", { kind: "SICK" }, "admin"),
        (error: unknown) =>
          error instanceof BadRequestException &&
          error.message === ATTENDANCE_NOT_AN_EMPLOYEE,
        role,
      );
      assert.deepEqual(writes, [], role);
    }
  });
});

describe("AttendanceService: the weekly schedule", () => {
  it("stores minutes, Monday first, with the actor", async () => {
    const { service, writes } = build();
    const saved = await service.saveSchedule(
      "u-1",
      "2026-11-01",
      [
        { weekday: 6, start: "09:00", end: "13:00" },
        { weekday: 1, start: "07:00", end: "16:00" },
      ],
      "admin-1",
    );
    assert.deepEqual(writes, [
      {
        saveSchedule: {
          userId: "u-1",
          validFrom: dateOnly("2026-11-01"),
          days: [
            { weekday: 1, startMinute: 420, endMinute: 960 },
            { weekday: 6, startMinute: 540, endMinute: 780 },
          ],
          actorId: "admin-1",
        },
      },
    ]);
    assert.deepEqual(saved, {
      validFrom: "2026-11-01",
      days: [
        { weekday: 1, start: "07:00", end: "16:00" },
        { weekday: 6, start: "09:00", end: "13:00" },
      ],
      updatedAt: updatedAt.toISOString(),
    });
  });

  it("refuses a bad date or week before writing", async () => {
    const { service, writes } = build();
    await assert.rejects(
      service.saveSchedule("u-1", "2026-02-30", [], "a"),
      /kezdőnap nem érvényes dátum/,
    );
    await assert.rejects(
      service.saveSchedule(
        "u-1",
        "2026-11-01",
        [{ weekday: 1, start: "16:00", end: "07:00" }],
        "a",
      ),
      BadRequestException,
    );
    await assert.rejects(
      service.saveSchedule(
        "u-1",
        "2026-11-01",
        [
          { weekday: 2, start: "07:00", end: "16:00" },
          { weekday: 2, start: "07:00", end: "16:00" },
        ],
        "a",
      ),
      /kétszer/,
    );
    assert.deepEqual(writes, []);
  });

  it("removes a version, and says so when there was none", async () => {
    const { service } = build();
    await service.deleteSchedule("u-1", "2026-11-01", "a");
    await assert.rejects(
      service.deleteSchedule("u-1", "2026-12-01", "a"),
      NotFoundException,
    );
  });
});

describe("AttendanceService: a day entry", () => {
  it("stores the times of a WORKED day as minutes, and none on a mark", async () => {
    const { service, writes } = build();
    const worked = await service.saveDay(
      "u-1",
      "2026-11-13",
      { kind: "WORKED", start: "07:00", end: "18:30" },
      "admin-1",
    );
    // a past date is writable on purpose (the accountant books leave later)
    const sick = await service.saveDay(
      "u-1",
      "2025-01-02",
      { kind: "SICK", start: null, end: null },
      "admin-1",
    );
    assert.deepEqual(writes, [
      {
        saveDay: {
          userId: "u-1",
          date: dateOnly("2026-11-13"),
          kind: "WORKED",
          startMinute: 420,
          endMinute: 1110,
          actorId: "admin-1",
        },
      },
      {
        saveDay: {
          userId: "u-1",
          date: dateOnly("2025-01-02"),
          kind: "SICK",
          startMinute: null,
          endMinute: null,
          actorId: "admin-1",
        },
      },
    ]);
    assert.equal(worked.end, "18:30");
    assert.equal(sick.start, null);
  });

  it("refuses a mark with times, a WORKED day without them, or a bad date, before writing", async () => {
    const { service, writes } = build();
    await assert.rejects(
      service.saveDay(
        "u-1",
        "2026-11-13",
        { kind: "LEAVE", start: "07:00", end: "16:00" },
        "a",
      ),
      /nem tartozik időpont/,
    );
    await assert.rejects(
      service.saveDay(
        "u-1",
        "2026-11-13",
        { kind: "WORKED", start: "07:00" },
        "a",
      ),
      /érkezést és a távozást/,
    );
    await assert.rejects(
      service.saveDay("u-1", "2026-11-31", { kind: "SICK" }, "a"),
      /nap nem érvényes dátum/,
    );
    assert.deepEqual(writes, []);
  });

  it("removes an entry, and says so when there was none", async () => {
    const { service } = build();
    await service.deleteDay("u-1", "2026-11-13", "a");
    await assert.rejects(
      service.deleteDay("u-1", "2026-11-14", "a"),
      NotFoundException,
    );
  });

  it("reads a range forward and at most a year long", async () => {
    const { service, writes } = build();
    await service.days("u-1", "2026-11-01", "2026-11-30");
    await service.days("u-1", "2025-01-01", "2025-12-31");
    await assert.rejects(
      service.days("u-1", "2026-11-30", "2026-11-01"),
      /előtt/,
    );
    await assert.rejects(
      service.days("u-1", "2024-01-01", "2025-01-01"),
      /legfeljebb 366/,
    );
    assert.deepEqual(writes, [
      { read: ["2026-11-01T00:00:00.000Z", "2026-11-30T00:00:00.000Z"] },
      { read: ["2025-01-01T00:00:00.000Z", "2025-12-31T00:00:00.000Z"] },
    ]);
  });
});

describe("AttendanceService: the month's sheet", () => {
  it("reads the whole month and computes it from the versions and the entries", async () => {
    const reads: string[][] = [];
    const repository: Partial<AttendanceRepository> = {
      employee: async (id) => ({ id, role: "SALES" }),
      schedules: async () => [
        {
          validFrom: dateOnly("2028-01-01"),
          updatedAt,
          days: [{ weekday: 2, startMinute: 420, endMinute: 960 }],
        },
      ],
      days: async (_userId, from, to) => {
        reads.push([from.toISOString(), to.toISOString()]);
        return [
          {
            date: dateOnly("2028-02-08"),
            kind: "SICK",
            startMinute: null,
            endMinute: null,
            updatedAt,
          },
        ];
      },
    };
    const sheet = await new AttendanceService(
      repository as AttendanceRepository,
    ).sheet("u-1", "2028-02");
    assert.deepEqual(reads, [
      ["2028-02-01T00:00:00.000Z", "2028-02-29T00:00:00.000Z"],
    ]);
    assert.equal(sheet.userId, "u-1");
    assert.equal(sheet.rows.length, 29);
    // Tuesdays of February 2028: the 1st, 15th, 22nd and 29th work; the 8th is sick
    assert.equal(sheet.rows.find((r) => r.date === "2028-02-08")!.mark, "B");
    assert.equal(sheet.totalMinutes, 4 * 540);
    assert.equal(sheet.swapsDecree, null);
  });

  it("refuses a bad month before reading", async () => {
    const { service, writes } = build();
    await assert.rejects(service.sheet("u-1", "2026-13"), /hónap/);
    await assert.rejects(service.sheet("u-1", "2026-1"), /hónap/);
    assert.deepEqual(writes, []);
  });
});

describe("AttendanceService: the employee picker", () => {
  it("asks for the roles that have a sheet, not partner or machine accounts", async () => {
    const asked: unknown[] = [];
    const repository: Partial<AttendanceRepository> = {
      employees: async (roles) => {
        asked.push([...roles]);
        return [];
      },
    };
    await new AttendanceService(repository as AttendanceRepository).employees();
    assert.deepEqual(asked, [
      ["OWNER", "ADMIN", "MANAGER", "SALES", "WAREHOUSE", "SERVICE", "VIEWER"],
    ]);
  });
});
