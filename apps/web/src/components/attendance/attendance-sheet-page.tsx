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

import {
  AttendanceSheetTable,
  RESTING,
  rowNote,
  WEEKDAY_SHORT,
} from "./attendance-sheet-table";
import {
  budapestDayOf,
  formatDateTimeHu,
  formatDayHu,
} from "@/lib/format/date";

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
  const [pdfError, setPdfError] = useState<string | null>(null);

  /**
   * A PDF in a new tab (S2c, S2d): the month as it stands, the month printed for signature (kept by the server), or a kept
   * signed copy. A blocked tab is said, not swallowed.
   */
  const openPdf = async (
    load: () => Promise<Blob>,
    afterwards?: () => void,
  ) => {
    setPdfError(null);
    // the tab opens in the click itself: one opened after an await is blocked by Safari (barracuda on #2509)
    const opened = window.open("", "_blank");
    try {
      const url = URL.createObjectURL(await load());
      // the tab keeps its own copy once loaded; the page never holds the PDF for good
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (opened) opened.location.href = url;
      else
        setPdfError(
          "A böngésző nem engedte megnyitni a PDF-et új lapon. Engedélyezd a felugró ablakot erre az oldalra.",
        );
    } catch (cause) {
      opened?.close();
      setPdfError(
        cause instanceof Error
          ? cause.message
          : "A jelenléti ív PDF-je nem tölthető le.",
      );
    } finally {
      afterwards?.();
    }
  };

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
        {shown ? (
          <>
            <PilotButton
              variant="secondary"
              onClick={() =>
                void openPdf(() =>
                  attendanceApi.sheetPdf(token, shown.userId, shown.month),
                )
              }
            >
              PDF megtekintése
            </PilotButton>
            <PilotButton
              onClick={() =>
                void openPdf(
                  () =>
                    attendanceApi.printForSignature(
                      token,
                      shown.userId,
                      shown.month,
                    ),
                  () => void loadSheet(),
                )
              }
            >
              Nyomtatás aláírásra
            </PilotButton>
          </>
        ) : null}
      </div>
      {pdfError ? (
        <Alert variant="danger" title="Nem sikerült" description={pdfError} />
      ) : null}

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
          {shown.signedCopy ? (
            <div className="flex flex-wrap items-center gap-2">
              {shown.signedCopy.differs ? (
                <Alert
                  variant="danger"
                  title="Az aláírásra nyomtatott példány óta a hónap megváltozott"
                  description={`Aláírásra nyomtatva: ${formatDateTimeHu(shown.signedCopy.printedAt)}. Új nyomtatás és aláírás kell; a korábbi példány megmarad.`}
                />
              ) : (
                <p className="text-xs text-pilot-grey-500">
                  Aláírásra nyomtatva:{" "}
                  {formatDateTimeHu(shown.signedCopy.printedAt)}, azóta
                  változatlan.
                </p>
              )}
              <PilotButton
                variant="secondary"
                onClick={() => {
                  const copy = shown.signedCopy;
                  if (copy)
                    void openPdf(() =>
                      attendanceApi.signedSheetPdf(
                        token,
                        shown.userId,
                        copy.id,
                      ),
                    );
                }}
              >
                Nyomtatott példány
              </PilotButton>
            </div>
          ) : null}
          {shown.swapsDecree ? null : (
            <Alert
              title="Az áthelyezett munkanapok erre az évre még nincsenek a rendszerben"
              description="Az ünnepnapokat a lap ismeri, de az évi munkarend-rendelet áthelyezett napjait nem: ezeket addig egyenként kell jelölni."
            />
          )}
          {/* the office sees an employee's advance marks as planned (screen only: no time, no total, not on the PDF;
              barracuda on #2520) */}
          <AttendanceSheetTable
            sheet={shown}
            canEdit={() => true}
            onEdit={setEditing}
            showPlanned
          />
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

  /*
    A STORED "OTHER TIMES" ENTRY WHOSE TIMES THE SHEET DOES NOT SHOW YET (a later day, or today before the departure):
    the row is cut to now, so its times are read from the stored entry, not retyped (barracuda on #2520).
  */
  // the time fields wait for the stored times, so nothing typed meanwhile is overwritten (barracuda on #2520)
  const needsStored =
    row.source === "ENTRY" && row.kind === "WORK" && !(row.start && row.end);
  const [loadingStored, setLoadingStored] = useState(needsStored);
  useEffect(() => {
    if (!needsStored) return;
    const controller = new AbortController();
    attendanceApi
      .days(token, userId, row.date, row.date, controller.signal)
      .then((list) => {
        const stored = list.items.find((item) => item.date === row.date);
        if (stored?.kind === "WORKED") {
          setStart(stored.start ?? "");
          setEnd(stored.end ?? "");
        }
      })
      .catch(() => {
        // the dialog still works: the times are then typed again
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingStored(false);
      });
    return () => controller.abort();
  }, [needsStored, row, token, userId]);

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
                disabled={loadingStored}
              />
            </PilotFormField>
            <PilotFormField label="Távozás" required>
              <PilotInput
                type="time"
                value={end}
                onChange={setEnd}
                aria-label="Távozás"
                disabled={loadingStored}
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
