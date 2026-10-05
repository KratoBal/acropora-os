"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  Input,
  PageHeader,
  Select,
  Skeleton,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rendelések elavulása"
        description="Mennyi idő után jelezze a Rendelések lista, hogy egy rendelés túl sokáig áll egy státuszban."
      />
      {!canView ? (
        <Alert variant="info" title="Nincs hozzáférésed a rendelésekhez" />
      ) : null}
      {error ? <Alert variant="danger" title={error} /> : null}
      {canView && !rows && !error ? <Skeleton className="h-48" /> : null}
      {rows ? (
        <Card>
          <CardContent className="space-y-4 p-5">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-dusk-500">
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
                      <td className="py-2 pr-3 text-dusk-900">{label}</td>
                      <td className="py-2 pr-3">
                        <Input
                          type="number"
                          min={1}
                          aria-label={`${label}: érték`}
                          value={String(row.value)}
                          disabled={!canManage}
                          onChange={(event) =>
                            change(index, { value: Number(event.target.value) })
                          }
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Select
                          aria-label={`${label}: egység`}
                          value={row.unit}
                          disabled={!canManage}
                          onChange={(event) =>
                            change(index, {
                              unit: event.target
                                .value as WebshopStaleThreshold["unit"],
                            })
                          }
                        >
                          <option value="HOUR">óra</option>
                          <option value="DAY">nap</option>
                        </Select>
                      </td>
                      <td className="py-2">
                        <label className="flex items-center gap-2">
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
              <p className="text-sm text-red-700">
                Az érték legalább 1. A figyelést a kapcsolóval lehet
                kikapcsolni.
              </p>
            ) : null}
            {canManage ? (
              <div className="flex items-center gap-3">
                <Button disabled={busy || invalid} onClick={() => void save()}>
                  Mentés
                </Button>
                {saved ? (
                  <span role="status" className="text-sm text-dusk-600">
                    Mentve.
                  </span>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
