"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type UnasOrderDeletionReconciliationStatus,
  type UnasOrderListItem,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { unasOrdersApi } from "@/lib/api/unas-orders";

function formatHuf(value: string): string {
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

const DETAILED_STATUS = {
  "Feldolgozásra vár": { icon: "●", row: "bg-rose-50", closed: false },
  Visszaigazolva: { icon: "✓", row: "bg-emerald-50", closed: false },
  "Készletezés alatt": { icon: "◆", row: "bg-amber-50", closed: false },
  Kiszállítás: { icon: "➜", row: "bg-orange-50", closed: false },
  Átvehető: { icon: "⌂", row: "bg-sky-50", closed: false },
  "Megrendelés lezárva": { icon: "■", row: "bg-violet-50", closed: true },
  "Sikertelenül lezárt rendelés": {
    icon: "×",
    row: "bg-pink-50",
    closed: true,
  },
} as const;

type DetailedStatus = keyof typeof DETAILED_STATUS;

function isDetailedStatus(label: string | null): label is DetailedStatus {
  return (
    label !== null &&
    Object.prototype.hasOwnProperty.call(DETAILED_STATUS, label)
  );
}

function detailedStatus(order: UnasOrderListItem) {
  return isDetailedStatus(order.unasStatusLabel)
    ? DETAILED_STATUS[order.unasStatusLabel]
    : null;
}

export function formatStatusAge(
  value: string | null,
  now = Date.now(),
): string {
  if (value === null) return "Státuszváltás ideje ismeretlen";
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(value).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  return `${Math.floor(hours / 24)} napja`;
}

function statusVariant(
  order: UnasOrderListItem,
): "success" | "danger" | "neutral" {
  if (order.unasDeletedAt) return "danger";
  if (order.unasStatusLabel === "Sikertelenül lezárt rendelés") return "danger";
  if (order.unasStatusLabel === "Megrendelés lezárva") return "success";
  return "neutral";
}

function statusLabel(order: UnasOrderListItem): string {
  if (order.unasDeletedAt) return "Törölve a UNAS-ban";
  return order.unasStatusLabel ?? "Ismeretlen állapot";
}

function formatOrderDate(order: UnasOrderListItem): string {
  const value = order.orderedAt ?? order.createdAt;
  return new Date(value).toLocaleString("hu-HU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * What the page can say about the deletion check, as one sentence.
 *
 * THREE STATES, NOT TWO. "Not running" and "could not ask" are different
 * things, and collapsing them is the failure this endpoint exists to
 * prevent: a page that cannot reach the status must not imply the check is
 * off, and one that cannot reach it must not imply the check is on either.
 *
 * Pure on purpose - the wording is the part worth asserting, and a pure
 * function can be calibrated without rendering anything.
 */
export type DeletionCheckState =
  UnasOrderDeletionReconciliationStatus | "loading" | "unknown";

export function deletionCheckSentence(
  state: DeletionCheckState,
): string | null {
  if (state === "loading") return null;
  if (state === "unknown")
    return "Törölt rendelések ellenőrzése: az állapotát most nem sikerült lekérdezni.";
  if (!state.enabled)
    return "Törölt rendelések ellenőrzése: nem fut. Az UNAS-ban véglegesen törölt rendelést csak a kézi frissítés találja meg.";

  // `enabled` with no interval is not a state the server produces, but the
  // contract allows it, and a made-up number would be worse than a shorter
  // sentence: it would read as measured.
  if (state.intervalMs === null) return "Törölt rendelések ellenőrzése: fut.";

  const minutes = Math.max(1, Math.round(state.intervalMs / 60_000));
  return `Törölt rendelések ellenőrzése: ${minutes} percenként fut.`;
}

export function WebshopOrdersPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_MANAGE),
  );

  const [orders, setOrders] = useState<UnasOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [deletionCheck, setDeletionCheck] =
    useState<DeletionCheckState>("loading");
  const [view, setView] = useState<"open" | "all">("open");

  const loadOrders = useCallback(() => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    void unasOrdersApi
      .list(token, { page: 1, pageSize: 50 })
      .then((response) => setOrders(response.items))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A rendelések betöltése nem sikerült.",
        ),
      )
      .finally(() => setLoading(false));
  }, [canView, token]);

  useEffect(() => {
    if (!canView) return;
    loadOrders();
  }, [canView, loadOrders]);

  useEffect(() => {
    if (!canView) return;
    void unasOrdersApi
      .deletionReconciliationStatus(token)
      // A FAILED LOOKUP MUST NOT READ AS "OFF". Falling back to a disabled
      // shape here would be the same silence this line exists to break,
      // only louder: the page would state something it never learnt.
      .then(setDeletionCheck)
      .catch(() => setDeletionCheck("unknown"));
  }, [canView, token]);

  const runSync = () => {
    // Matches the button's own `canManage ? ... : undefined` rendering
    // guard - sync is a manage action, not merely a view action.
    if (!canManage || syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    void unasOrdersApi
      .triggerSync(token)
      .then((summary) => {
        setSyncMessage(
          `Szinkron kész: ${summary.createdCount} új, ${summary.updatedCount} frissített, ${summary.reversedCount} sztornózott rendelés.`,
        );
        loadOrders();
      })
      .catch((cause: unknown) =>
        setSyncMessage(
          cause instanceof Error
            ? cause.message
            : "A szinkron indítása nem sikerült.",
        ),
      )
      .finally(() => setSyncing(false));
  };

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a webshop rendelésekhez"
        description="A megnyitáshoz orders.view jogosultság szükséges."
      />
    );
  }

  const visibleOrders = orders.filter(
    (order) => view === "all" || detailedStatus(order)?.closed === false,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webshop rendelések"
        description="A UNAS-ból automatikusan (5 percenként) szinkronizált rendelések"
        actions={
          canManage ? (
            <Button onClick={runSync} disabled={syncing}>
              {syncing ? "Szinkronizálás…" : "Szinkronizálás most"}
            </Button>
          ) : undefined
        }
      />

      {/*
        WHAT THE HEADER ABOVE DOES NOT SAY. It promises an automatic sync
        every five minutes, which is true of the sync itself - but the check
        for orders DELETED in UNAS is a separate worker, off by default, and
        until now nothing on this page said so. Quiet by design: this is a
        standing fact about the system, not an event, so it does not take an
        alert's weight.
      */}
      {deletionCheckSentence(deletionCheck) ? (
        <p className="text-xs text-slate-500">
          {deletionCheckSentence(deletionCheck)}
        </p>
      ) : null}

      {syncMessage ? (
        <Alert variant="info" title="Szinkron" description={syncMessage} />
      ) : null}

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">Rendelések</h2>
          <label className="text-xs text-slate-500">
            Nézet{" "}
            <select
              aria-label="Rendelések nézete"
              value={view}
              onChange={(event) =>
                setView(event.target.value === "all" ? "all" : "open")
              }
            >
              <option value="open">Nyitott</option>
              <option value="all">Összes</option>
            </select>
            {" · "}
            {visibleOrders.length.toLocaleString("hu-HU")} rendelés
          </label>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <Skeleton className="h-4 w-1/3" /> : null}
          {!loading && visibleOrders.length === 0 ? (
            <p className="text-sm text-slate-500">
              Még nincs szinkronizált webshop rendelés.
            </p>
          ) : null}
          {visibleOrders.length > 0 ? (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Azonosító</th>
                      <th className="px-4 py-3">Dátum</th>
                      <th className="px-4 py-3">Vevő</th>
                      <th className="px-4 py-3">Fizetés / szállítás</th>
                      <th className="px-4 py-3 text-right">Összeg</th>
                      <th className="px-5 py-3">Státusz</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {visibleOrders.map((order) => (
                      <tr
                        key={order.id}
                        onClick={() => router.push(`/webshop/${order.id}`)}
                        className={`cursor-pointer transition hover:bg-slate-50 ${detailedStatus(order)?.row ?? "bg-white"}`}
                      >
                        <td className="px-5 py-3 text-sm font-medium text-slate-900">
                          {order.orderNumber}
                          <p className="mt-0.5 text-xs font-normal text-slate-400">
                            {order.lineCount} tétel
                          </p>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {formatOrderDate(order)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {order.buyerName ?? "Ismeretlen vevő"}
                          <span
                            className="ml-2 inline-flex gap-1 text-xs"
                            aria-label="Vevői jelzések"
                          >
                            {order.buyerSignals.isNewCustomer ? (
                              <span title="Első vásárlás">★</span>
                            ) : null}
                            {order.buyerSignals.otherOpenOrderCount > 0 ? (
                              <span title="Másik nyitott rendelés">
                                +{order.buyerSignals.otherOpenOrderCount}
                              </span>
                            ) : null}
                            {order.buyerSignals.otherUnsuccessfulOrderCount >
                            0 ? (
                              <span title="Másik sikertelen rendelés">
                                ×
                                {order.buyerSignals.otherUnsuccessfulOrderCount}
                              </span>
                            ) : null}
                            {!order.buyerSignals.isRegistered ? (
                              <span title="Vendég vásárlás">♧</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {order.paymentName ?? "—"}
                          {order.shippingName ? ` · ${order.shippingName}` : ""}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                          {formatHuf(order.totalGross)}
                        </td>
                        <td className="px-5 py-3">
                          <Badge variant={statusVariant(order)}>
                            {detailedStatus(order)?.icon} {statusLabel(order)}
                          </Badge>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatStatusAge(order.statusChangedAt)}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 md:hidden">
                {visibleOrders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => router.push(`/webshop/${order.id}`)}
                    className={`w-full rounded border p-3 text-left text-sm ${detailedStatus(order)?.row ?? "bg-white"}`}
                  >
                    <p className="font-medium">
                      {detailedStatus(order)?.icon} {statusLabel(order)} ·{" "}
                      {formatStatusAge(order.statusChangedAt)}
                    </p>
                    <p>{order.buyerName ?? "Ismeretlen vevő"}</p>
                    <p className="text-xs text-slate-500">
                      {order.orderNumber}
                    </p>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
