"use client";

import type { ServiceJobAssignee, ServiceJobDetail } from "@acropora/types";
import { useEffect, useRef, useState } from "react";

import { serviceJobsApi } from "@/lib/api/service-jobs";
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import { useAssignableUsers } from "@/components/worksheets/worksheet-assignee-picker";
import {
  PilotAvatar,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDialog,
  pilotAvatarColor,
  pilotInitials,
} from "@/components/pilot/pilot-ui";

/**
 * A "DELEGÁLT KOLLÉGÁK" KÁRTYA ÉS VÁLASZTÓ, FIGMA-STÍLUSBAN.
 *
 * Balázs kifejezetten kérte (acrobot közvetítésével, msg 23168), hogy ez a
 * kártya és a hozzá tartozó választó NE maradjon a régi kinézetben, szemben
 * a lap többi beágyazott alrendszerével (helyszín+eszköz-szerkesztő,
 * galéria, átadás-dialógus, partner-választó, törlés-megerősítő -- azok
 * régi stílusban maradnak, lásd `pilot-service-job-detail-page.tsx`
 * fejlécét). A Figma-forrás:
 * `exchange/figma-hibajegyek-make-6/src/HibajegyekScreen.tsx`
 * (`DegalaltKollegakCard`, `DelegalasPicker`, `DelegaltAvatarStack`).
 *
 * A MAI FUNKCIÓT (`ServiceJobAssigneeEditor`) VÁLTJA FEL, nem egészíti ki:
 * ugyanaz a `serviceJobsApi.setAssignees` végpont, ugyanaz a
 * `useAssignableUsers` jelölt-lista -- csak a megjelenés Figma-stílusú.
 *
 * === "DELEGÁLTA: X" -- ÚJ MEZŐ, MEGLÉVŐ ADATBÓL ===
 *
 * A Figma minden delegált sornál kiírja, ki és mikor delegálta. A valódi
 * `ServiceJobAssignee` típus ezt eddig NEM hordozta a kliens felé, holott a
 * séma (`ServiceJobAssignee.assignedById`) már tudta -- a mező felvéve
 * 2026-09-24-én (`assignedByName`, `packages/types`), a részletlap
 * lekérdezése kibővítve. `null`, ha a delegáló azóta törölve lett vagy
 * ismeretlen -- ilyenkor csak a dátum jelenik meg, "delegálta" felirat
 * nélkül.
 */
export interface PilotDelegatedColleaguesCardProps {
  jobId: string;
  token: string;
  assignees: ServiceJobAssignee[];
  canManage: boolean;
  onSaved: (detail: ServiceJobDetail) => void;
}

