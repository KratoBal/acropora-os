"use client";

import {
  Alert,
  ConfirmDialog,
  EmptyState,
  PilotButton,
  PilotCard,
  PilotDateField,
  PilotFormField,
  PilotInput,
  Skeleton,
} from "@acropora/ui";
import {
  attendanceWeekProblem,
  hasPermission,
  isAttendanceDate,
  isAttendanceEmployeeRole,
  PERMISSIONS,
  type AttendanceSchedule,
  type AttendanceScheduleDay,
  type UserRole,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { attendanceApi } from "@/lib/api/attendance";
import { budapestDayOf, formatDayHu } from "@/lib/format/date";

/** ISO weekday order, Monday first. */
const WEEKDAYS = [
  { weekday: 1, label: "Hétfő", short: "H" },
  { weekday: 2, label: "Kedd", short: "K" },
  { weekday: 3, label: "Szerda", short: "Sze" },
  { weekday: 4, label: "Csütörtök", short: "Cs" },
  { weekday: 5, label: "Péntek", short: "P" },
  { weekday: 6, label: "Szombat", short: "Szo" },
  { weekday: 7, label: "Vasárnap", short: "V" },
] as const;

interface Row {
  works: boolean;
  start: string;
  end: string;
}

const EMPTY_ROW: Row = { works: false, start: "", end: "" };

/** The grid from a version; without one every day is free (no hours are invented for a new colleague). */
function rowsOf(schedule: AttendanceSchedule | undefined): Row[] {
  return WEEKDAYS.map(({ weekday }) => {
    const day = schedule?.days.find((d) => d.weekday === weekday);
    return day ? { works: true, start: day.start, end: day.end } : EMPTY_ROW;
  });
}

function daysOf(rows: readonly Row[]): AttendanceScheduleDay[] {
  return rows.flatMap((row, index) =>
    row.works
      ? [{ weekday: WEEKDAYS[index]!.weekday, start: row.start, end: row.end }]
      : [],
  );
}

/** "H 07:00-16:00, K 07:00-16:00", or that no day is scheduled. */
function weekSummary(schedule: AttendanceSchedule): string {
  if (!schedule.days.length) return "Nincs beosztott nap";
  return schedule.days
    .map(
      (day) =>
        `${WEEKDAYS.find((w) => w.weekday === day.weekday)?.short ?? day.weekday} ${day.start}-${day.end}`,
    )
    .join(", ");
}

/**
 * THE WEEKLY SCHEDULE OF AN EMPLOYEE (os-jelenleti-iv, S1b). The attendance sheet fills itself from it (S2).
 *
 * GATED ON ITS OWN RIGHT, `attendance.manage`, not on the page's `users.manage`: today both are OWNER and ADMIN, but the two
 * may be granted apart, and someone with only `attendance.manage` must not see a section that then fails.
 *
 * A SAVE STARTS A VERSION ON A DAY, it does not edit "the" schedule: the sheet of a day uses the latest version not after it,
 * so a change from today leaves the earlier months as they were (they may already be signed). Saving on a day that already
 * has a version replaces that version.
 */
export function UserAttendanceSchedule({
  userId,
  role,
  onChange,
}: {
  userId: string;
  role: UserRole;
  /** After a version is saved or removed: the sheet page recomputes its month (S2b). */
  onChange?: () => void;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = session
    ? hasPermission(session.user, PERMISSIONS.ATTENDANCE_MANAGE)
    : false;
  const employee = isAttendanceEmployeeRole(role);

  const [versions, setVersions] = useState<AttendanceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(() => rowsOf(undefined));
  const [validFrom, setValidFrom] = useState(() => budapestDayOf(new Date()));
  const [busy, setBusy] = useState(false);
  const [toRemove, setToRemove] = useState<AttendanceSchedule | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage || !employee) return;
      setLoading(true);
      try {
        const list = await attendanceApi.schedules(token, userId, signal);
        setVersions(list.items);
        setLoadError(null);
        return list.items;
      } catch (cause) {
        // A failed read is not an empty list: "no schedule yet" would invite a save over one that exists.
        if (signal?.aborted) return;
        setLoadError(
          cause instanceof Error
            ? cause.message
            : "A munkarend nem tölthető be.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canManage, employee, token, userId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then((items) => {
      // the grid starts from the newest version, so a change is an edit of what stands, not a retyped week
      if (items) setRows(rowsOf(items[0]));
    });
    return () => controller.abort();
  }, [load]);

  const setRow = (index: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  const save = async () => {
    setActionError(null);
    setSaved(null);
    if (!isAttendanceDate(validFrom)) {
      setActionError("Add meg, melyik naptól érvényes a munkarend.");
      return;
    }
    const days = daysOf(rows);
    const problem = attendanceWeekProblem(days);
    if (problem) {
      setActionError(problem);
      return;
    }
    setBusy(true);
    try {
      await attendanceApi.saveSchedule(token, userId, validFrom, days);
      setSaved(`Mentve, ${formatDayHu(validFrom)} naptól érvényes.`);
      await load();
      onChange?.();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (version: AttendanceSchedule) => {
    setToRemove(null);
    setActionError(null);
    setSaved(null);
    setBusy(true);
    try {
      await attendanceApi.deleteSchedule(token, userId, version.validFrom);
      await load();
      onChange?.();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A törlés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canManage || !employee) return null;

  return (
    <PilotCard className="space-y-4 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Munkarend</h2>
        <p className="text-xs text-dusk-500">
          A jelenléti ív ebből töltődik ki. A mentés a megadott naptól érvényes:
          a korábbi hónapok a régi munkarend szerint maradnak.
        </p>
      </div>

      {loadError ? (
        <Alert
          variant="danger"
          title="Nem tölthető be"
          description={loadError}
        />
      ) : null}
      {actionError ? (
        <Alert
          variant="danger"
          title="Nem sikerült"
          description={actionError}
        />
      ) : null}
      {saved ? <Alert title={saved} /> : null}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : loadError ? null : (
        <>
          <div
            className="grid grid-cols-1 gap-2"
            role="group"
            aria-label="Heti munkarend"
          >
            {WEEKDAYS.map(({ weekday, label }, index) => {
              const row = rows[index]!;
              return (
                <div
                  key={weekday}
                  className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[8rem_auto_minmax(0,1fr)_minmax(0,1fr)]"
                >
                  <span className="text-sm font-medium">{label}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.works}
                      onChange={(event) =>
                        setRow(index, { works: event.target.checked })
                      }
                      aria-label={`${label}: dolgozik`}
                    />
                    Dolgozik
                  </label>
                  <PilotInput
                    type="time"
                    value={row.start}
                    disabled={!row.works}
                    onChange={(value) => setRow(index, { start: value })}
                    aria-label={`${label}: érkezés`}
                  />
                  <PilotInput
                    type="time"
                    value={row.end}
                    disabled={!row.works}
                    onChange={(value) => setRow(index, { end: value })}
                    aria-label={`${label}: távozás`}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <PilotFormField label="Érvényes ettől a naptól" required>
              <PilotDateField
                value={validFrom}
                onChange={setValidFrom}
                aria-label="Érvényes ettől a naptól"
              />
            </PilotFormField>
            <PilotButton disabled={busy} onClick={() => void save()}>
              {busy ? "Mentés…" : "Munkarend mentése"}
            </PilotButton>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-dusk-500">
              Változatok
            </h3>
            {versions.length ? (
              <ul
                className="space-y-1 text-sm"
                aria-label="Munkarend változatok"
              >
                {versions.map((version) => (
                  <li
                    key={version.validFrom}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="font-medium">
                      {formatDayHu(version.validFrom)} naptól
                    </span>
                    <span className="text-dusk-500">
                      {weekSummary(version)}
                    </span>
                    <PilotButton
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setToRemove(version)}
                    >
                      Törlés
                    </PilotButton>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Még nincs munkarend"
                description="Amíg nincs, a jelenléti ív minden napja üres marad."
              />
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={toRemove !== null}
        title="Törlöd ezt a munkarend-változatot?"
        consequence={
          toRemove
            ? `A ${formatDayHu(toRemove.validFrom)} naptól érvényes munkarend törlődik. Attól a naptól az előző változat érvényes, ha van ilyen; ha nincs, a napok üresek maradnak.`
            : ""
        }
        recovery="Ugyanezzel a kezdőnappal újra elmenthető. A törlés a naplóban megmarad."
        confirmLabel="Törlés"
        busy={busy}
        onConfirm={() => {
          if (toRemove !== null) void remove(toRemove);
        }}
        onCancel={() => setToRemove(null)}
      />
    </PilotCard>
  );
}
