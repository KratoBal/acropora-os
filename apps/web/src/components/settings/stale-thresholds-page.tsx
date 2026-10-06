"use client";

import {
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  PilotThemeRoot,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  WEBSHOP_ORDER_STATUS_LABELS,
  type WebshopStaleThreshold,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { webshopOrdersApi } from "@/lib/api/webshop-orders";

/**
 * A WEBSHOP RENDELÉSEK ELAVULÁSI KÜSZÖBEI (Rendelések, 7. PR; a prompt 17.
 * pontja). Státuszonként érték, egység (óra vagy nap) és figyelés be/ki. Ha a
 * figyelést kikapcsolják, az érték megmarad, és átírható (Balázs,
 * 2026-09-02); nulla nem írható be, a kikapcsolás a kapcsoló dolga.
 *
 * Olvasni a rendelések olvasója tudja, menteni a rendelés kezelője.
 */
export function StaleThresholdsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_MANAGE),
  );
  const [rows, setRows] = useState<WebshopStaleThreshold[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canView) return;
    setError(null);
    try {
      setRows(await webshopOrdersApi.staleThresholds(token));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A küszöbök nem tölthetők be.",
      );
    }
  }, [canView, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = (index: number, patch: Partial<WebshopStaleThreshold>) => {
    setSaved(false);
    setRows((current) =>
      current
        ? current.map((row, at) => (at === index ? { ...row, ...patch } : row))
        : current,
    );
  };
  const invalid = rows?.some(
    (row) => !(Number.isInteger(row.value) && row.value >= 1),
  );
  const save = async () => {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      setRows(await webshopOrdersApi.saveStaleThresholds(token, rows));
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  /*
    A PILOT TOKENEKEN ÁLL, mint a Rendelések többi lapja: a sötét mód a
    `PilotThemeRoot` témájával együtt vált (a prompt 18. pontja).
  */
  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Rendelések elavulása"
        description="Mennyi idő után jelezze a Rendelések lista, hogy egy rendelés túl sokáig áll egy státuszban."
      />
      {!canView ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs hozzáférésed a rendelésekhez
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
        >
          {error}
        </p>
      ) : null}
      {canView && !rows && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}
      {rows ? (
        <PilotCard className="space-y-4 p-5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-pilot-grey-500">
                <th className="py-2 pr-3 font-medium">Státusz</th>
                <th className="py-2 pr-3 font-medium">Érték</th>
                <th className="py-2 pr-3 font-medium">Egység</th>
                <th className="py-2 font-medium">Figyelés</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const label = WEBSHOP_ORDER_STATUS_LABELS[row.status];
                return (
                  <tr key={row.status}>
                    <td className="py-2 pr-3 text-pilot-grey-900">{label}</td>
                    <td className="py-2 pr-3">
                      <PilotInput
                        type="number"
                        min={1}
                        aria-label={`${label}: érték`}
                        value={String(row.value)}
                        disabled={!canManage}
                        onChange={(value) =>
                          change(index, { value: Number(value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <PilotSelect
                        chevron
                        aria-label={`${label}: egység`}
                        value={row.unit}
                        disabled={!canManage}
                        onChange={(value) =>
                          change(index, {
                            unit: value as WebshopStaleThreshold["unit"],
                          })
                        }
                      >
                        <option value="HOUR">óra</option>
                        <option value="DAY">nap</option>
                      </PilotSelect>
                    </td>
                    <td className="py-2">
                      <label className="flex items-center gap-2 text-pilot-grey-700">
                        <input
                          type="checkbox"
                          aria-label={`${label}: figyelés`}
                          checked={row.enabled}
                          disabled={!canManage}
                          onChange={(event) =>
                            change(index, { enabled: event.target.checked })
                          }
                        />
                        {row.enabled ? "be" : "ki"}
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {invalid ? (
            <p className="text-sm text-pilot-red-700">
              Az érték legalább 1. A figyelést a kapcsolóval lehet kikapcsolni.
            </p>
          ) : null}
          {canManage ? (
            <div className="flex items-center gap-3">
              <PilotButton
                disabled={busy || invalid}
                onClick={() => void save()}
              >
                Mentés
              </PilotButton>
              {saved ? (
                <span role="status" className="text-sm text-pilot-grey-600">
                  Mentve.
                </span>
              ) : null}
            </div>
          ) : null}
        </PilotCard>
      ) : null}
    </PilotThemeRoot>
  );
}
