"use client";

import {
  Alert,
  ConfirmDialog,
  PilotButton,
  PilotCard,
  PilotDialog,
  PilotFormField,
  PilotMonthField,
  PilotPageHeader,
  PilotRadioGroup,
  Skeleton,
} from "@acropora/ui";
import {
  attendanceSelfMarkProblem,
  isAttendanceEmployeeRole,
  type AttendanceSheetResponse,
  type AttendanceSheetRow,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { attendanceApi } from "@/lib/api/attendance";
import { budapestDayOf, formatDayHu } from "@/lib/format/date";

import { AttendanceSheetTable, WEEKDAY_SHORT } from "./attendance-sheet-table";

type OwnChoice = "NONE" | "LEAVE" | "DAY_OFF";

const OWN_CHOICES: { value: OwnChoice; label: string }[] = [
  { value: "NONE", label: "Nincs jelölés" },
  { value: "LEAVE", label: "Szabadság (SZ)" },
  { value: "DAY_OFF", label: "Szabadnap" },
];

/** The kind of the employee's own mark on a row, or null (no entry, or an admin's other mark). */
const ownMark = (row: AttendanceSheetRow): "LEAVE" | "DAY_OFF" | null =>
  row.source === "ENTRY" && (row.kind === "LEAVE" || row.kind === "DAY_OFF")
    ? row.kind
    : null;

/**
 * THE EMPLOYEE'S OWN SHEET (os-jelenleti-iv, S3; brief point 3): the month as it stands, and leave or a day off marked in
 * advance, from tomorrow on. Everything else (sick days, other times, past days) is the admin's, and a day the admin marked
 * otherwise is not offered here; the API checks the same rule again under its lock.
 */
export function OwnAttendancePage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const employee = session
    ? isAttendanceEmployeeRole(session.user.role)
    : false;
  const today = budapestDayOf(new Date());

  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [sheet, setSheet] = useState<AttendanceSheetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AttendanceSheetRow | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!employee || !month) return;
      try {
        setSheet(await attendanceApi.mySheet(token, month, signal));
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setSheet(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "A jelenléti ív nem tölthető be.",
        );
      }
    },
    [employee, month, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // only the chosen month is ever on screen (the same rule as the admin page, barracuda on #2505)
  const shown = sheet && sheet.month === month ? sheet : null;

  if (!employee)
    return (
      <div className="space-y-4">
        <PilotPageHeader title="Jelenléti ívem" />
        <Alert
          title="Ehhez a fiókhoz nem tartozik jelenléti ív"
          description="Jelenléti íve a saját munkatársainknak van; partner- és gépi fióknak nincs."
        />
      </div>
    );

  return (
    <div className="space-y-4">
      <PilotPageHeader
        title="Jelenléti ívem"
        description="A munkarended szerint töltődik ki. Holnaptól előre jelölhetsz szabadságot vagy szabadnapot; minden mást az adminisztrátor rögzít."
      />
      <PilotFormField label="Hónap">
        <PilotMonthField
          aria-label="Hónap"
          value={month}
          onChange={(value) => {
            setEditing(null);
            setError(null);
            setMonth(value);
          }}
        />
      </PilotFormField>

      {error ? (
        <Alert variant="danger" title="Nem tölthető be" description={error} />
      ) : !shown ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <PilotCard className="space-y-3 p-4">
          <AttendanceSheetTable
            sheet={shown}
            canEdit={(row) =>
              attendanceSelfMarkProblem({
                date: row.date,
                today,
                existing: row.source === "ENTRY" ? entryKind(row) : null,
              }) === null
            }
            onEdit={setEditing}
          />
        </PilotCard>
      )}

      {editing ? (
        <OwnDayEditor
          row={editing}
          token={token}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/** The kind an entry row carries, for the shared rule. */
function entryKind(row: AttendanceSheetRow) {
  switch (row.kind) {
    case "SICK":
      return "SICK" as const;
    case "LEAVE":
      return "LEAVE" as const;
    case "DAY_OFF":
      return "DAY_OFF" as const;
    default:
      return "WORKED" as const;
  }
}

function OwnDayEditor({
  row,
  token,
  onClose,
  onSaved,
}: {
  row: AttendanceSheetRow;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const current = ownMark(row);
  const [choice, setChoice] = useState<OwnChoice>(current ?? "LEAVE");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
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

  const save = () => {
    if (choice === "NONE") {
      if (current) setConfirming(true);
      else onClose();
      return;
    }
    if (choice === current) return onClose();
    void run(() => attendanceApi.markOwnDay(token, row.date, choice));
  };

  if (confirming)
    return (
      <ConfirmDialog
        open
        title="Törlöd a jelölésedet?"
        consequence={`A(z) ${formatDayHu(row.date)} napra tett jelölésed törlődik, és a nap ismét a munkarended szerint számít.`}
        recovery="A nap előtt bármikor újra jelölheted. A változás a naplóban megmarad."
        confirmLabel="Törlés"
        busy={busy}
        onConfirm={() =>
          void run(() => attendanceApi.clearOwnDay(token, row.date))
        }
        onCancel={() => setConfirming(false)}
      />
    );

  return (
    <PilotDialog open onClose={onClose}>
      <div
        role="dialog"
        aria-labelledby="sajat-nap-cim"
        className="space-y-3 p-5"
      >
        <h2 id="sajat-nap-cim" className="text-sm font-semibold">
          {formatDayHu(row.date)} {WEEKDAY_SHORT[row.weekday - 1]}
        </h2>
        <PilotRadioGroup
          name="sajat-jeloles"
          label="A nap"
          options={OWN_CHOICES}
          value={choice}
          onChange={setChoice}
        />
        {error ? (
          <Alert variant="danger" title="Nem sikerült" description={error} />
        ) : null}
        <div className="flex justify-end gap-2">
          <PilotButton variant="secondary" disabled={busy} onClick={onClose}>
            Mégse
          </PilotButton>
          <PilotButton disabled={busy} onClick={save}>
            {busy ? "Mentés…" : "Mentés"}
          </PilotButton>
        </div>
      </div>
    </PilotDialog>
  );
}
