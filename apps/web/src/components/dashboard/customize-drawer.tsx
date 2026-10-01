"use client";

import type {
  DashboardLayoutEntry,
  DashboardLayoutResponse,
  DashboardWidgetId,
} from "@acropora/types";
import { useEffect, useMemo, useState } from "react";

import { PilotButton, PilotDrawer } from "@/components/pilot/pilot-ui";
import {
  applyStarterLayout,
  enabledWidgets,
  moveWidget,
  toggleWidget,
} from "@/lib/dashboard/layout-edit";

/**
 * "VEZÉRLŐPULT TESTRESZABÁSA". Lists ONLY the widgets the API returned as
 * available to this user: a widget the user may not have is never offered,
 * and the full registry is never shown. Reordering is up/down buttons
 * (keyboard-accessible, no drag-and-drop library); drag-and-drop can later
 * write the same `order`.
 */
export function DashboardCustomizeDrawer({
  open,
  layout,
  saving,
  error,
  onClose,
  onSave,
  onReset,
}: {
  open: boolean;
  layout: DashboardLayoutResponse;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (entries: DashboardLayoutEntry[]) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<DashboardLayoutEntry[]>(layout.widgets);
  useEffect(() => {
    if (open) setDraft(layout.widgets);
  }, [open, layout.widgets]);

  const info = useMemo(
    () => new Map(layout.available.map((widget) => [widget.id, widget])),
    [layout.available],
  );
  const shown = enabledWidgets(draft);
  const hidden = draft.filter((entry) => !entry.enabled);
  const title = (id: DashboardWidgetId) => info.get(id)?.title ?? id;
  const description = (id: DashboardWidgetId) => info.get(id)?.description;

  return (
    <PilotDrawer
      open={open}
      onClose={onClose}
      title="Vezérlőpult testreszabása"
      subtitle="A jogosultságaid szerint elérhető widgetek."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PilotButton variant="ghost" onClick={onReset} disabled={saving}>
            Ajánlott elrendezés visszaállítása
          </PilotButton>
          <div className="flex gap-2">
            <PilotButton
              variant="secondary"
              onClick={onClose}
              disabled={saving}
            >
              Mégse
            </PilotButton>
            <PilotButton onClick={() => onSave(draft)} disabled={saving}>
              {saving ? "Mentés…" : "Mentés"}
            </PilotButton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {error ? (
          <p role="alert" className="text-sm text-pilot-red-700">
            {error}
          </p>
        ) : null}

        {layout.starterLayouts.length ? (
          <section>
            <h3 className="mb-2 text-xs font-medium text-pilot-grey-500">
              Induló elrendezések
            </h3>
            <div className="flex flex-wrap gap-2">
              {layout.starterLayouts.map((starter) => (
                <PilotButton
                  key={starter.id}
                  variant="secondary"
                  onClick={() =>
                    setDraft((current) =>
                      applyStarterLayout(current, starter.widgetIds),
                    )
                  }
                >
                  {starter.label}
                </PilotButton>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-medium text-pilot-grey-500">
            Megjelenített widgetek
          </h3>
          {shown.length === 0 ? (
            <p className="text-sm text-pilot-grey-500">
              Nincs megjelenített widget.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((entry, index) => (
                <li
                  key={entry.widgetId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-pilot-grey-200 px-3 py-2"
                >
                  <WidgetLabel
                    title={title(entry.widgetId)}
                    description={description(entry.widgetId)}
                  />
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      label={`${title(entry.widgetId)} feljebb`}
                      disabled={index === 0}
                      onClick={() =>
                        setDraft((current) =>
                          moveWidget(current, entry.widgetId, -1),
                        )
                      }
                    >
                      ↑
                    </IconButton>
                    <IconButton
                      label={`${title(entry.widgetId)} lejjebb`}
                      disabled={index === shown.length - 1}
                      onClick={() =>
                        setDraft((current) =>
                          moveWidget(current, entry.widgetId, 1),
                        )
                      }
                    >
                      ↓
                    </IconButton>
                    <Toggle
                      label={`${title(entry.widgetId)} megjelenítése`}
                      checked
                      onChange={() =>
                        setDraft((current) =>
                          toggleWidget(current, entry.widgetId),
                        )
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {hidden.length ? (
          <section>
            <h3 className="mb-2 text-xs font-medium text-pilot-grey-500">
              További elérhető widgetek
            </h3>
            <ul className="flex flex-col gap-2">
              {hidden.map((entry) => (
                <li
                  key={entry.widgetId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-pilot-grey-200 px-3 py-2"
                >
                  <WidgetLabel
                    title={title(entry.widgetId)}
                    description={description(entry.widgetId)}
                  />
                  <Toggle
                    label={`${title(entry.widgetId)} megjelenítése`}
                    checked={false}
                    onChange={() =>
                      setDraft((current) =>
                        toggleWidget(current, entry.widgetId),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PilotDrawer>
  );
}

function WidgetLabel({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-pilot-grey-900">
        {title}
      </p>
      {description ? (
        <p className="truncate text-xs text-pilot-grey-500">{description}</p>
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md text-sm text-pilot-grey-600 hover:bg-pilot-grey-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className="size-4 accent-pilot-aqua-600"
      />
    </label>
  );
}
