"use client";

import {
  Alert,
  EmptyState,
  PilotDataTable,
  PilotPageHeader,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  formatMoney,
  hasPermission,
  PERMISSIONS,
  type StripeLineError,
  type StripePayoutDetail,
  type StripePayoutError,
  type StripePayoutListResponse,
  type StripePayoutStatus,
  type StripePayoutSummary,
  type StripeSyncState,
  type StripeSyncStatus,
  type StripeTransactionLine,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { stripeSettlementsApi } from "@/lib/api/stripe-settlements";

import {
  SettlementApproveField,
  settlementRange,
  SETTLEMENT_PAGE_SIZE,
  SettlementNotice,
  SettlementStats,
  SettlementSyncStrip,
  SettlementTableCard,
} from "./settlement-pilot";
import { SettlementTabs } from "./settlement-tabs";

function formatDate(value?: string): string {
  return value
    ? new Date(value).toLocaleDateString("hu-HU", { timeZone: "UTC" })
    : "—";
}

function formatDateTime(value?: string): string {
  return value
    ? new Date(value).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })
    : "—";
}

const money = (value: string) =>
  formatMoney(value, "HUF", { fractionDigits: 2 });

function payoutStatus(
  status: StripePayoutStatus,
  errorCode?: StripePayoutError,
) {
  // a manual payout cannot settle by reading again: it is shown under its own name, not as "to check"
  if (errorCode === "MANUAL_PAYOUT")
    return <PilotBadge variant="grey">Kézi kifizetés</PilotBadge>;
  return status === "COMPLETED" ? (
    <PilotBadge variant="success">Kész</PilotBadge>
  ) : (
    <PilotBadge variant="amber">Ellenőrzendő</PilotBadge>
  );
}

/** Why a payout waits for a person, apart from its lines. */
const PAYOUT_ERRORS: Record<StripePayoutError, string> = {
  TOTAL_MISMATCH:
    "A sorok nettója nem egyezik a kifizetett összeggel: hiányozhat tétel",
  MANUAL_PAYOUT:
    "Kézi kifizetés: a Stripe ehhez nem listáz tételeket, a sorokat nem tudjuk betölteni",
  LINES_NOT_READ: "A tételek beolvasása a lapozási határnál megállt",
};

/** Why a line waits for a person, in the words the person needs. */
const LINE_ERRORS: Record<StripeLineError, string> = {
  INTENT_UNKNOWN: "A Stripe-tételhez nem tartozik fizetési azonosító",
  ORDER_NOT_FOUND: "Nincs rendelés, ami ezt a fizetést hordozza",
  ORDERS_NOT_READ:
    "A webshop nem olvasta végig a rendeléseket: ez nem biztos, hogy hiányzó rendelés",
  AMOUNT_MISMATCH: "A rendelés végösszege más, mint amit a Stripe levont",
  ORDER_NOT_INVOICED: "A rendelésnek még nincs számlája",
  REFUND_UNCHECKED:
    "Visszatérítés, de a webshop nem olvasta végig a rendeléseket: a rendelések hiányosak lehetnek, ember dönti el",
  REFUND_INVOICE_NOT_CANCELLED:
    "Teljes visszatérítés, de egy rendelés számlája még él: sztornózni kell",
  REFUND_INVOICE_NOT_CORRECTED:
    "Részleges visszatérítés, de egy rendelés számlája a helyesbítés után nem a megmaradt összegről szól",
  REFUND_AMOUNT_UNEXPLAINED:
    "A befizetések és a visszatérítések különbsége nem nulla és nem a rendelések összege (hiányzó befizetés-sor, vagy a rendelések nincsenek csökkentve)",
  TYPE_UNKNOWN:
    "Nem fizetés és nem díj (vita, korrekció, tartalék): nézd meg a Stripe-ban",
};

const TYPE_LABELS: Record<string, string> = {
  charge: "Fizetés",
  payment: "Fizetés",
  refund: "Visszatérítés",
  payment_refund: "Visszatérítés",
  stripe_fee: "Stripe-díj",
  stripe_fx_fee: "Stripe-díj (átváltás)",
  tax_fee: "Stripe-díj (adó)",
};