export function PilotDelegatedColleaguesCard({
  jobId,
  token,
  assignees,
  canManage,
  onSaved,
}: PilotDelegatedColleaguesCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <PilotCard>
        <PilotCardHeader
          title="Delegált kollégák"
          action={
            canManage ? (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-white px-3 py-1 text-xs font-medium text-pilot-grey-700 ring-1 ring-pilot-grey-200 transition hover:bg-pilot-grey-50"
              >
                <svg
                  width={12}
                  height={12}
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M8 3v10M3 8h10" />
                </svg>
                Kollégák delegálása
              </button>
            ) : undefined
          }
        />
        {assignees.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            <p className="text-sm text-pilot-grey-400">
              Még nincs delegált kolléga.
            </p>
            {canManage ? (
              <PilotButton
                variant="secondary"
                onClick={() => setPickerOpen(true)}
              >
                Kollégák delegálása
              </PilotButton>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-pilot-grey-50">
            {assignees.map((assignee) => (
              <div
                key={assignee.userId}
                className="flex items-center gap-3 px-5 py-3"
              >
                <PilotAvatar
                  initials={pilotInitials(assignee.name)}
                  color={pilotAvatarColor(assignee.userId)}
                  size="md"
                />
                <div>
                  <p className="text-sm font-medium text-pilot-grey-800">
                    {assignee.name}
                  </p>
                  <p className="text-[11px] text-pilot-grey-400">
                    {assignee.assignedByName
                      ? `delegálta: ${assignee.assignedByName}, ${formatDateTime(assignee.assignedAt)}`
                      : formatDateTime(assignee.assignedAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </PilotCard>

      {pickerOpen ? (
        <PilotDelegationPicker
          jobId={jobId}
          token={token}
          initial={assignees.map((assignee) => assignee.userId)}
          onClose={() => setPickerOpen(false)}
          onSaved={(detail) => {
            setPickerOpen(false);
            onSaved(detail);
          }}
        />
      ) : null}
    </>
  );
}

function PilotDelegationPicker({
  jobId,
  token,
  initial,
  onClose,
  onSaved,
}: {
  jobId: string;
  token: string;
  initial: string[];
  onClose: () => void;
  onSaved: (detail: ServiceJobDetail) => void;
}) {
  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    true,
  );
  const [selected, setSelected] = useState<string[]>(initial);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = candidates.filter((candidate) =>
    candidate.name.toLowerCase().includes(search.toLowerCase()),
  );

  const toggle = (userId: string) => {
    setSaveError(null);
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      onSaved(
        await serviceJobsApi.setAssignees(token, jobId, { userIds: selected }),
      );
    } catch (cause) {
      setSaveError(
        cause instanceof Error
          ? cause.message
          : "A delegálás mentése nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <PilotDialog open onClose={onClose}>
      <div className="flex items-center justify-between border-b border-pilot-grey-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-pilot-grey-900">
          Kollégák delegálása
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded p-1 text-pilot-grey-400 transition hover:bg-pilot-grey-100 hover:text-pilot-grey-700"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M12 4L4 12M4 4l8 8" />
          </svg>
        </button>
      </div>

      <div className="px-4 pb-2 pt-4">
        <div className="relative">
          <svg
            width={14}
            height={14}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-300"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M11 11l2.5 2.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Kolléga keresése…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-md py-1.5 pl-8 pr-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
        </div>

        {selected.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {selected.map((userId) => {
              const candidate = candidates.find((item) => item.id === userId);
              const name = candidate?.name ?? userId;
              return (
                <button
                  key={userId}
                  type="button"
                  onClick={() => toggle(userId)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full bg-pilot-aqua-50 px-2 py-1 text-xs text-pilot-aqua-700 ring-1 ring-pilot-aqua-200 transition hover:bg-pilot-aqua-100"
                >
                  <PilotAvatar
                    initials={pilotInitials(name)}
                    color={pilotAvatarColor(userId)}
                    size="sm"
                  />
                  {name}
                  <span className="ml-0.5 text-pilot-aqua-400">×</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {candidatesError ? (
        <p className="px-4 pb-2 text-xs font-medium text-rose-600">
          {candidatesError}
        </p>
      ) : null}

      <div className="flex max-h-52 flex-col divide-y divide-pilot-grey-50 overflow-y-auto px-2 pb-2">
        {filtered.map((candidate) => {
          const isOn = selected.includes(candidate.id);
          return (
            <button
              key={candidate.id}
              type="button"
              onClick={() => toggle(candidate.id)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                isOn ? "bg-pilot-aqua-50" : "hover:bg-pilot-grey-50"
              }`}
            >
              <PilotAvatar
                initials={pilotInitials(candidate.name)}
                color={pilotAvatarColor(candidate.id)}
                size="md"
              />
              <span
                className={`flex-1 text-sm ${
                  isOn
                    ? "font-medium text-pilot-aqua-700"
                    : "text-pilot-grey-700"
                }`}
              >
                {candidate.name}
              </span>
              {isOn ? (
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="#0b7a6e"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M3 8l3.5 3.5L13 5" />
                </svg>
              ) : null}
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-pilot-grey-400">
            Nincs találat.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-pilot-grey-100 px-5 py-4">
        {saveError ? (
          <p className="flex items-center gap-1.5 text-xs text-red-600">
            <svg
              width={12}
              height={12}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5v4M8 11v.5" />
            </svg>
            {saveError}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          <PilotButton variant="secondary" onClick={onClose}>
            Mégse
          </PilotButton>
          <PilotButton
            variant="primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Mentés…" : "Delegálás mentése"}
          </PilotButton>
        </div>
      </div>
    </PilotDialog>
  );
}
