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
  type FoxpostMonthlyReportSummary,
  type FoxpostSettlementDetail,
  type FoxpostSettlementLine,
  type FoxpostSettlementListResponse,
  type FoxpostSettlementStatus,
  type FoxpostSettlementSummary,
  type FoxpostSyncState,
  type FoxpostSyncStatus,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { foxpostSettlementsApi } from "@/lib/api/foxpost-settlements";

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

const STATUS_LABEL: Record<FoxpostSettlementStatus, string> = {
  COMPLETED: "Kész",
  NEEDS_REVIEW: "Ellenőrzendő",
  ERROR: "Hiba",
  PROCESSING: "Feldolgozás",
};

function settlementStatus(status: FoxpostSettlementStatus) {
  const variant =
    status === "COMPLETED"
      ? "success"
      : status === "NEEDS_REVIEW"
        ? "amber"
        : status === "ERROR"
          ? "danger"
          : "blue";
  return <PilotBadge variant={variant}>{STATUS_LABEL[status]}</PilotBadge>;
}

function lineStatus(status: string) {
  if (status === "MATCHED")
    return <PilotBadge variant="success">Párosítva</PilotBadge>;
  if (status === "ORDER_NOT_FOUND")
    return <PilotBadge variant="danger">Rendelés nem található</PilotBadge>;
  return <PilotBadge variant="amber">Számla még nincs</PilotBadge>;
}

function lineResolution(line: FoxpostSettlementLine) {
  if (line.resolutionSource === "MANUAL")
    return <PilotBadge variant="blue">Kézzel jóváhagyva</PilotBadge>;
  return lineStatus(line.status);
}

/**
 * Why the Gmail pull does not run by itself, said on the page, as on the GLS
 * page. Measured on production 2026-09-29: the Foxpost pull had never run by
 * itself in seven weeks (every run was a manual one), and nothing showed it.
 */
const SYNC_OFF: Record<Exclude<FoxpostSyncState, "ENABLED">, string> = {
  DISABLED_NOT_SET: "a kapcsoló (GMAIL_FOXPOST_SYNC_ENABLED) nincs beállítva",
  DISABLED_OFF: "a kapcsoló (GMAIL_FOXPOST_SYNC_ENABLED) értéke false",
  DISABLED_UNRECOGNISED:
    "a kapcsoló (GMAIL_FOXPOST_SYNC_ENABLED) értéke se nem true, se nem false",
  NO_KEY: "be van kapcsolva, de nincs Gmail-kulcs",
};

/**
 * The field's starting value. The server suggests an invoice number only
 * when it exists here (a bare "2026/00123" gets its prefix only when exactly
 * one series has it); otherwise the raw reference stays, and the line says
 * that we have no such invoice, so a one-click approval never writes a number
 * we do not have without a word.
 */
function suggestedInvoiceNumber(line: FoxpostSettlementLine): string {
  if (line.invoiceNumber) return line.invoiceNumber;
  if (line.suggestedInvoiceNumber) return line.suggestedInvoiceNumber;
  return line.referenceCode.includes("/") ? line.referenceCode : "";
}

function monthKey(report: FoxpostMonthlyReportSummary): string {
  return `${report.year}-${String(report.month).padStart(2, "0")}`;
}

function latestReportMonth(reports: FoxpostMonthlyReportSummary[]): string {
  const keys = reports.map(monthKey).sort();
  return keys.at(-1) ?? new Date().toISOString().slice(0, 7);
}

