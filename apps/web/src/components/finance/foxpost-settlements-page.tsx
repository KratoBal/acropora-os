"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type FoxpostMonthlyReportSummary,
  type FoxpostSettlementDetail,
  type FoxpostSettlementLine,
  type FoxpostSettlementListResponse,
  type FoxpostSettlementStatus,
  type FoxpostSyncState,
  type FoxpostSyncStatus,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { foxpostSettlementsApi } from "@/lib/api/foxpost-settlements";

function formatAmount(value?: string): string {
  if (value === undefined) return "—";
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

function formatDate(value?: string): string {
  return value
    ? new Date(value).toLocaleDateString("hu-HU", { timeZone: "UTC" })
    : "—";
}

function settlementStatus(status: FoxpostSettlementStatus) {
  switch (status) {
    case "COMPLETED":
      return <Badge variant="success">Kész</Badge>;
    case "NEEDS_REVIEW":
      return <Badge variant="warning">Ellenőrzendő</Badge>;
    case "ERROR":
      return <Badge variant="danger">Hiba</Badge>;
    default:
      return <Badge variant="info">Feldolgozás</Badge>;
  }
}

function lineStatus(status: string) {
  if (status === "MATCHED") return <Badge variant="success">Párosítva</Badge>;
  if (status === "ORDER_NOT_FOUND")
    return <Badge variant="danger">Rendelés nem található</Badge>;
  return <Badge variant="warning">Számla még nincs</Badge>;
}

function lineResolution(line: FoxpostSettlementLine) {
  if (line.resolutionSource === "MANUAL")
    return <Badge variant="info">Kézzel jóváhagyva</Badge>;
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Foxpost elszámolások"
        description="A Foxpost heti elszámolása: egy levélben az utánvét-tételek (XLSX) és a Foxpost számlája (PDF). Az utánvét soronként a kimenő számlához kötve; a Foxpost díja az utalásból levonva."
        actions={
          canManage && syncStatus?.canRunNow ? (
            <Button onClick={() => void sync()} disabled={working}>
              {working ? "Feldolgozás…" : "Gmail ellenőrzése most"}
            </Button>
          ) : undefined
        }
      />

      {syncStatus && syncStatus.state !== "ENABLED" ? (
        <Alert
          variant="info"
          title="Az automatikus Gmail-behúzás ki van kapcsolva"
          description={`Ok: ${SYNC_OFF[syncStatus.state]}. ${
            syncStatus.canRunNow
              ? "Addig a „Gmail ellenőrzése most” gombbal húzd be a leveleket."
              : "Gmail-kulcs nélkül kézzel sem húzhatók be a levelek."
          }`}
        />
      ) : null}
      {syncStatus?.state === "ENABLED" ? (
        <p className="text-sm text-dusk-600">
          Automatikus Gmail-behúzás: {syncStatus.intervalMinutes} percenként.{" "}
          {syncStatus.lastRun
            ? `Utolsó futás: ${new Date(syncStatus.lastRun.startedAt).toLocaleString("hu-HU")}, ${
                syncStatus.lastRun.status === "FAILED"
                  ? `sikertelen (${syncStatus.lastRun.errorCode ?? "ismeretlen hiba"})`
                  : `${syncStatus.lastRun.createdCount} új elszámolás`
              }.`
            : "Még nem futott."}
        </p>
      ) : null}
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

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-dusk-900">
            Havi könyvelési fájl
          </h2>
          <span className="text-xs text-dusk-500">
            Valódi dátum- és számértékekkel
          </span>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="month"
              aria-label="A riport hónapja"
              className="rounded-md border border-dusk-300 bg-white px-2 py-1.5 text-sm text-dusk-900"
              value={reportMonth}
              onChange={(event) => setReportMonth(event.target.value)}
            />
            <Button
              variant="secondary"
              onClick={() =>
                selectedReport ? void download(selectedReport) : undefined
              }
              disabled={!selectedReport || downloadingId !== null}
            >
              {selectedReport && downloadingId === selectedReport.id
                ? "Letöltés…"
                : "XLSX letöltése"}
            </Button>
          </div>
          {loading && !reports.length ? <Skeleton className="h-5" /> : null}
          {!loading && !selectedReport ? (
            <p className="text-sm text-dusk-500">
              Erre a hónapra még nincs feldolgozott Foxpost riport.
            </p>
          ) : null}
          {selectedReport ? (
            <p className="text-sm text-dusk-600">
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
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-dusk-900">
            Utánvét-utalások
          </h2>
          <span className="text-xs text-dusk-500">
            {data?.pagination.totalItems ?? 0} utalás
          </span>
        </CardHeader>
        <CardContent>
          {loading && !data ? <Skeleton className="h-56" /> : null}
          {data && data.items.length === 0 ? (
            <EmptyState
              title="Még nincs Foxpost utánvét-utalás"
              description="A Gmail ellenőrzése után itt jelennek meg a heti XLSX + PDF párok."
            />
          ) : null}
          {data?.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                  <tr>
                    <th className="p-3">Kelte</th>
                    <th>Elszámolás</th>
                    <th className="text-right">Beszedett</th>
                    <th className="text-right">Utalt</th>
                    <th className="text-right">Párosítva</th>
                    <th className="p-3">Állapot</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-dusk-50"
                      onClick={() => void openDetail(item.id)}
                    >
                      <td className="p-3">
                        {formatDate(item.invoiceIssueDate)}
                      </td>
                      <td className="font-mono text-xs">
                        {item.settlementCode ?? "—"}
                      </td>
                      <td className="text-right">
                        {formatAmount(item.collectedAmount)}
                      </td>
                      <td className="text-right">
                        {formatAmount(item.transferredAmount)}
                      </td>
                      <td className="text-right">
                        {item.matchedLineCount} /{" "}
                        {item.matchedLineCount + item.unresolvedLineCount}
                      </td>
                      <td className="p-3">{settlementStatus(item.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader>
            <div>
              <h2 className="text-sm font-semibold text-dusk-900">
                {selected.settlementCode ?? "Ismeretlen elszámolás"} részletei
              </h2>
              <p className="mt-1 text-xs text-dusk-500">
                {selected.xlsxFileName} + {selected.pdfFileName}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {settlementStatus(selected.status)}
              {canManage && selected.status !== "COMPLETED" ? (
                <Button
                  size="sm"
                  onClick={() => void reprocess()}
                  disabled={working}
                >
                  Újrafeldolgozás
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected.errorCode ? (
              <Alert
                variant="info"
                title="Ellenőrzés szükséges"
                description="Add meg a helyes számlaszámot az érintett sornál. Ha a Foxpost referencia már maga a számlaszám, a mező előre kitöltve jelenik meg; ellenőrzés után hagyd jóvá."
              />
            ) : null}
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <span className="text-dusk-500">Időszak:</span>{" "}
                {formatDate(selected.periodStart)} –{" "}
                {formatDate(selected.periodEnd)}
              </div>
              <div>
                <span className="text-dusk-500">Beszedett:</span>{" "}
                {formatAmount(selected.collectedAmount)}
              </div>
              <div>
                <span className="text-dusk-500">Foxpost számla:</span>{" "}
                {selected.invoiceNumber ?? "—"} (
                {formatAmount(selected.invoiceGrossAmount)})
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                  <tr>
                    <th className="p-3">Referencia kód</th>
                    <th>Címzett</th>
                    <th>Tranzakció napja</th>
                    <th className="text-right">Összeg</th>
                    <th className="pl-4">Kimenő számla / kézi jóváhagyás</th>
                    <th className="p-3">Párosítás</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line) => (
                    <tr key={line.id} className="border-b last:border-0">
                      <td className="p-3 font-mono text-xs">
                        {line.referenceCode}
                      </td>
                      <td>{line.recipientName ?? "—"}</td>
                      <td>{formatDate(line.transactionDate)}</td>
                      <td className="text-right">
                        {formatAmount(line.collectedAmount)}
                      </td>
                      <td className="py-2 pl-4 pr-3">
                        {line.status !== "MATCHED" && canManage ? (
                          <div className="flex min-w-[290px] flex-wrap items-center gap-2">
                            <input
                              aria-label={`Számlaszám – ${line.referenceCode}`}
                              className="min-w-0 flex-1 rounded-md border border-dusk-300 bg-white px-2 py-1.5 font-mono text-xs text-dusk-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              value={invoiceDrafts[line.id] ?? ""}
                              placeholder={line.referenceCode}
                              maxLength={100}
                              onChange={(event) =>
                                setInvoiceDrafts((current) => ({
                                  ...current,
                                  [line.id]: event.target.value,
                                }))
                              }
                            />
                            <Button
                              size="sm"
                              onClick={() => void approveLine(line)}
                              disabled={
                                working ||
                                !(invoiceDrafts[line.id] ?? "").trim()
                              }
                            >
                              Jóváhagyás
                            </Button>
                            {line.referenceInvoiceMissing ? (
                              <p className="w-full text-xs text-amber-700">
                                Ilyen kimenő számla nálunk nincs: ellenőrizd a
                                számlaszámot jóváhagyás előtt.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <div>
                            <span className="font-mono text-xs">
                              {line.invoiceNumber ?? "—"}
                            </span>
                            {line.manualApprovedByDisplayName ? (
                              <p className="mt-1 text-xs text-dusk-500">
                                {line.manualApprovedByDisplayName} ·{" "}
                                {formatDate(line.manualApprovedAt)}
                              </p>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="p-3">{lineResolution(line)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