function lineResolution(line: StripeTransactionLine) {
  if (line.resolutionSource === "MANUAL")
    return <PilotBadge variant="blue">Kézzel jóváhagyva</PilotBadge>;
  if (line.status === "NOT_APPLICABLE")
    return <PilotBadge variant="grey">Nem rendelés</PilotBadge>;
  if (line.status === "RESOLVED")
    return <PilotBadge variant="success">Párosítva rendelésből</PilotBadge>;
  return (
    <PilotBadge variant="amber">
      {line.errorCode ? LINE_ERRORS[line.errorCode] : "Ellenőrzendő"}
    </PilotBadge>
  );
}

/** Why the pull does not run, said on the page (the Foxpost lesson). */
const SYNC_OFF: Record<Exclude<StripeSyncState, "ENABLED">, string> = {
  DISABLED_NOT_SET: "a Stripe-behúzás kapcsolója nincs beállítva",
  DISABLED_OFF: "a Stripe-behúzás kapcsolója értéke false",
  DISABLED_UNRECOGNISED:
    "a Stripe-behúzás kapcsolója értéke se nem true, se nem false",
};

/**
 * STRIPE ELSZÁMOLÁS (A9, kártya 6339b04c; Balázs, 2026-11-18 20:16 UTC): a Stripe kifizetései (payout), tételenként a
 * webshop-rendeléshez és a kimenő számlájához kötve, a díjjal és a nettóval. A SimplePay lapja mintájára; az OS-nek nincs
 * saját Stripe-kulcsa, az adat a webshopon át jön. Nincs kézi feltöltés (nincs fájl) és nincs havi XLSX (később).
 */
