"use client";

import {
  Alert,
  ConfirmDialog,
  EmptyState,
  PilotButton,
  PilotCard,
  PilotDialog,
  PilotFormField,
  PilotInput,
  PilotMonthField,
  PilotPageHeader,
  PilotRadioGroup,
  PilotSelect,
  Skeleton,
} from "@acropora/ui";
import {
  attendanceDayProblem,
  hasPermission,
  PERMISSIONS,
  type AttendanceDayKind,
  type AttendanceEmployee,
  type AttendanceSheetResponse,
  type AttendanceSheetRow,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { UserAttendanceSchedule } from "@/components/users/user-attendance-schedule";
import { attendanceApi } from "@/lib/api/attendance";
import { budapestDayOf, formatDayHu } from "@/lib/format/date";

const WEEKDAY_SHORT = ["H", "K", "Sze", "Cs", "P", "Szo", "V"] as const;

/** 540 -> "9:00": hours and minutes, the way the paper sheet reads. */
export function formatAttendanceHours(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** What a row says in place of the times. */
function rowNote(row: AttendanceSheetRow): string {
  switch (row.kind) {
    case "WORK":
      return row.source === "ENTRY" ? "Eltérő munkaidő" : "";
    case "SICK":
      return "Betegség";
    case "LEAVE":
      return "Szabadság";
    case "DAY_OFF":
      return "Szabadnap";
    case "HOLIDAY":
      return row.holiday ?? "Munkaszüneti nap";
    case "SWAPPED_REST":
      return "Áthelyezett pihenőnap";
    case "FREE":
      return "Pihenőnap";
    case "NO_SCHEDULE":
      return "Nincs érvényes munkarend";
  }
}

/** The rows that are not working days by the calendar or the schedule: leave marked there still counts as a day. */
const RESTING: ReadonlySet<AttendanceSheetRow["kind"]> = new Set([
  "HOLIDAY",
  "SWAPPED_REST",
  "FREE",
  "NO_SCHEDULE",
]);

type Choice = "SCHEDULE" | AttendanceDayKind;

const CHOICES: { value: Choice; label: string }[] = [
  { value: "SCHEDULE", label: "Munkarend szerint" },
  { value: "WORKED", label: "Eltérő munkaidő" },
  { value: "SICK", label: "Betegség (B)" },
  { value: "LEAVE", label: "Szabadság (SZ)" },
  { value: "DAY_OFF", label: "Szabadnap" },
];

const choiceOf = (row: AttendanceSheetRow): Choice =>
  row.source !== "ENTRY"
    ? "SCHEDULE"
    : row.kind === "WORK"
      ? "WORKED"
      : row.kind === "SICK"
        ? "SICK"
        : row.kind === "LEAVE"
          ? "LEAVE"
          : "DAY_OFF";

/**
 * THE ATTENDANCE SHEET PAGE (os-jelenleti-iv, S2b): one employee, one month, every day computed from the schedule and the
 * calendar, and a day changed by clicking it. Any month is editable, past ones too (Luca: the accountant books leave later),
 * and every change is audited by the API.
 *
 * ITS OWN PAGE UNDER `attendance.manage`, with its own employee picker: the user editor opens only with `users.manage`, so
 * the right given alone would otherwise reach nothing (barracuda on #2501). The weekly schedule is edited here too.
 */
export function AttendanceSheetPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = session
    ? hasPermission(session.user, PERMISSIONS.ATTENDANCE_MANAGE)
    : false;

  const [employees, setEmployees] = useState<AttendanceEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(() =>
    budapestDayOf(new Date()).slice(0, 7),
  );
  const [sheet, setSheet] = useState<AttendanceSheetResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AttendanceSheetRow | null>(null);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    attendanceApi
      .employees(token, controller.signal)
      .then((list) => {
        setEmployees(list.items);
        setListError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setListError(
          cause instanceof Error
            ? cause.message
            : "A munkatársak listája nem tölthető be.",
        );
      });
    return () => controller.abort();
  }, [canManage, token]);

  const loadSheet = useCallback(
    async (signal?: AbortSignal) => {
      if (!employeeId || !month) return;
      try {
        const next = await attendanceApi.sheet(
          token,
          employeeId,
          month,
          signal,
        );
        setSheet(next);
        setSheetError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        // A failed read is not an empty month: the old rows go, the reason shows.
        setSheet(null);
        setSheetError(
          cause instanceof Error
            ? cause.message
            : "A jelenléti ív nem tölthető be.",
        );
      }
    },
    [employeeId, month, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadSheet(controller.signal);
    return () => controller.abort();
  }, [loadSheet]);

  const employee = employees.find((e) => e.id === employeeId) ?? null;

  /**
   * THE SHEET ON SCREEN IS ONLY EVER THE CHOSEN ONE. While another employee's or month's sheet is loading, the previous one
   * must not stay editable: its rows (and the mark a dialog starts from) would be saved to the newly chosen employee
   * (barracuda on #2505; for a sick day that is health data on the wrong person). So the table shows only a sheet whose
   * `userId` and `month` are the current choice, and the day dialog writes to the sheet's own `userId`.
   */
  const shown =
    sheet && sheet.userId === employeeId && sheet.month === month
      ? sheet
      : null;

  const choose = (next: { employeeId?: string; month?: string }) => {
    setEditing(null);
    setSheetError(null);
    if (next.employeeId !== undefined) setEmployeeId(next.employeeId);
    if (next.month !== undefined) setMonth(next.month);
  };

  if (!canManage)
    return (
      <div className="space-y-4">
        <PilotPageHeader title="Jelenléti ív" />
        <Alert
          variant="danger"
          title="Nincs jogosultságod"
          description="A jelenléti ívet a jelenléti ív kezelése jog nyitja meg."
        />
      </div>
    );

  return (
    <div className="space-y-4">
      <PilotPageHeader
        title="Jelenléti ív"
        description="A heti munkarendből és a naptárból töltődik ki. Egy napra kattintva jelölhető a betegség, a szabadság, a szabadnap vagy az eltérő munkaidő."
      />

      {listError ? (
        <Alert
          variant="danger"
          title="Nem tölthető be"
          description={listError}
        />
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <PilotFormField label="Munkatárs">
          <PilotSelect
            aria-label="Munkatárs"
            value={employeeId}
            onChange={(value) => choose({ employeeId: value })}
            chevron
          >
            <option value="">Válassz munkatársat</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName}
                {e.isActive ? "" : " (inaktív)"}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
        <PilotFormField label="Hónap">
          <PilotMonthField
            aria-label="Hónap"
            value={month}
            onChange={(value) => choose({ month: value })}
          />
        </PilotFormField>
      </div>

      {!employeeId ? (
        <EmptyState
          title="Válassz munkatársat"
          description="A kiválasztott hónap íve itt jelenik meg."
        />
      ) : sheetError ? (
        <Alert
          variant="danger"
          title="Nem tölthető be"
          description={sheetError}
        />
      ) : !shown ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <PilotCard className="space-y-3 p-4">
          {shown.swapsDecree ? null : (
            <Alert
              title="Az áthelyezett munkanapok erre az évre még nincsenek a rendszerben"
              description="Az ünnepnapokat a lap ismeri, de az évi munkarend-rendelet áthelyezett napjait nem: ezeket addig egyenként kell jelölni."
            />
          )}
          <div className="overflow-x-auto">
            <table
              className="w-full text-left text-sm"
              aria-label="Jelenléti ív"
            >
              <thead>
                <tr className="text-xs text-pilot-grey-500">
                  <th className="py-2 pr-3 font-medium">Dátum</th>
                  <th className="py-2 pr-3 font-medium">Érkezés</th>
                  <th className="py-2 pr-3 font-medium">Távozás</th>
                  <th className="py-2 pr-3 font-medium">Ledolgozott</th>
                  <th className="py-2 pr-3 font-medium">Megjegyzés</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Módosítás</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((row) => (
                  <tr
                    key={row.date}
                    className={
                      RESTING.has(row.kind)
                        ? "border-t border-pilot-grey-100 text-pilot-grey-500"
                        : "border-t border-pilot-grey-100"
                    }
                  >
                    <td className="whitespace-nowrap py-1.5 pr-3">
                      {formatDayHu(row.date)} {WEEKDAY_SHORT[row.weekday - 1]}
                    </td>
                    <td className="py-1.5 pr-3">
                      {row.start ?? row.mark ?? ""}
                    </td>
                    <td className="py-1.5 pr-3">{row.end ?? row.mark ?? ""}</td>
                    <td className="py-1.5 pr-3">
                      {row.kind === "WORK"
                        ? formatAttendanceHours(row.minutes)
                        : ""}
                    </td>
                    <td className="py-1.5 pr-3">{rowNote(row)}</td>
                    <td className="py-1.5">
                      <PilotButton
                        variant="secondary"
                        aria-label={`${formatDayHu(row.date)} módosítása`}
                        onClick={() => setEditing(row)}
                      >
                        Módosítás
                      </PilotButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm" aria-label="Összesítés">
            Ledolgozott összesen:{" "}
            <strong>{formatAttendanceHours(shown.totalMinutes)}</strong> óra ·
            Betegség: {shown.sickDays} nap · Szabadság: {shown.leaveDays} nap
          </p>
        </PilotCard>
      )}

      {employee ? (
        <UserAttendanceSchedule
          key={employee.id}
          userId={employee.id}
          role={employee.role}
          onChange={() => void loadSheet()}
        />
      ) : null}

      {editing && shown ? (
        <DayEditor
          row={editing}
          token={token}
          userId={shown.userId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void loadSheet();
          }}
        />
      ) : null}
    </div>
  );
}

