"use client";

import {
  type DashboardLayoutEntry,
  type DashboardLayoutResponse,
  type DashboardWidgetId,
  type DashboardWidgetResult,
  type DashboardWidgetSize,
  type UserRole,
} from "@acropora/types";
import { Alert, ConfirmDialog } from "@acropora/ui";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ROLE_LABELS } from "@/components/users/role-labels";
import { dashboardApi } from "@/lib/api/dashboard";
import { enabledWidgets, layoutUpdate } from "@/lib/dashboard/layout-edit";

import { DashboardCustomizeDrawer } from "./customize-drawer";
import { DashboardWidgetFrame, type WidgetFrameState } from "./widget-frame";
import { DASHBOARD_WIDGET_VIEWS } from "./widgets";

const dayFormatter = new Intl.DateTimeFormat("hu-HU", {
  month: "long",
  day: "numeric",
  weekday: "long",
});

/**
 * Figma 382:3: a third / two thirds / the full row on desktop (12 columns),
 * halves below `xl`, one column below `md`. No widget gets narrower than
 * that, so none becomes unreadable.
 */
const SIZE_CLASS: Record<DashboardWidgetSize, string> = {
  sm: "md:col-span-3 xl:col-span-4",
  md: "md:col-span-6 xl:col-span-8",
  lg: "md:col-span-6 xl:col-span-12",
};

type WidgetResults = Partial<Record<DashboardWidgetId, DashboardWidgetResult>>;

/**
 * THE CONFIGURABLE PART OF THE HOME PAGE (`docs/dashboard/v1-discovery.md`).
 *
 * Two requests, never one per widget: the layout, then ONE grouped call for
 * the enabled widgets' data. A failure of that call shows every card in its
 * error state ("Az adat jelenleg nem elérhető."), never a zero.
 */