export function StripeSettlementsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  const [data, setData] = useState<StripePayoutListResponse | null>(null);
  const [syncStatus, setSyncStatus] = useState<StripeSyncStatus | null>(null);
  const [selected, setSelected] = useState<StripePayoutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invoiceDrafts, setInvoiceDrafts] = useState<Record<string, string>>(
    {},
  );
  const [listPage, setListPage] = useState(1);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [payouts, status] = await Promise.all([
        stripeSettlementsApi.list(token, {
          page: listPage,
          pageSize: SETTLEMENT_PAGE_SIZE,
        }),
        stripeSettlementsApi.syncStatus(token),
      ]);
      setData(payouts);
      setSyncStatus(status);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A Stripe elszámolások nem tölthetők be.",
      );
    } finally {
      setLoading(false);
    }
  }, [canView, token, listPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = (detail: StripePayoutDetail) => {
    setSelected(detail);
    setInvoiceDrafts({});
  };

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (!canManage || working) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setWorking(false);
    }
  };

  const syncNow = () =>
    run(async () => {
      const result = await stripeSettlementsApi.syncNow(token);
      setNotice(
        `Stripe ellenőrzés kész: ${result.payoutsSeen} kifizetés, ${result.payoutsNew} új, ${result.payoutsReresolved} újrapárosítva, ${result.failedCount} nem sikerült.`,
      );
      await load();
    }, "A Stripe ellenőrzése nem sikerült.");

  const openDetail = async (id: string) => {
    setError(null);
    try {
      show(await stripeSettlementsApi.detail(token, id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A részletek nem tölthetők be.",
      );
    }
  };

  const approveLine = (line: StripeTransactionLine) =>
    run(async () => {
      if (!selected) return;
      const invoiceNumber = (invoiceDrafts[line.id] ?? "").trim();
      if (!invoiceNumber) {
        setError("A jóváhagyáshoz add meg a számlaszámot.");
        return;
      }
      const detail = await stripeSettlementsApi.approveLine(
        token,
        selected.id,
        line.id,
        { invoiceNumber, expectedUpdatedAt: line.updatedAt },
      );
      show(detail);
      setNotice(
        detail.status === "COMPLETED"
          ? "A tétel jóváhagyva, a kifizetés minden sora párosítva."
          : "A tétel jóváhagyva; maradt még ellenőrzendő sor.",
      );
      await load();
    }, "A tétel jóváhagyása nem sikerült.");

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a Stripe elszámolásokhoz"
        description="A megtekintéshez finance.view jogosultság szükséges."
      />
    );

  const alerts = (
    <>
      {notice ? (
        <Alert variant="info" title="Stripe" description={notice} />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="Hiba történt"
          description={error}
          action={
            <PilotButton variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </PilotButton>
          }
        />
      ) : null}
    </>
  );

  /* A RÉSZLET A LISTA HELYÉN: ugyanazon az útvonalon egy kiválasztott állapot, „Vissza a listához” gombbal. */
  if (selected) {
    const lineColumns: PilotTableColumn<StripeTransactionLine>[] = [
      {
        id: "type",
        header: "Tétel",
        width: "13%",
        cell: (line) => (
          <div>
            <span className="font-semibold text-pilot-grey-900">
              {TYPE_LABELS[line.type] ?? line.type}
            </span>
            <p className="mt-1 text-xs text-pilot-grey-500">
              {line.paymentIntentId ?? line.stripeTransactionId}
            </p>
          </div>
        ),
      },
      {
        id: "at",
        header: "Időpont",
        width: "11%",
        cell: (line) => formatDateTime(line.stripeCreatedAt),
      },
      {
        id: "amount",
        header: "Összeg",
        align: "right",
        width: "10%",
        cell: (line) => (
          <span className="font-semibold text-pilot-grey-900">
            {money(line.amount)}
          </span>
        ),
      },
      {
        id: "fee",
        header: "Díj",
        align: "right",
        width: "8%",
        cell: (line) => money(line.fee),
      },
      {
        id: "net",
        header: "Nettó",
        align: "right",
        width: "10%",
        cell: (line) => money(line.net),
      },
      {
        id: "order",
        header: "Rendelés",
        width: "11%",
        cell: (line) => (
          <div>
            {line.orderNumbers.length
              ? line.orderNumbers.map((number) => `#${number}`).join(", ")
              : "—"}
            {line.errorCode === "AMOUNT_MISMATCH" && line.orderTotal ? (
              <p className="mt-1 text-xs text-pilot-grey-500">
                végösszege {money(line.orderTotal)}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "invoice",
        header: "Kimenő számla / kézi",
        width: "22%",
        cell: (line) =>
          line.status === "NEEDS_REVIEW" && canManage ? (
            <SettlementApproveField
              label={`Számlaszám – ${line.stripeTransactionId}`}
              value={invoiceDrafts[line.id] ?? ""}
              placeholder="ACRW-2026/00000"
              disabled={working}
              onChange={(value) =>
                setInvoiceDrafts((current) => ({
                  ...current,
                  [line.id]: value,
                }))
              }
              onApprove={() => void approveLine(line)}
            />
          ) : (
            <div>
              <span>{line.invoiceNumbers.join(", ") || "—"}</span>
              {line.manualApprovedByDisplayName ? (
                <p className="mt-1 text-xs text-pilot-grey-500">
                  {line.manualApprovedByDisplayName} ·{" "}
                  {formatDate(line.manualApprovedAt)}
                </p>
              ) : null}
            </div>
          ),
      },
      {
        id: "resolution",
        header: "Párosítás",
        align: "right",
        width: "15%",
        cell: lineResolution,
      },
    ];
    return (
      <PilotThemeRoot className="space-y-6">
        <PilotPageHeader
          title={`Stripe kifizetés · ${formatDate(selected.arrivalDate)}`}
          description={`${selected.stripePayoutId} · ${selected.lineCount} tétel`}
          actions={
            <PilotButton variant="secondary" onClick={() => setSelected(null)}>
              Vissza a listához
            </PilotButton>
          }
        />
        <SettlementTabs />
        {alerts}
        <SettlementStats
          items={[
            { label: "Kifizetve", value: money(selected.amount) },
            { label: "Bruttó fizetések", value: money(selected.grossTotal) },
            { label: "Visszatérítések", value: money(selected.refundTotal) },
            { label: "Stripe-díj", value: money(selected.feeTotal) },
            { label: "Nettó (sorokból)", value: money(selected.netTotal) },
            {
              label: "Párosítva",
              value: `${selected.resolvedLineCount} / ${selected.lineCount}`,
            },
          ]}
        />
        {selected.errorCode ? (
          <SettlementNotice tone="check" title="A kifizetést ellenőrizni kell">
            {PAYOUT_ERRORS[selected.errorCode]}.
          </SettlementNotice>
        ) : null}
        {selected.unresolvedLineCount > 0 ? (
          <SettlementNotice
            tone="check"
            title={`${selected.unresolvedLineCount.toLocaleString("hu-HU")} tétel kézi ellenőrzést kér`}
          >
            Ahol a párosítás nem sikerült, add meg a kimenő számla számát, és
            hagyd jóvá. A számla nélküli rendelés számlája később is
            megérkezhet: a következő Stripe-ellenőrzés újrapárosítja.
          </SettlementNotice>
        ) : null}
        {selected.ordersTruncated ? (
          <SettlementNotice tone="info" title="A rendelések olvasása megállt">
            A webshop a rendeléseket nem olvasta végig; a „nincs rendelés” sorok
            egy része emiatt lehet.
          </SettlementNotice>
        ) : null}
        <SettlementTableCard>
          <PilotDataTable
            columns={lineColumns}
            rows={selected.lines}
            rowKey={(line) => line.id}
            rowTestId="stripe-sor"
            minWidth={1080}
          />
        </SettlementTableCard>
      </PilotThemeRoot>
    );
  }

  const listColumns: PilotTableColumn<StripePayoutSummary>[] = [
    {
      id: "arrival",
      header: "Kifizetés napja",
      width: "16%",
      cell: (item) => formatDate(item.arrivalDate),
    },
    {
      id: "amount",
      header: "Kifizetve",
      width: "14%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {money(item.amount)}
        </span>
      ),
    },
    {
      id: "gross",
      header: "Bruttó",
      width: "14%",
      cell: (item) => money(item.grossTotal),
    },
    {
      id: "refund",
      header: "Visszatérítés",
      width: "12%",
      cell: (item) => money(item.refundTotal),
    },
    {
      id: "fee",
      header: "Díj",
      width: "10%",
      cell: (item) => money(item.feeTotal),
    },
    {
      id: "matched",
      header: "Párosítva",
      width: "10%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {item.resolvedLineCount} / {item.lineCount}
        </span>
      ),
    },
    {
      id: "status",
      header: "Állapot",
      width: "24%",
      cell: (item) => (
        <div>
          {payoutStatus(item.status, item.errorCode)}
          {item.errorCode ? (
            <p className="mt-1 text-xs text-pilot-grey-500">
              {PAYOUT_ERRORS[item.errorCode]}
            </p>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Elszámolások"
        description="Utánvétek és fizetési szolgáltatói kimutatások automatikus párosítással. A Stripe kifizetései: tételenként a webshop-rendelés és a kimenő számla, a díj és a nettó."
        actions={
          canManage ? (
            <PilotButton
              size="regular"
              onClick={() => void syncNow()}
              disabled={working}
            >
              {working ? "Ellenőrzés…" : "Stripe ellenőrzése most"}
            </PilotButton>
          ) : undefined
        }
      />
      <SettlementTabs />
      {syncStatus ? (
        <SettlementSyncStrip
          active={syncStatus.state === "ENABLED"}
          title={
            syncStatus.state === "ENABLED"
              ? undefined
              : "Az automatikus Stripe-behúzás ki van kapcsolva"
          }
          text={
            syncStatus.state === "ENABLED"
              ? `Automatikus Stripe-behúzás: ${syncStatus.intervalMinutes} percenként. ${
                  syncStatus.lastScheduledRun
                    ? `Utolsó automatikus futás: ${formatDateTime(syncStatus.lastScheduledRun.startedAt)}, ${
                        syncStatus.lastScheduledRun.status === "FAILED"
                          ? `sikertelen (${syncStatus.lastScheduledRun.errorCode ?? "ismeretlen hiba"})`
                          : `${syncStatus.lastScheduledRun.payoutsNew} új kifizetés`
                      }.`
                    : "Automatikus futás még nincs rögzítve."
                }`
              : `Ok: ${SYNC_OFF[syncStatus.state]}. A „Stripe ellenőrzése most” gombbal kézzel is lehúzható.`
          }
        />
      ) : null}
      {alerts}
      {loading && !data ? <Skeleton className="h-56" /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title="Még nincs Stripe-kifizetés"
          description="Ha az automatikus behúzás be van kapcsolva, az első kifizetés a következő futás után jelenik meg; addig a „Stripe ellenőrzése most” gomb lehúzza."
        />
      ) : null}
      {data?.items.length ? (
        <SettlementTableCard
          title="Stripe-kifizetések"
          count={`${data.pagination.totalItems.toLocaleString("hu-HU")} kifizetés`}
          paging={{
            page: data.pagination.page,
            totalPages: data.pagination.totalPages,
            range: settlementRange(data.pagination),
            onPageChange: setListPage,
          }}
        >
          <PilotDataTable
            columns={listColumns}
            rows={data.items}
            rowKey={(item) => item.id}
            rowTestId="stripe-kifizetes"
            onRowActivate={(item) => void openDetail(item.id)}
            rowLabel={(item) =>
              `${formatDate(item.arrivalDate)} kifizetés részletei`
            }
            minWidth={900}
          />
        </SettlementTableCard>
      ) : null}
    </PilotThemeRoot>
  );
}
