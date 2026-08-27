"use client";

import { Button, Card } from "@acropora/ui";
import type { WorksheetAssignee, WorksheetDetail } from "@acropora/types";
import { useEffect, useState } from "react";

import { worksheetsApi } from "@/lib/api/worksheets";
import {
  toggleAssignee,
  useAssignableUsers,
  WorksheetAssigneePicker,
} from "./worksheet-assignee-picker";

export interface WorksheetAssigneeEditorProps {
  worksheetId: string;
  token: string;
  assignees: WorksheetAssignee[];
  canManage: boolean;
  onSaved: (detail: WorksheetDetail) => void;
}

/**
 * A felelősök kiosztása. A beküldött névsor a lap TELJES felelős-listája,
 * nem egy hozzáadás - ezért a felület is listát szerkeszt, nem egyesével
 * ad hozzá és vesz el.
 *
 * Lezárt lapon is engedett: a kiosztás munkaszervezés, nem a dokumentum
 * tartalma, és egy tévesen kiosztott lapot a lezárás után is javítani kell
 * tudni.
 */
export function WorksheetAssigneeEditor({
  worksheetId,
  token,
  assignees,
  canManage,
  onSaved,
}: WorksheetAssigneeEditorProps) {
  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    canManage,
  );
  const [selected, setSelected] = useState<string[]>(
    assignees.map((assignee) => assignee.userId),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(assignees.map((assignee) => assignee.userId));
  }, [assignees]);

  const toggle = (userId: string) => {
    setSelected((current) => toggleAssignee(current, userId));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await worksheetsApi.setAssignees(token, worksheetId, {
          userIds: selected,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A felelősök mentése nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  const current = assignees.map((assignee) => assignee.userId);
  const changed =
    selected.length !== current.length ||
    selected.some((userId) => !current.includes(userId));

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-slate-800">Felelősök</h2>
      {assignees.length ? (
        <ul className="text-sm text-slate-700">
          {assignees.map((assignee) => (
            <li key={assignee.userId}>{assignee.name}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          Erre a munkalapra még nincs kiosztva senki.
        </p>
      )}

      {canManage ? (
        <>
          <WorksheetAssigneePicker
            candidates={candidates}
            selected={selected}
            onToggle={toggle}
          />
          {(error ?? candidatesError) ? (
            <p className="text-xs font-medium text-rose-600">
              {error ?? candidatesError}
            </p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={!changed || saving}
            onClick={() => void save()}
          >
            {saving ? "Mentés..." : "Felelősök mentése"}
          </Button>
        </>
      ) : null}
    </Card>
  );
}
