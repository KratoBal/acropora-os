"use client";

import {
  Alert,
  Button,
  EmptyState,
  PilotDataTable,
  PilotPageHeader,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type SimplePayLineError,
  type SimplePayReportDetail,
  type SimplePayReportListResponse,
  type SimplePayReportStatus,
  type SimplePayReportSummary,
  type SimplePaySyncState,
  type SimplePaySyncStatus,
  type SimplePayTransactionLine,
} from "@acropora/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { simplePaySettlementsApi } from "@/lib/api/simplepay-settlements";

import {
  SettlementApproveField,
  SettlementMonthCard,
  SettlementMonthInput,
  settlementPage,
  SettlementNotice,
  SettlementStats,
  SettlementSyncStrip,
  SettlementTableCard,
} from "./settlement-pilot";
import { SettlementTabs } from "./settlement-tabs";

function formatAmount(value?: string): string {
  if (value === undefined) return "—";
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

function formatDate(value?: string): string {
  return value
    ? new Date(value).toLocaleDateString("hu-HU", { timeZone: "UTC" })
    : "—";
}

/** "2026-09-21" .. "2026-09-27", or the report's own day. */
function reportPeriod(report: {
  reportDate?: string;
  periodStart?: string;
  periodEnd?: string;
}): string {
  if (report.periodStart && report.periodEnd)
    return `${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)}`;
  return formatDate(report.reportDate);
}

function reportStatus(status: SimplePayReportStatus) {
  return status === "COMPLETED" ? (
    <PilotBadge variant="success">Kész</PilotBadge>
  ) : (
    <PilotBadge variant="amber">Ellenőrzendő</PilotBadge>
  );
}

/** Why a payment waits for a person, in the words the person needs. */
const LINE_ERRORS: Record<SimplePayLineError, string> = {
  REFERENCE_UNKNOWN: "Az azonosítóból nem olvasható ki a rendelés",
  ORDER_NOT_FOUND: "A rendelés nincs a rendszerben",
  ORDER_AMBIGUOUS: "Több rendelés illik rá",
  AMOUNT_MISMATCH: "A rendelés végösszege más",
  // Luca táblájában ez a "még nem teljesített rendelés" sora
  ORDER_NOT_INVOICED: "A rendelésnek még nincs számlája",
};

function lineResolution(line: SimplePayTransactionLine) {
  if (line.resolutionSource === "MANUAL")
    return <PilotBadge variant="blue">Kézzel jóváhagyva</PilotBadge>;
  if (line.status === "RESOLVED")
    return <PilotBadge variant="success">Párosítva rendelésből</PilotBadge>;
  return (
    <PilotBadge variant="amber">
      {line.errorCode ? LINE_ERRORS[line.errorCode] : "Ellenőrzendő"}
    </PilotBadge>
  );
}

/** Why the Gmail pull does not run, said on the page (the Foxpost lesson). */
const SYNC_OFF: Record<Exclude<SimplePaySyncState, "ENABLED">, string> = {
  DISABLED_NOT_SET: "a kapcsoló (GMAIL_SIMPLEPAY_SYNC_ENABLED) nincs beállítva",
  DISABLED_OFF: "a kapcsoló (GMAIL_SIMPLEPAY_SYNC_ENABLED) értéke false",
  DISABLED_UNRECOGNISED:
    "a kapcsoló (GMAIL_SIMPLEPAY_SYNC_ENABLED) értéke se nem true, se nem false",
  NO_KEY: "be van kapcsolva, de nincs Gmail-kulcs",
};

/**
 * SIMPLEPAY ELSZÁMOLÁS (Balázs, 2026-09-30): a heti forgalmi kimutatás,
 * fizetésenként a webshop-rendeléshez és a kimenő számlájához kötve. Luca
 * kézi táblájának helyébe lép: kimutatásonként a számlák, az összesen, a
 * jutalék és az utalt összeg.
 */
export function SimplePaySettlementsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  const [data, setData] = useState<SimplePayReportListResponse | null>(null);
  const [syncStatus, setSyncStatus] = useState<SimplePaySyncStatus | null>(
    null,
  );
  const [selected, setSelected] = useState<SimplePayReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invoiceDrafts, setInvoiceDrafts] = useState<Record<string, string>>(
    {},
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [reportMonth, setReportMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [downloading, setDownloading] = useState(false);
  const [listPage, setListPage] = useState(1);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [reports, status] = await Promise.all([
        simplePaySettlementsApi.list(token),
        simplePaySettlementsApi.syncStatus(token),
      ]);
      setData(reports);
      setSyncStatus(status);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A SimplePay elszámolások nem tölthetők be.",
      );
    } finally {
      setLoading(false);
    }
  }, [canView, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = (detail: SimplePayReportDetail) => {
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

  const upload = (files: FileList | null) =>
    run(async () => {
      const results: string[] = [];
      for (const file of [...(files ?? [])]) {
        const result = await simplePaySettlementsApi.upload(token, file);
        results.push(
          result.duplicate
            ? `${file.name}: ez a kimutatás már bent volt.`
            : `${file.name}: beolvasva, ${result.resolvedLineCount} / ${result.lineCount} fizetés párosítva.`,
        );
      }
      setNotice(results.join(" "));
      if (fileInput.current) fileInput.current.value = "";
      await load();
    }, "A feltöltés nem sikerült.");

  const syncNow = () =>
    run(async () => {
      const result = await simplePaySettlementsApi.syncNow(token);
      setNotice(
        `Gmail ellenőrzés kész: ${result.messagesSeen} SimplePay-levél, ${result.documentsRead} új kimutatás, ${result.duplicateCount} már bent volt, ${result.failedCount} nem olvasható.`,
      );
      await load();
    }, "A Gmail ellenőrzése nem sikerült.");

  const openDetail = async (id: string) => {
    setError(null);
    try {
      show(await simplePaySettlementsApi.detail(token, id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A részletek nem tölthetők be.",
      );
    }
  };

  const approveLine = (line: SimplePayTransactionLine) =>
    run(async () => {
      if (!selected) return;
      const invoiceNumber = (invoiceDrafts[line.id] ?? "").trim();
      if (!invoiceNumber) {
        setError("A jóváhagyáshoz add meg a számlaszámot.");
        return;
      }
      const detail = await simplePaySettlementsApi.approveLine(
        token,
        selected.id,
        line.id,
        { invoiceNumber, expectedUpdatedAt: line.updatedAt },
      );
      show(detail);
      setNotice(
        detail.status === "COMPLETED"
          ? "A fizetés jóváhagyva, a kimutatás minden sora párosítva."
          : "A fizetés jóváhagyva; maradt még ellenőrzendő sor.",
      );
      await load();
    }, "A fizetés jóváhagyása nem sikerült.");

  const reprocess = () =>
    run(async () => {
      if (!selected) return;
      const detail = await simplePaySettlementsApi.reprocess(
        token,
        selected.id,
      );
      show(detail);
      setNotice(
        detail.status === "COMPLETED"
          ? "A kimutatás minden sora párosítva."
          : "Az újrafeldolgozás lefutott, de maradt ellenőrzendő sor.",
      );
      await load();
    }, "Az újrafeldolgozás nem sikerült.");

  const download = async () => {
    const [year, month] = reportMonth.split("-").map(Number);
    if (!year || !month) return;
    setDownloading(true);
    setError(null);
    try {
      await simplePaySettlementsApi.downloadMonthly(token, year, month);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A havi fájl nem tölthető le.",
      );
    } finally {
      setDownloading(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a SimplePay elszámolásokhoz"
        description="A megtekintéshez finance.view jogosultság szükséges."
      />
    );

  const alerts = (
    <>
      {notice ? (
        <Alert variant="info" title="SimplePay" description={notice} />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="Hiba történt"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
    </>
  );

  /*
    A RÉSZLET A LISTA HELYÉN (Figma 618:2454): ugyanazon az útvonalon egy
    kiválasztott állapot, saját fejléccel és „Vissza a listához” gombbal.
  */
  if (selected) {
    const lineColumns: PilotTableColumn<SimplePayTransactionLine>[] = [
      {
        id: "transaction",
        header: "Tranzakció",
        width: "14%",
        cell: (line) => (
          <span className="font-semibold text-pilot-grey-900">
            {line.merchantTransactionId}
          </span>
        ),
      },
      {
        id: "at",
        header: "Időpont",
        width: "11%",
        cell: (line) => line.transactionAt,
      },
      {
        id: "amount",
        header: "Összeg",
        align: "right",
        width: "10%",
        cell: (line) => (
          <span className="font-semibold text-pilot-grey-900">
            {formatAmount(line.amount)}
          </span>
        ),
      },
      {
        id: "commission",
        header: "Jutalék",
        align: "right",
        width: "8%",
        cell: (line) => formatAmount(line.commission),
      },
      {
        id: "order",
        header: "Rendelés",
        width: "12%",
        cell: (line) => (
          <div>
            {line.orderNumber ?? "—"}
            {line.errorCode === "AMOUNT_MISMATCH" && line.orderTotal ? (
              <p className="mt-1 text-xs text-pilot-grey-500">
                végösszege {formatAmount(line.orderTotal)}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "invoice",
        header: "Kimenő számla / kézi",
        width: "29%",
        cell: (line) =>
          line.status !== "RESOLVED" && canManage ? (
            <SettlementApproveField
              label={`Számlaszám – ${line.merchantTransactionId}`}
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
        width: "16%",
        cell: lineResolution,
      },
    ];
    const open = selected.lineCount - selected.resolvedLineCount;
    return (
      <PilotThemeRoot className="space-y-6">
        <PilotPageHeader
          title={`SimplePay kimutatás · ${reportPeriod(selected)}`}
          description={`${selected.fileName} · heti forgalmi kimutatás`}
          actions={
            <>
              {canManage && selected.status !== "COMPLETED" ? (
                <PilotButton
                  variant="secondary"
                  onClick={() => void reprocess()}
                  disabled={working}
                >
                  Újrafeldolgozás
                </PilotButton>
              ) : null}
              <PilotButton
                variant="secondary"
                onClick={() => setSelected(null)}
              >
                Vissza a listához
              </PilotButton>
            </>
          }
        />
        <SettlementTabs />
        {alerts}
        <SettlementStats
          items={[
            { label: "Összesen", value: formatAmount(selected.amountTotal) },
            { label: "Jutalék", value: formatAmount(selected.commissionTotal) },
            { label: "Utalt", value: formatAmount(selected.netTotal) },
            {
              label: "Párosítva",
              value: `${selected.resolvedLineCount} / ${selected.lineCount}`,
            },
            {
              label: "Állapot",
              value: selected.status === "COMPLETED" ? "Kész" : "Ellenőrzendő",
            },
          ]}
        />
        {selected.status !== "COMPLETED" ? (
          <SettlementNotice
            tone="check"
            title={`${open.toLocaleString("hu-HU")} fizetés kézi ellenőrzést kér`}
          >
            Ahol a párosítás nem sikerült, add meg a kimenő számla számát, és
            hagyd jóvá. A számla nélküli rendelés számlája később is
            megérkezhet: akkor az Újrafeldolgozás párosítja.
          </SettlementNotice>
        ) : null}
        <SettlementTableCard>
          <PilotDataTable
            columns={lineColumns}
            rows={selected.lines}
            rowKey={(line) => line.id}
            rowTestId="simplepay-sor"
            minWidth={1080}
          />
        </SettlementTableCard>
        {selected.warnings.length ? (
          <SettlementNotice tone="info" title="A kimutatás figyelmeztetései">
            {selected.warnings.join(" ")}
          </SettlementNotice>
        ) : null}
      </PilotThemeRoot>
    );
  }

  const listColumns: PilotTableColumn<SimplePayReportSummary>[] = [
    {
      id: "period",
      header: "Időszak",
      width: "20%",
      cell: (item) => reportPeriod(item),
    },
    {
      id: "total",
      header: "Összesen",
      width: "16%",
      cell: (item) => formatAmount(item.amountTotal),
    },
    {
      id: "commission",
      header: "Jutalék",
      width: "14%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatAmount(item.commissionTotal)}
        </span>
      ),
    },
    {
      id: "net",
      header: "Utalt",
      width: "16%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatAmount(item.netTotal)}
        </span>
      ),
    },
    {
      id: "matched",
      header: "Párosítva",
      width: "14%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {item.resolvedLineCount} / {item.lineCount}
        </span>
      ),
    },
    {
      id: "status",
      header: "Állapot",
      width: "20%",
      cell: (item) => reportStatus(item.status),
    },
  ];
  const paged = settlementPage(data?.items ?? [], listPage);
  // a havi kártya sora a betöltött listából: a hónapba eső heti kimutatások
  const inMonth = (data?.items ?? []).filter((item) =>
    (item.periodEnd ?? item.reportDate ?? "").startsWith(reportMonth),
  );
  const sum = (pick: (item: SimplePayReportSummary) => string) =>
    formatAmount(
      String(inMonth.reduce((total, item) => total + Number(pick(item)), 0)),
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Elszámolások"
        description="Utánvétek és fizetési szolgáltatói kimutatások automatikus párosítással. A SimplePay heti forgalmi kimutatása: fizetésenként a webshop-rendelés és a kimenő számla, a jutalék és az utalt összeg."
        actions={
          canManage ? (
            <>
              {syncStatus?.canRunNow ? (
                <PilotButton
                  size="regular"
                  variant="secondary"
                  onClick={() => void syncNow()}
                  disabled={working}
                >
                  Gmail ellenőrzése most
                </PilotButton>
              ) : null}
              <input
                ref={fileInput}
                type="file"
                accept=".csv"
                multiple
                className="hidden"
                aria-label="SimplePay kimutatás feltöltése"
                onChange={(event) => void upload(event.target.files)}
              />
              <PilotButton
                size="regular"
                onClick={() => fileInput.current?.click()}
                disabled={working}
              >
                {working ? "Feldolgozás…" : "Kimutatás feltöltése"}
              </PilotButton>
            </>
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
              : "Az automatikus Gmail-behúzás ki van kapcsolva"
          }
          text={
            syncStatus.state === "ENABLED"
              ? `Automatikus Gmail-behúzás: ${syncStatus.intervalMinutes} percenként. ${
                  syncStatus.lastScheduledRun
                    ? `Utolsó automatikus futás: ${new Date(syncStatus.lastScheduledRun.startedAt).toLocaleString("hu-HU")}, ${
                        syncStatus.lastScheduledRun.status === "FAILED"
                          ? `sikertelen (${syncStatus.lastScheduledRun.errorCode ?? "ismeretlen hiba"})`
                          : `${syncStatus.lastScheduledRun.documentsRead} új kimutatás`
                      }.`
                    : "Automatikus futás még nincs rögzítve."
                }`
              : `Ok: ${SYNC_OFF[syncStatus.state]}. A heti kimutatást (report_ÉÉÉÉHHNN.csv) addig kézzel töltsd fel.`
          }
        />
      ) : null}
      {alerts}
      <SettlementMonthCard
        title="Havi fájl a könyveléshez"
        subtitle="Hetente a kifizetett számlák, összesen, jutalék és utalt, ahogy Luca táblája"
        summary={
          data
            ? `${inMonth.length} heti kimutatás · Összesen ${sum((item) => item.amountTotal)} · Jutalék ${sum((item) => item.commissionTotal)} · Utalt ${sum((item) => item.netTotal)}`
            : undefined
        }
        controls={
          <>
            <SettlementMonthInput
              label="A havi fájl hónapja"
              value={reportMonth}
              onChange={setReportMonth}
            />
            <PilotButton
              variant="secondary"
              onClick={() => void download()}
              disabled={downloading || !reportMonth}
            >
              {downloading ? "Letöltés…" : "XLSX letöltése"}
            </PilotButton>
          </>
        }
      />
      {loading && !data ? <Skeleton className="h-56" /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title="Még nincs SimplePay kimutatás"
          description="Töltsd fel a SimplePay heti forgalmi kimutatását (report_ÉÉÉÉHHNN.csv)."
        />
      ) : null}
      {data?.items.length ? (
        <SettlementTableCard
          title="Heti kimutatások"
          count={`${data.pagination.totalItems.toLocaleString("hu-HU")} kimutatás`}
          paging={{
            page: paged.page,
            totalPages: paged.totalPages,
            range: paged.range,
            onPageChange: setListPage,
          }}
        >
          <PilotDataTable
            columns={listColumns}
            rows={paged.items}
            rowKey={(item) => item.id}
            rowTestId="simplepay-kimutatas"
            onRowActivate={(item) => void openDetail(item.id)}
            rowLabel={(item) => `${reportPeriod(item)} kimutatás részletei`}
            minWidth={860}
          />
        </SettlementTableCard>
      ) : null}
    </PilotThemeRoot>
  );
}