/** One day's mark: back to the schedule (the entry is removed), other times, sick, leave or day off. */
function DayEditor({
  row,
  token,
  userId,
  onClose,
  onSaved,
}: {
  row: AttendanceSheetRow;
  token: string;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [choice, setChoice] = useState<Choice>(() => choiceOf(row));
  const [start, setStart] = useState(
    row.source === "ENTRY" ? (row.start ?? "") : "",
  );
  const [end, setEnd] = useState(row.source === "ENTRY" ? (row.end ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /** Back to the schedule removes the day's entry: asked first, like every delete a screen can start. */
  const reset = async () => {
    setBusy(true);
    try {
      await attendanceApi.deleteDay(token, userId, row.date);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const save = async () => {
    setError(null);
    if (choice === "SCHEDULE") {
      if (row.source === "ENTRY") setConfirming(true);
      else onClose();
      return;
    }
    const input =
      choice === "WORKED" ? { kind: choice, start, end } : { kind: choice };
    const problem = attendanceDayProblem(input);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await attendanceApi.saveDay(token, userId, row.date, input);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (confirming)
    return (
      <ConfirmDialog
        open
        title="Visszaállítod a napot a munkarendre?"
        consequence={`A(z) ${formatDayHu(row.date)} napi jelölése törlődik, és a nap ismét a munkarend és a naptár szerint számít.`}
        recovery="A jelölés bármikor újra megadható. A változás a naplóban megmarad."
        confirmLabel="Visszaállítás"
        busy={busy}
        onConfirm={() => void reset()}
        onCancel={() => setConfirming(false)}
      />
    );

  return (
    <PilotDialog open onClose={onClose}>
      <div
        role="dialog"
        aria-labelledby="nap-jeloles-cim"
        className="space-y-3 p-5"
      >
        <h2 id="nap-jeloles-cim" className="text-sm font-semibold">
          {formatDayHu(row.date)} {WEEKDAY_SHORT[row.weekday - 1]}
        </h2>
        <PilotRadioGroup
          name="napi-jeloles"
          label="A nap"
          options={CHOICES}
          value={choice}
          onChange={setChoice}
        />
        {choice === "WORKED" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <PilotFormField label="Érkezés" required>
              <PilotInput
                type="time"
                value={start}
                onChange={setStart}
                aria-label="Érkezés"
              />
            </PilotFormField>
            <PilotFormField label="Távozás" required>
              <PilotInput
                type="time"
                value={end}
                onChange={setEnd}
                aria-label="Távozás"
              />
            </PilotFormField>
          </div>
        ) : null}
        {/* barracuda on #2502: leave on a day that is not a working day still counts as a day of leave */}
        {choice === "LEAVE" &&
        row.source !== "ENTRY" &&
        RESTING.has(row.kind) ? (
          <p className="text-xs text-pilot-amber-700">
            Ez a nap nem munkanap ({rowNote(row).toLowerCase()}): a szabadság
            itt is egy napnak számít.
          </p>
        ) : null}
        {error ? (
          <Alert variant="danger" title="Nem sikerült" description={error} />
        ) : null}
        <div className="flex justify-end gap-2">
          <PilotButton variant="secondary" disabled={busy} onClick={onClose}>
            Mégse
          </PilotButton>
          <PilotButton disabled={busy} onClick={() => void save()}>
            {busy ? "Mentés…" : "Mentés"}
          </PilotButton>
        </div>
      </div>
    </PilotDialog>
  );
}
