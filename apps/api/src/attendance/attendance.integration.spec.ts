import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ATTENDANCE_AUDIT_ACTIONS, dateOnly } from "./attendance-records.js";
import {
  AttendanceDayTakenError,
  AttendanceRepository,
} from "./attendance.repository.js";

/*
  ON A REAL POSTGRES. WHAT TURNS THIS RED: a write without its audit row, or an audit row whose "from" is not the value it
  replaced; a resave without a change logged as one; two saves of the same day at once not serialized (the second row's
  "from" must be the first row's "to", or the log loses a value); the CHECK constraints missing (a mark stored with times, a
  WORKED day without them, a weekday 8, a departure before the arrival); two entries for one employee and day; an employee
  with attendance rows deletable (the record must outlive the account); the employee picker listing a partner account or
  leaving out an inactive colleague; a printed copy not kept byte for byte, the older one returned as the latest, a copy
  readable under another employee, or printed without an audit row.
*/
const gate = integrationDatabaseGate(process.env);
const TEST_EMAIL_DOMAIN = "attendance-integration.invalid";

async function removeLeftovers() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  await prisma.auditLog.deleteMany({
    where: { entityType: "User", entityId: { in: ids } },
  });
  await prisma.attendanceDay.deleteMany({ where: { userId: { in: ids } } });
  await prisma.attendanceSignedSheet.deleteMany({
    where: { userId: { in: ids } },
  });
  await prisma.attendanceSchedule.deleteMany({
    where: { userId: { in: ids } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

const auditRows = (userId: string) =>
  prisma.auditLog.findMany({
    where: { entityType: "User", entityId: userId },
    orderBy: { createdAt: "asc" },
    select: { action: true, userId: true, metadata: true },
  });

describe("attendance on Postgres", { skip: gate.mode === "skip" }, () => {
  const repository = new AttendanceRepository();
  const suffix = Date.now() % 1_000_000;
  let employeeId = "";
  let adminId = "";

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    employeeId = (
      await prisma.user.create({
        data: {
          email: `employee-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Jelenlét Teszt",
          role: "SALES",
        },
      })
    ).id;
    adminId = (
      await prisma.user.create({
        data: {
          email: `admin-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Jelenlét Admin",
          role: "ADMIN",
        },
      })
    ).id;
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeLeftovers();
  });

  it("stores a schedule version with its audit row, and a resave logs nothing", async () => {
    const validFrom = dateOnly("2026-11-01");
    const week = [
      { weekday: 1, startMinute: 420, endMinute: 960 },
      { weekday: 2, startMinute: 420, endMinute: 960 },
    ];
    await repository.saveSchedule({
      userId: employeeId,
      validFrom,
      days: week,
      actorId: adminId,
    });
    await repository.saveSchedule({
      userId: employeeId,
      validFrom,
      days: [...week].reverse(),
      actorId: adminId,
    });
    const changed = await repository.saveSchedule({
      userId: employeeId,
      validFrom,
      days: [week[0]!],
      actorId: adminId,
    });
    assert.deepEqual(changed.days, [week[0]]);
    assert.equal(
      await repository.deleteSchedule({
        userId: employeeId,
        validFrom,
        actorId: adminId,
      }),
      true,
    );
    assert.equal(
      await repository.deleteSchedule({
        userId: employeeId,
        validFrom,
        actorId: adminId,
      }),
      false,
    );

    const monTue = [
      { weekday: 1, start: "07:00", end: "16:00" },
      { weekday: 2, start: "07:00", end: "16:00" },
    ];
    const rows = (await auditRows(employeeId)).filter(
      (row) => row.action === ATTENDANCE_AUDIT_ACTIONS.schedule,
    );
    assert.deepEqual(
      rows.map((row) => [row.userId, row.metadata]),
      [
        [adminId, { validFrom: "2026-11-01", from: null, to: monTue }],
        [adminId, { validFrom: "2026-11-01", from: monTue, to: [monTue[0]] }],
        [adminId, { validFrom: "2026-11-01", from: [monTue[0]], to: null }],
      ],
    );
    assert.equal(
      await prisma.attendanceScheduleDay.count({
        where: { schedule: { userId: employeeId } },
      }),
      0,
    );
  });

  it("logs a day's old and new value, and a resave logs nothing", async () => {
    const date = dateOnly("2026-10-05");
    await repository.saveDay({
      userId: employeeId,
      date,
      kind: "WORKED",
      startMinute: 420,
      endMinute: 1080,
      actorId: adminId,
    });
    await repository.saveDay({
      userId: employeeId,
      date,
      kind: "WORKED",
      startMinute: 420,
      endMinute: 1080,
      actorId: adminId,
    });
    await repository.saveDay({
      userId: employeeId,
      date,
      kind: "SICK",
      startMinute: null,
      endMinute: null,
      actorId: adminId,
    });
    assert.equal(
      await repository.deleteDay({
        userId: employeeId,
        date,
        actorId: adminId,
      }),
      true,
    );
    const rows = (await auditRows(employeeId)).filter(
      (row) =>
        row.action === ATTENDANCE_AUDIT_ACTIONS.day &&
        (row.metadata as { date: string }).date === "2026-10-05",
    );
    const worked = { kind: "WORKED", start: "07:00", end: "18:00" };
    const sick = { kind: "SICK", start: null, end: null };
    assert.deepEqual(
      rows.map((row) => row.metadata),
      [
        { date: "2026-10-05", from: null, to: worked },
        { date: "2026-10-05", from: worked, to: sick },
        { date: "2026-10-05", from: sick, to: null },
      ],
    );
  });

  it("serializes two saves of the same day, so the log keeps every value", async () => {
    const date = dateOnly("2026-10-06");
    await Promise.all(
      (["SICK", "LEAVE", "DAY_OFF"] as const).map((kind) =>
        repository.saveDay({
          userId: employeeId,
          date,
          kind,
          startMinute: null,
          endMinute: null,
          actorId: adminId,
        }),
      ),
    );
    const chain = (await auditRows(employeeId))
      .map(
        (row) => row.metadata as { date: string; from: unknown; to: unknown },
      )
      .filter((metadata) => metadata.date === "2026-10-06");
    assert.equal(chain.length, 3);
    assert.equal(chain[0]!.from, null);
    assert.deepEqual(chain[1]!.from, chain[0]!.to);
    assert.deepEqual(chain[2]!.from, chain[1]!.to);
    const stored = await prisma.attendanceDay.findMany({
      where: { userId: employeeId, date },
    });
    assert.equal(stored.length, 1);
    assert.deepEqual(chain[2]!.to, {
      kind: stored[0]!.kind,
      start: null,
      end: null,
    });
  });

  it("refuses at the database what the sheet could not print", async () => {
    const date = dateOnly("2026-10-07");
    for (const data of [
      { kind: "SICK" as const, startMinute: 420, endMinute: 960 },
      { kind: "WORKED" as const, startMinute: 420, endMinute: null },
      { kind: "WORKED" as const, startMinute: 960, endMinute: 420 },
      { kind: "WORKED" as const, startMinute: 420, endMinute: 1440 },
    ])
      await assert.rejects(
        prisma.attendanceDay.create({
          data: { userId: employeeId, date, ...data },
        }),
        /AttendanceDay_times_check|check constraint/i,
        JSON.stringify(data),
      );
    const schedule = await prisma.attendanceSchedule.create({
      data: { userId: employeeId, validFrom: dateOnly("2027-01-01") },
    });
    for (const day of [
      { weekday: 0, startMinute: 420, endMinute: 960 },
      { weekday: 8, startMinute: 420, endMinute: 960 },
      { weekday: 1, startMinute: 960, endMinute: 960 },
    ])
      await assert.rejects(
        prisma.attendanceScheduleDay.create({
          data: { scheduleId: schedule.id, ...day },
        }),
        /AttendanceScheduleDay_range_check|check constraint/i,
        JSON.stringify(day),
      );
    await prisma.attendanceSchedule.delete({ where: { id: schedule.id } });
  });

  it("lists the employees of the given roles, inactive ones too, not a partner account", async () => {
    const partner = await prisma.user.create({
      data: {
        email: `partner-${suffix}@${TEST_EMAIL_DOMAIN}`,
        displayName: "Jelenlét Partner",
        role: "PARTNER_SERVICE",
      },
    });
    const gone = await prisma.user.create({
      data: {
        email: `gone-${suffix}@${TEST_EMAIL_DOMAIN}`,
        displayName: "Jelenlét Régi",
        role: "WAREHOUSE",
        isActive: false,
      },
    });
    const ids = (
      await repository.employees(["OWNER", "ADMIN", "SALES", "WAREHOUSE"])
    ).map((user) => user.id);
    assert.ok(ids.includes(employeeId));
    assert.ok(ids.includes(gone.id));
    assert.ok(!ids.includes(partner.id));
    // active first
    assert.ok(ids.indexOf(employeeId) < ids.indexOf(gone.id));
  });

  it("keeps the printed copy as bytes, the latest first, and only under its own employee", async () => {
    const first = await repository.createSignedSheet({
      userId: employeeId,
      month: "2026-09",
      contentHash: "a".repeat(64),
      pdf: Buffer.from("%PDF-first"),
      printedAt: new Date("2026-09-30T15:00:00.000Z"),
      actorId: adminId,
    });
    const second = await repository.createSignedSheet({
      userId: employeeId,
      month: "2026-09",
      contentHash: "b".repeat(64),
      pdf: Buffer.from("%PDF-second"),
      printedAt: new Date("2026-10-02T08:00:00.000Z"),
      actorId: adminId,
    });
    const latest = await repository.latestSignedSheet(employeeId, "2026-09");
    assert.equal(latest?.id, second.id);
    assert.equal(latest?.contentHash, "b".repeat(64));
    assert.equal(
      Buffer.from(
        (await repository.signedSheetPdf(employeeId, first.id))!.pdf,
      ).toString(),
      "%PDF-first",
    );
    assert.equal(await repository.signedSheetPdf(adminId, first.id), null);
    assert.equal(
      await repository.latestSignedSheet(employeeId, "2026-08"),
      null,
    );
    const logged = (await auditRows(employeeId)).filter(
      (row) => row.action === ATTENDANCE_AUDIT_ACTIONS.printed,
    );
    assert.equal(logged.length, 2);
    assert.equal(logged[0]!.userId, adminId);
  });

  it("does not let an employee's own mark replace or remove an admin's other mark", async () => {
    const date = dateOnly("2026-10-20");
    await repository.saveDay({
      userId: employeeId,
      date,
      kind: "SICK",
      startMinute: null,
      endMinute: null,
      actorId: adminId,
    });
    const before = (await auditRows(employeeId)).length;
    await assert.rejects(
      repository.saveDay({
        userId: employeeId,
        date,
        kind: "LEAVE",
        startMinute: null,
        endMinute: null,
        actorId: employeeId,
        onlyOver: ["LEAVE", "DAY_OFF"],
      }),
      AttendanceDayTakenError,
    );
    await assert.rejects(
      repository.deleteDay({
        userId: employeeId,
        date,
        actorId: employeeId,
        onlyOver: ["LEAVE", "DAY_OFF"],
      }),
      AttendanceDayTakenError,
    );
    const stored = await prisma.attendanceDay.findUnique({
      where: { userId_date: { userId: employeeId, date } },
    });
    assert.equal(stored?.kind, "SICK");
    assert.equal((await auditRows(employeeId)).length, before);
    // over an own mark it goes through
    const own = dateOnly("2026-10-21");
    for (const kind of ["LEAVE", "DAY_OFF"] as const)
      await repository.saveDay({
        userId: employeeId,
        date: own,
        kind,
        startMinute: null,
        endMinute: null,
        actorId: employeeId,
        onlyOver: ["LEAVE", "DAY_OFF"],
      });
    assert.equal(
      (
        await prisma.attendanceDay.findUnique({
          where: { userId_date: { userId: employeeId, date: own } },
        })
      )?.kind,
      "DAY_OFF",
    );
  });

  it("keeps the record when someone tries to delete the employee", async () => {
    await repository.saveDay({
      userId: employeeId,
      date: dateOnly("2026-10-08"),
      kind: "LEAVE",
      startMinute: null,
      endMinute: null,
      actorId: adminId,
    });
    await assert.rejects(prisma.user.delete({ where: { id: employeeId } }));
    assert.ok(await prisma.user.findUnique({ where: { id: employeeId } }));
  });
});