export function FoxpostSettlementsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  const [data, setData] = useState<FoxpostSettlementListResponse | null>(null);
  const [reports, setReports] = useState<FoxpostMonthlyReportSummary[]>([]);
  const [syncStatus, setSyncStatus] = useState<FoxpostSyncStatus | null>(null);
  const [selected, setSelected] = useState<FoxpostSettlementDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invoiceDrafts, setInvoiceDrafts] = useState<Record<string, string>>(
    {},
  );
  const [reportMonth, setReportMonth] = useState("");
  const [listPage, setListPage] = useState(1);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [settlements, monthlyReports, status] = await Promise.all([
        foxpostSettlementsApi.list(token, { page: 1, pageSize: 50 }),
        foxpostSettlementsApi.reports(token),
        foxpostSettlementsApi.syncStatus(token),
      ]);
      setData(settlements);
      setReports(monthlyReports);
      setSyncStatus(status);
      // A Foxpost riport csak feldolgozott hónapra létezik, ezért a választó a
      // legutóbbi riportra áll, nem a naptári hónapra (a GLS-nél az is jó,
      // mert ott a fájl kéréskor készül).
      setReportMonth((current) => current || latestReportMonth(monthlyReports));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A Foxpost elszámolások nem tölthetők be.",
      );
    } finally {
      setLoading(false);
    }
  }, [canView, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    if (!canManage || working) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await foxpostSettlementsApi.sync(token);
      setNotice(
        `Gmail ellenőrzés kész: ${result.createdCount} új, ${result.skippedCount} már ismert, ${result.needsReviewCount} ellenőrzendő, ${result.failedCount} hibás levél.`,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A Gmail ellenőrzése nem sikerült.",
      );
    } finally {
      setWorking(false);
    }
  };

  const openDetail = async (id: string) => {
    setError(null);
    try {
      const detail = await foxpostSettlementsApi.detail(token, id);
      setSelected(detail);
      setInvoiceDrafts(
        Object.fromEntries(
          detail.lines.map((line) => [line.id, suggestedInvoiceNumber(line)]),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A részletek nem tölthetők be.",
      );
    }
  };

  const approveLine = async (line: FoxpostSettlementLine) => {
    if (!selected || !canManage || working) return;
    const invoiceNumber = (invoiceDrafts[line.id] ?? "").trim();
    if (!invoiceNumber) {
      setError("A jóváhagyáshoz add meg a számlaszámot.");
      return;
    }
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await foxpostSettlementsApi.approveLine(
        token,
        selected.id,
        line.id,
        { invoiceNumber, expectedUpdatedAt: line.updatedAt },
      );
      setSelected(result.settlement);
      setInvoiceDrafts(
        Object.fromEntries(
          result.settlement.lines.map((item) => [
            item.id,
            suggestedInvoiceNumber(item),
          ]),
        ),
      );
      setNotice(
        result.settlement.status === "COMPLETED"
          ? "A tétel jóváhagyva, az elszámolás elkészült és a havi XLSX frissült."
          : "A tétel jóváhagyva és a havi XLSX frissült; maradt még ellenőrzendő sor.",
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A tétel jóváhagyása nem sikerült.",
      );
    } finally {
      setWorking(false);
    }
  };

  const reprocess = async () => {
    if (!selected || !canManage || working) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await foxpostSettlementsApi.reprocess(token, selected.id);
      setSelected(result.settlement);
      setNotice(
        result.settlement.status === "COMPLETED"
          ? "Az elszámolás párosítása elkészült, a havi riport frissült."
          : "Az újrafeldolgozás lefutott, de maradt ellenőrzendő sor.",
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az újrafeldolgozás nem sikerült.",
      );
    } finally {
      setWorking(false);
    }
  };

  const selectedReport = reports.find(
    (report) => monthKey(report) === reportMonth,
  );

  const download = async (report: FoxpostMonthlyReportSummary) => {
    setDownloadingId(report.id);
    setError(null);
    try {
      await foxpostSettlementsApi.downloadReport(token, report);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A riport nem tölthető le.",
      );
    } finally {
      setDownloadingId(null);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a Foxpost elszámolásokhoz"
        description="A megtekintéshez finance.view jogosultság szükséges."
      />
    );

  const alerts = (
    <>
      {notice ? (
        <Alert variant="info" title="Foxpost" description={notice} />
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
    A RÉSZLET A LISTA HELYÉN (Figma 618:2082): ugyanazon az útvonalon egy
    kiválasztott állapot, saját fejléccel és „Vissza a listához” gombbal.
  */
  if (selected) {
    const total = selected.matchedLineCount + selected.unresolvedLineCount;
    const lineColumns: PilotTableColumn<FoxpostSettlementLine>[] = [
      {
        id: "reference",
        header: "Referencia",
        width: "15%",
        cell: (line) => (
          <span className="font-semibold text-pilot-grey-900">
            {line.referenceCode}
          </span>
        ),
      },
      {
        id: "recipient",
        header: "Címzett",
        width: "15%",
        cell: (line) => line.recipientName ?? "—",
      },
      {
        id: "date",
        header: "Tr. napja",
        width: "10%",
        cell: (line) => formatDate(line.transactionDate),
      },
      {
        id: "amount",
        header: "Összeg",
        align: "right",
        width: "11%",
        cell: (line) => (
          <span className="font-semibold text-pilot-grey-900">
            {formatAmount(line.collectedAmount)}
          </span>
        ),
      },
      {
        id: "invoice",
        header: "Kimenő számla / kézi jóváhagyás",
        width: "33%",
        cell: (line) =>
          line.status !== "MATCHED" && canManage ? (
            <SettlementApproveField
              label={`Számlaszám – ${line.referenceCode}`}
              value={invoiceDrafts[line.id] ?? ""}
              placeholder={line.referenceCode}
              disabled={working}
              onChange={(value) =>
                setInvoiceDrafts((current) => ({
                  ...current,
                  [line.id]: value,
                }))
              }
              onApprove={() => void approveLine(line)}
              hint={
                line.referenceInvoiceMissing
                  ? "Ilyen kimenő számla nálunk nincs: ellenőrizd a számlaszámot jóváhagyás előtt."
                  : undefined
              }
            />
          ) : (
            <div>
              <span>{line.invoiceNumber ?? "—"}</span>
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
    return (
      <PilotThemeRoot className="space-y-6">
        <PilotPageHeader
          title={`Foxpost elszámolás · ${selected.settlementCode ?? "ismeretlen"}`}
          description={`${formatDate(selected.periodStart)} – ${formatDate(selected.periodEnd)} · heti XLSX + Foxpost díjszámla`}
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
            {
              label: "Beszedett",
              value: formatAmount(selected.collectedAmount),
            },
            {
              label: "Foxpost számla",
              value: `${formatAmount(selected.invoiceGrossAmount)}${
                selected.invoiceNumber ? ` (${selected.invoiceNumber})` : ""
              }`,
            },
            {
              label: "Utalt",
              value: formatAmount(selected.transferredAmount),
            },
            {
              label: "Párosítva",
              value: `${selected.matchedLineCount} / ${total}`,
            },
            { label: "Állapot", value: STATUS_LABEL[selected.status] },
          ]}
        />
        {selected.errorCode || selected.unresolvedLineCount > 0 ? (
          <SettlementNotice
            tone="check"
            title={`${selected.unresolvedLineCount.toLocaleString("hu-HU")} tétel kézi ellenőrzést kér`}
          >
            Add meg a helyes számlaszámot az érintett sornál. Ha a Foxpost
            referencia már maga a számlaszám, a mező előre kitöltve jelenik meg;
            ellenőrzés után hagyd jóvá.
          </SettlementNotice>
        ) : null}
        <SettlementTableCard>
          <PilotDataTable
            columns={lineColumns}
            rows={selected.lines}
            rowKey={(line) => line.id}
            rowTestId="foxpost-sor"
            minWidth={1040}
          />
        </SettlementTableCard>
        <section className="rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-pilot-grey-900">
            Forrásdokumentumok
          </h2>
          <ul className="mt-2 space-y-1.5 text-xs text-pilot-aqua-700">
            <li>{selected.xlsxFileName}</li>
            <li>{selected.pdfFileName}</li>
            <li>
              Gmail{selected.gmailFrom ? `: ${selected.gmailFrom}` : ""}
              {selected.processedAt
                ? ` · feldolgozva ${new Date(selected.processedAt).toLocaleString("hu-HU")}`
                : ""}
            </li>
          </ul>
        </section>
      </PilotThemeRoot>
    );
  }

  const listColumns: PilotTableColumn<FoxpostSettlementSummary>[] = [
    {
      id: "date",
      header: "Kelte",
      width: "16%",
      cell: (item) => formatDate(item.invoiceIssueDate),
    },
    {
      id: "code",
      header: "Elszámolás",
      width: "18%",
      cell: (item) => item.settlementCode ?? "—",
    },
    {
      id: "collected",
      header: "Beszedett",
      width: "17%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatAmount(item.collectedAmount)}
        </span>
      ),
    },
    {
      id: "transferred",
      header: "Utalt",
      width: "17%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatAmount(item.transferredAmount)}
        </span>
      ),
    },
    {
      id: "matched",
      header: "Párosítva",
      width: "14%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {item.matchedLineCount} /{" "}
          {item.matchedLineCount + item.unresolvedLineCount}
        </span>
      ),
    },
    {
      id: "status",
      header: "Állapot",
      width: "18%",
      cell: (item) => settlementStatus(item.status),
    },
  ];
  const paged = settlementPage(data?.items ?? [], listPage);

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Elszámolások"
        description="Utánvétek és fizetési szolgáltatói kimutatások automatikus párosítással. A Foxpost heti levelében az utánvét-tételek (XLSX) és a Foxpost számlája (PDF); az utánvét soronként a kimenő számlához kötve, a Foxpost díja az utalásból levonva."
        actions={
          canManage && syncStatus?.canRunNow ? (
            <PilotButton
              size="regular"
              onClick={() => void sync()}
              disabled={working}
            >
              {working ? "Feldolgozás…" : "Gmail ellenőrzése most"}
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
              : "Az automatikus Gmail-behúzás ki van kapcsolva"
          }
          text={
            syncStatus.state === "ENABLED"
              ? `Automatikus Gmail-behúzás: ${syncStatus.intervalMinutes} percenként. ${
                  syncStatus.lastScheduledRun
                    ? `Utolsó automatikus futás: ${new Date(syncStatus.lastScheduledRun.startedAt).toLocaleString("hu-HU")}, ${
                        syncStatus.lastScheduledRun.status === "FAILED"
                          ? `sikertelen (${syncStatus.lastScheduledRun.errorCode ?? "ismeretlen hiba"})`
                          : `${syncStatus.lastScheduledRun.createdCount} új elszámolás`
                      }.`
                    : "Automatikus futás még nincs rögzítve."
                }`
              : `Ok: ${SYNC_OFF[syncStatus.state]}. ${
                  syncStatus.canRunNow
                    ? "Addig a „Gmail ellenőrzése most” gombbal húzd be a leveleket."
                    : "Gmail-kulcs nélkül kézzel sem húzhatók be a levelek."
                }`
          }
        />
      ) : null}
      {alerts}
      <SettlementMonthCard
        title="Havi könyvelési fájl"
        subtitle="Valódi dátum- és számértékekkel"
        summary={
          selectedReport ? (
            <>
              {selectedReport.settlementCount} hét /{" "}
              {selectedReport.invoiceCount} számla · Beszedett{" "}
              {formatAmount(selectedReport.collectedAmount)} · Foxpost számla{" "}
              {formatAmount(selectedReport.invoiceGrossAmount)} · Utalt{" "}
              {formatAmount(selectedReport.transferredAmount)}
              {selectedReport.unresolvedLineCount > 0 ? (
                <span className="text-amber-700">
                  {" "}
                  · {selectedReport.unresolvedLineCount} ellenőrzendő tétel a
                  külön munkalapon
                </span>
              ) : null}
            </>
          ) : loading && !reports.length ? (
            <Skeleton className="h-4 w-64" />
          ) : (
            "Erre a hónapra még nincs feldolgozott Foxpost riport."
          )
        }
        controls={
          <>
            <SettlementMonthInput
              value={reportMonth}
              onChange={setReportMonth}
            />
            <PilotButton
              variant="secondary"
              onClick={() =>
                selectedReport ? void download(selectedReport) : undefined
              }
              disabled={!selectedReport || downloadingId !== null}
            >
              {selectedReport && downloadingId === selectedReport.id
                ? "Letöltés…"
                : "XLSX letöltése"}
            </PilotButton>
          </>
        }
      />
      {loading && !data ? <Skeleton className="h-56" /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title="Még nincs Foxpost utánvét-utalás"
          description="A Gmail ellenőrzése után itt jelennek meg a heti XLSX + PDF párok."
        />
      ) : null}
      {data?.items.length ? (
        <SettlementTableCard
          title="Utánvét-utalások"
          count={`${data.pagination.totalItems.toLocaleString("hu-HU")} utalás`}
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
            rowTestId="foxpost-utalas"
            onRowActivate={(item) => void openDetail(item.id)}
            rowLabel={(item) =>
              `${item.settlementCode ?? "Elszámolás"} részletei`
            }
            minWidth={820}
          />
        </SettlementTableCard>
      ) : null}
    </PilotThemeRoot>
  );
}