export function DashboardHome() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const role: UserRole | undefined = session?.user.role;
  // the identity of the session object is not a reason to refetch: a save
  // would otherwise be overwritten by a reload of the old layout
  const hasSession = session !== null && session !== undefined;

  const [layout, setLayout] = useState<DashboardLayoutResponse | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [results, setResults] = useState<WidgetResults | null>(null);
  const [resultsFailed, setResultsFailed] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!hasSession) return;
    const controller = new AbortController();
    setLayoutError(null);
    dashboardApi
      .layout(token, controller.signal)
      .then(setLayout)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setLayoutError(
            cause instanceof Error
              ? cause.message
              : "A vezérlőpult nem tölthető be.",
          );
      });
    return () => controller.abort();
  }, [hasSession, token]);

  const enabledIds = layout
    ? enabledWidgets(layout.widgets).map((entry) => entry.widgetId)
    : [];
  const idsKey = enabledIds.join(",");
  const hasLayout = layout !== null;

  useEffect(() => {
    if (!hasLayout || idsKey === "") {
      setResults({});
      return;
    }
    const controller = new AbortController();
    setResults(null);
    setResultsFailed(false);
    dashboardApi
      .widgets(
        token,
        idsKey.split(",") as DashboardWidgetId[],
        controller.signal,
      )
      .then((response) => setResults(response.results))
      .catch(() => {
        if (!controller.signal.aborted) setResultsFailed(true);
      });
    return () => controller.abort();
    // `idsKey` stands for the enabled ids: a save that only resizes or
    // reorders does not refetch the data.
  }, [hasLayout, idsKey, token]);

  const save = useCallback(
    async (entries: DashboardLayoutEntry[]) => {
      setSaving(true);
      setSaveError(null);
      try {
        setLayout(await dashboardApi.saveLayout(token, layoutUpdate(entries)));
        setCustomizing(false);
      } catch (cause) {
        setSaveError(
          cause instanceof Error ? cause.message : "A mentés nem sikerült.",
        );
      } finally {
        setSaving(false);
      }
    },
    [token],
  );

  const reset = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      setLayout(await dashboardApi.resetLayout(token));
      setConfirmReset(false);
      setCustomizing(false);
    } catch (cause) {
      setSaveError(
        cause instanceof Error
          ? cause.message
          : "A visszaállítás nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  }, [token]);

  const info = new Map(layout?.available.map((w) => [w.id, w]) ?? []);
  const subtitle = [
    role ? ROLE_LABELS[role] : null,
    layout
      ? layout.source === "custom"
        ? "Személyes elrendezés"
        : "Ajánlott elrendezés"
      : null,
    dayFormatter.format(new Date()),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.3px] text-pilot-grey-900">
            Vezérlőpult
          </h1>
          <p className="mt-[3px] text-xs leading-4 text-pilot-grey-500">
            {subtitle}
          </p>
        </div>
        {layout ? (
          <div className="flex items-center gap-2.5">
            <span className="rounded-full bg-pilot-aqua-50 px-2.5 py-1.5 text-xs font-medium leading-4 text-pilot-aqua-700">
              {enabledIds.length} AKTÍV WIDGET
            </span>
            <button
              type="button"
              onClick={() => setCustomizing(true)}
              className="flex items-center gap-2 rounded-[9px] border border-pilot-grey-300 bg-white px-3.5 py-[9px] text-sm font-semibold leading-5 text-pilot-grey-900 hover:bg-pilot-grey-50"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-pilot-aqua-500"
              />
              Vezérlőpult testreszabása
            </button>
          </div>
        ) : null}
      </header>

      {layoutError ? (
        <Alert
          variant="danger"
          title="A vezérlőpult elrendezése nem tölthető be"
          description={layoutError}
        />
      ) : null}

      {layout && enabledIds.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-pilot-grey-300 bg-white px-4 py-6 text-center text-sm text-pilot-grey-500">
          Nincs bekapcsolt widget. A „Vezérlőpult testreszabása” gombbal
          választhatsz a jogosultságaid szerint elérhetők közül.
        </p>
      ) : null}

      {layout && enabledIds.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-12">
          {enabledWidgets(layout.widgets).map((entry) => {
            const view = DASHBOARD_WIDGET_VIEWS[entry.widgetId];
            const widget = info.get(entry.widgetId);
            const result = results?.[entry.widgetId];
            // not permitted / not active on the server: the card is not drawn
            if (
              !view ||
              !widget ||
              result?.status === "forbidden" ||
              result?.status === "unavailable"
            )
              return null;
            return (
              <DashboardWidgetFrame
                key={entry.widgetId}
                className={SIZE_CLASS[entry.size]}
                title={widget.title}
                subtitle={widget.description}
                href={view.href}
                state={frameState(view, result, resultsFailed)}
              />
            );
          })}
        </div>
      ) : null}

      {layout ? (
        <DashboardCustomizeDrawer
          open={customizing}
          layout={layout}
          saving={saving}
          error={saveError}
          onClose={() => setCustomizing(false)}
          onSave={(entries) => void save(entries)}
          onReset={() => setConfirmReset(true)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        title="Visszaállítod az ajánlott elrendezést?"
        consequence="A saját elrendezésed (a kiválasztott widgetek és a sorrendjük) törlődik, és a szerepköröd ajánlott elrendezése lép a helyére."
        recovery="Visszaállítani nem lehet, de a testreszabással bármikor újra összeállíthatod."
        confirmLabel="Visszaállítás"
        busy={saving}
        onConfirm={() => void reset()}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function frameState(
  view: NonNullable<(typeof DASHBOARD_WIDGET_VIEWS)[DashboardWidgetId]>,
  result: DashboardWidgetResult | undefined,
  requestFailed: boolean,
): WidgetFrameState {
  if (requestFailed) return { kind: "error" };
  if (!result) return { kind: "loading" };
  if (result.status !== "ok") return { kind: "error" };
  const empty = view.emptyMessage(result.data);
  if (empty !== null) return { kind: "empty", message: empty };
  const { Body } = view;
  return { kind: "ready", body: <Body data={result.data} /> };
}
