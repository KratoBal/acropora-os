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
  type GlsCodLineError,
  type GlsCodReportDetail,
  type GlsCodReportLine,
  type GlsCodReportListResponse,
  type GlsCodReportStatus,
  type GlsCodReportSummary,
  type GlsInvoiceSummary,
  type GlsSyncState,
  type GlsSyncStatus,
} from "@acropora/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { glsSettlementsApi } from "@/lib/api/gls-settlements";

import {
  SettlementApproveField,
  SettlementMonthCard,
  SettlementMonthInput,
  monthCovered,
  settlementRange,
  SETTLEMENT_PAGE_SIZE,
  SETTLEMENT_RECENT_SIZE,
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

function reportStatus(status: GlsCodReportStatus) {
  return status === "COMPLETED" ? (
    <PilotBadge variant="success">Kész</PilotBadge>
  ) : (
    <PilotBadge variant="amber">Ellenőrzendő</PilotBadge>
  );
}

/** Why a line waits for a person, in the words the person needs. */
const LINE_ERRORS: Record<GlsCodLineError, string> = {
  INVOICE_NOT_FOUND: "Nincs ilyen kimenő számla",
  ORDER_NOT_FOUND: "A rendelés nincs a rendszerben",
  ORDER_NOT_INVOICED: "A rendelésnek még nincs számlája",
  PREFIX_MISSING: "Előtag nélküli számlaszám",
  REFERENCE_UNKNOWN: "Ismeretlen hivatkozás",
};

function lineResolution(line: GlsCodReportLine) {
  if (line.resolutionSource === "MANUAL")
    return <PilotBadge variant="blue">Kézzel jóváhagyva</PilotBadge>;
  if (line.status === "RESOLVED")
    return (
      <PilotBadge variant="success">
        {line.resolutionSource === "ORDER_KEY"
          ? "Párosítva rendelésből"
          : "Párosítva"}
      </PilotBadge>
    );
  return (
    <PilotBadge variant="amber">
      {line.errorCode ? LINE_ERRORS[line.errorCode] : "Ellenőrzendő"}
    </PilotBadge>
  );
}

/**
 * Why the Gmail pull does not run, said on the page: the Foxpost pull was off
 * for seven weeks and nothing showed it (production, 2026-09-29).
 */
const SYNC_OFF: Record<Exclude<GlsSyncState, "ENABLED">, string> = {
  DISABLED_NOT_SET: "a kapcsoló (GMAIL_GLS_SYNC_ENABLED) nincs beállítva",
  DISABLED_OFF: "a kapcsoló (GMAIL_GLS_SYNC_ENABLED) értéke false",
  DISABLED_UNRECOGNISED:
    "a kapcsoló (GMAIL_GLS_SYNC_ENABLED) értéke se nem true, se nem false",
  NO_KEY: "be van kapcsolva, de nincs Gmail-kulcs",
};

function drafts(detail: GlsCodReportDetail): Record<string, string> {
  return Object.fromEntries(
    detail.lines.map((line) => [line.id, line.suggestedInvoiceNumber ?? ""]),
  );
}

export function GlsSettlementsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  const [data, setData] = useState<GlsCodReportListResponse | null>(null);
  const [recent, setRecent] = useState<GlsCodReportListResponse | null>(null);
  const [invoices, setInvoices] = useState<GlsInvoiceSummary[]>([]);
  const [syncStatus, setSyncStatus] = useState<GlsSyncStatus | null>(null);
  const [selected, setSelected] = useState<GlsCodReportDetail | null>(null);
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
      const [reports, latest, glsInvoices, status] = await Promise.all([
        glsSettlementsApi.list(token, {
          page: listPage,
          pageSize: SETTLEMENT_PAGE_SIZE,
        }),
        // the monthly summary's window: the latest ones, newest first
        glsSettlementsApi.list(token, {
          page: 1,
          pageSize: SETTLEMENT_RECENT_SIZE,
        }),
        glsSettlementsApi.invoices(token),
        glsSettlementsApi.syncStatus(token),
      ]);
      setData(reports);
      setRecent(latest);
      setInvoices(glsInvoices);
      setSyncStatus(status);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A GLS elszámolások nem tölthetők be.",
      );
    } finally {
      setLoading(false);
    }
  }, [canView, token, listPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = (detail: GlsCodReportDetail) => {
    setSelected(detail);
    setInvoiceDrafts(drafts(detail));
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
      const list = [...(files ?? [])];
      const results: string[] = [];
      for (const file of list) {
        const result = await glsSettlementsApi.upload(token, file);
        const kind = {
          COD_REPORT: "utánvét-részletező",
          INVOICE_ATTACHMENT: "számlamelléklet",
          COMPENSATION_LETTER: "kompenzációs értesítő",
        }[result.kind];
        results.push(
          result.duplicate
            ? `${file.name}: ez a ${kind} már bent volt.`
            : result.kind === "COMPENSATION_LETTER"
              ? `${file.name}: ${kind} beolvasva, a havi fájlban az utalás napjához kerül.`
              : `${file.name}: ${kind} beolvasva, ${result.newlyResolvedLineCount} sor párosítva.`,
        );
      }
      setNotice(results.join(" "));
      if (fileInput.current) fileInput.current.value = "";
      await load();
    }, "A feltöltés nem sikerült.");

  const syncNow = () =>
    run(async () => {
      const result = await glsSettlementsApi.syncNow(token);
      setNotice(
        `Gmail ellenőrzés kész: ${result.messagesSeen} GLS-levél, ${result.documentsRead} új dokumentum, ${result.duplicateCount} már bent volt, ${result.failedCount} nem olvasható.`,
      );
      await load();
    }, "A Gmail ellenőrzése nem sikerült.");

  const openDetail = async (id: string) => {
    setError(null);
    try {
      show(await glsSettlementsApi.detail(token, id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A részletek nem tölthetők be.",
      );
    }
  };

  const approveLine = (line: GlsCodReportLine) =>
    run(async () => {
      if (!selected) return;
      const invoiceNumber = (invoiceDrafts[line.id] ?? "").trim();
      if (!invoiceNumber) {
        setError("A jóváhagyáshoz add meg a számlaszámot.");
        return;
      }
      const detail = await glsSettlementsApi.approveLine(
        token,
        selected.id,
        line.id,
        { invoiceNumber, expectedUpdatedAt: line.updatedAt },
      );
      show(detail);
      setNotice(
        detail.status === "COMPLETED"
          ? "A tétel jóváhagyva, az utalás minden sora párosítva."
          : "A tétel jóváhagyva; maradt még ellenőrzendő sor.",
      );
      await load();
    }, "A tétel jóváhagyása nem sikerült.");

  const reprocess = () =>
    run(async () => {
      if (!selected) return;
      const detail = await glsSettlementsApi.reprocess(token, selected.id);
      show(detail);
      setNotice(
        detail.status === "COMPLETED"
          ? "Az utalás minden sora párosítva."
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
      await glsSettlementsApi.downloadReport(token, year, month);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A riport nem tölthető le.",
      );
    } finally {
      setDownloading(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a GLS elszámolásokhoz"
        description="A megtekintéshez finance.view jogosultság szükséges."
      />
    );

  const alerts = (
    <>
      {notice ? (
        <Alert variant="info" title="GLS" description={notice} />
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

  const invoiceColumns: PilotTableColumn<GlsInvoiceSummary>[] = [
    {
      id: "number",
      header: "Számlaszám",
      width: "26%",
      cell: (invoice) => (
        <span className="font-semibold text-pilot-grey-900">
          {invoice.invoiceNumber}
        </span>
      ),
    },
    {
      id: "date",
      header: "Kelte",
      width: "18%",
      cell: (invoice) => formatDate(invoice.invoiceDate),
    },
    {
      id: "parcels",
      header: "Csomag",
      align: "right",
      width: "14%",
      cell: (invoice) => invoice.parcelCount,
    },
    {
      id: "fee",
      header: "Díj",
      align: "right",
      width: "21%",
      cell: (invoice) => formatAmount(invoice.feeTotal),
    },
    {
      id: "card",
      header: "Kártyadíj",
      align: "right",
      width: "21%",
      cell: (invoice) => formatAmount(invoice.cardFeeTotal),
    },
  ];

  /*
    A RÉSZLET A LISTA HELYÉN (Figma 618:2268): ugyanazon az útvonalon egy
    kiválasztott állapot, saját fejléccel és „Vissza a listához” gombbal.
  */
  if (selected) {
    const lineColumns: PilotTableColumn<GlsCodReportLine>[] = [
      {
        id: "parcel",
        header: "Csomagszám",
        width: "14%",
        cell: (line) => (
          <span className="font-semibold text-pilot-grey-900">
            {line.parcelNumber}
          </span>
        ),
      },
      {
        id: "cod",
        header: "Utánvét-hiv.",
        width: "15%",
        cell: (line) => line.codReference ?? "—",
      },
      {
        id: "client",
        header: "Ügyfélhiv.",
        width: "11%",
        cell: (line) => line.clientReference ?? "—",
      },
      {
        id: "amount",
        header: "Összeg",
        align: "right",
        width: "11%",
        cell: (line) => (
          <span className="font-semibold text-pilot-grey-900">
            {formatAmount(line.amount)}
          </span>
        ),
      },
      {
        id: "invoice",
        header: "Kimenő számla / kézi jóváhagyás",
        width: "32%",
        cell: (line) =>
          line.status !== "RESOLVED" && canManage ? (
            <SettlementApproveField
              label={`Számlaszám – ${line.parcelNumber}`}
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
        width: "17%",
        cell: lineResolution,
      },
    ];
    const open = selected.lineCount - selected.resolvedLineCount;
    return (
      <PilotThemeRoot className="space-y-6">
        <PilotPageHeader
          title={`GLS utalás · ${formatDate(selected.transferDate)}`}
          description={`${selected.fileName} · heti utánvét-részletező`}
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
            { label: "Összeg", value: formatAmount(selected.total) },
            { label: "Csomag", value: selected.lineCount },
            {
              label: "Párosítva",
              value: `${selected.resolvedLineCount} / ${selected.lineCount}`,
            },
            { label: "Utalás napja", value: formatDate(selected.transferDate) },
            {
              label: "Állapot",
              value: selected.status === "COMPLETED" ? "Kész" : "Ellenőrzendő",
            },
          ]}
        />
        {selected.status !== "COMPLETED" ? (
          <SettlementNotice
            tone="check"
            title={`${open.toLocaleString("hu-HU")} csomag számlaszáma ellenőrzendő`}
          >
            Add meg a helyes számlaszámot az érintett sornál. Ahol van javaslat
            (például előtag nélküli számlaszám előtaggal), a mező előre ki van
            töltve: ellenőrzés után hagyd jóvá.
          </SettlementNotice>
        ) : null}
        <SettlementTableCard>
          <PilotDataTable
            columns={lineColumns}
            rows={selected.lines}
            rowKey={(line) => line.id}
            rowTestId="gls-sor"
            minWidth={1040}
          />
        </SettlementTableCard>
        <SettlementTableCard
          title="GLS díjszámlák"
          subtitle="A díj nem az utánvétből kerül levonásra: külön GLS számlák."
        >
          {invoices.length ? (
            <PilotDataTable
              columns={invoiceColumns}
              rows={invoices}
              rowKey={(invoice) => invoice.id}
              minWidth={720}
            />
          ) : (
            <p className="px-5 pb-4 text-sm text-pilot-grey-500">
              Még nincs feltöltött GLS számlamelléklet.
            </p>
          )}
        </SettlementTableCard>
      </PilotThemeRoot>
    );
  }

  const listColumns: PilotTableColumn<GlsCodReportSummary>[] = [
    {
      id: "date",
      header: "Utalás napja",
      width: "17%",
      cell: (item) => formatDate(item.transferDate),
    },
    {
      id: "file",
      header: "Fájl",
      width: "33%",
      cell: (item) => item.fileName,
    },
    {
      id: "total",
      header: "Összeg",
      width: "17%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatAmount(item.total)}
        </span>
      ),
    },
    {
      id: "matched",
      header: "Párosítva",
      width: "15%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {item.resolvedLineCount} / {item.lineCount}
        </span>
      ),
    },
    {
      id: "status",
      header: "Állapot",
      width: "18%",
      cell: (item) => reportStatus(item.status),
    },
  ];
  // a havi kártya sora a betöltött listából: a hónap utalásai és díjszámlái
  const covered = recent
    ? monthCovered(recent, reportMonth, (item) => item.transferDate)
    : false;
  const inMonth = (recent?.items ?? []).filter((item) =>
    item.transferDate.startsWith(reportMonth),
  );
  const monthInvoices = invoices.filter((invoice) =>
    invoice.invoiceDate?.startsWith(reportMonth),
  );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Elszámolások"
        description="Utánvétek és fizetési szolgáltatói kimutatások automatikus párosítással. A GLS heti utánvét-részletezője, kéthetes számlamelléklete és kompenzációs értesítője: az utánvét soronként a kimenő számlához kötve, a díjszámla külön, a kompenzáció az utalásból levonva."
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
                accept=".xlsx,.pdf"
                multiple
                className="hidden"
                aria-label="GLS fájlok feltöltése"
                onChange={(event) => void upload(event.target.files)}
              />
              <PilotButton
                size="regular"
                onClick={() => fileInput.current?.click()}
                disabled={working}
              >
                {working ? "Feldolgozás…" : "GLS fájl feltöltése"}
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
                          : `${syncStatus.lastScheduledRun.documentsRead} új dokumentum`
                      }.`
                    : "Automatikus futás még nincs rögzítve."
                }`
              : `Ok: ${SYNC_OFF[syncStatus.state]}. A GLS-fájlokat addig kézzel töltsd fel.`
          }
        />
      ) : null}
      {alerts}
      <SettlementMonthCard
        title="Havi könyvelési fájl"
        subtitle="Utalásonként a kifizetett számlák, a GLS díjszámlák külön lapon"
        summary={
          recent
            ? `${
                covered
                  ? ""
                  : `A legutóbbi ${recent.items.length} utalásból, a hónap régebbi utalásai nélkül: `
              }${inMonth.length} utánvét-utalás · ${inMonth
                .reduce((sum, item) => sum + item.lineCount, 0)
                .toLocaleString(
                  "hu-HU",
                )} csomag · ${monthInvoices.length} GLS díjszámla`
            : undefined
        }
        controls={
          <>
            <SettlementMonthInput
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
          title="Még nincs GLS utánvét-utalás"
          description="Töltsd fel a GLS utánvét-részletezőt (XLSX). A számlamelléklet a díjakat és az ügyfélhivatkozást hozza."
        />
      ) : null}
      {data?.items.length ? (
        <SettlementTableCard
          title="Utánvét-utalások"
          count={`${data.pagination.totalItems.toLocaleString("hu-HU")} utalás`}
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
            rowTestId="gls-utalas"
            onRowActivate={(item) => void openDetail(item.id)}
            rowLabel={(item) => `${item.fileName} részletei`}
            minWidth={820}
          />
        </SettlementTableCard>
      ) : null}
    </PilotThemeRoot>
  );
}
