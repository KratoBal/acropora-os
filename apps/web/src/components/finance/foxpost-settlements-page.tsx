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

function suggestedInvoiceNumber(line: FoxpostSettlementLine): string {
  if (line.invoiceNumber) return line.invoiceNumber;
  return line.referenceCode.includes("/") ? line.referenceCode : "";
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

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [settlements, monthlyReports] = await Promise.all([
        foxpostSettlementsApi.list(token, { page: 1, pageSize: 50 }),
        foxpostSettlementsApi.reports(token),
      ]);
      setData(settlements);
      setReports(monthlyReports);
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
        description="Az info@acropora.hu Gmail-fiókba egy levélben érkező Foxpost XLSX és PDF automatikus feldolgozása."
        actions={
          canManage ? (
            <Button onClick={() => void sync()} disabled={working}>
              {working ? "Feldolgozás…" : "Gmail ellenőrzése most"}
            </Button>
          ) : undefined
        }
      />

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
          <h2 className="text-sm font-semibold text-slate-900">
            Havi könyvelési fájlok
          </h2>
          <span className="text-xs text-slate-500">
            Valódi dátum- és számértékekkel
          </span>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-20" /> : null}
          {!loading && reports.length === 0 ? (
            <p className="text-sm text-slate-500">
              Még nincs feldolgozott havi Foxpost riport.
            </p>
          ) : null}
          {reports.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Hónap</th>
                    <th>Hetek / számlák</th>
                    <th className="text-right">Beszedett</th>
                    <th className="text-right">Foxpost számla</th>
                    <th className="text-right">Utalt</th>
                    <th className="p-3 text-right">Fájl</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id} className="border-b last:border-0">
                      <td className="p-3 font-semibold text-slate-900">
                        {report.year}. {String(report.month).padStart(2, "0")}.
                      </td>
                      <td>
                        {report.settlementCount} hét / {report.invoiceCount}{" "}
                        számla
                      </td>
                      <td className="text-right">
                        {formatAmount(report.collectedAmount)}
                      </td>
                      <td className="text-right">
                        {formatAmount(report.invoiceGrossAmount)}
                      </td>
                      <td className="text-right">
                        {formatAmount(report.transferredAmount)}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={downloadingId === report.id}
                            onClick={() => void download(report)}
                          >
                            {downloadingId === report.id
                              ? "Letöltés…"
                              : "XLSX letöltése"}
                          </Button>
                          {report.unresolvedLineCount > 0 ? (
                            <span className="text-xs text-amber-700">
                              {report.unresolvedLineCount} ellenőrzendő tétel a
                              külön munkalapon
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">
            Beolvasott heti elszámolások
          </h2>
          <span className="text-xs text-slate-500">
            {data?.pagination.totalItems ?? 0} elszámolás
          </span>
        </CardHeader>
        <CardContent>
          {loading && !data ? <Skeleton className="h-56" /> : null}
          {data && data.items.length === 0 ? (
            <EmptyState
              title="Még nincs Foxpost elszámolás"
              description="A Gmail ellenőrzése után itt jelennek meg a heti XLSX + PDF párok."
            />
          ) : null}
          {data?.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Kelte</th>
                    <th>Elszámolás</th>
                    <th>Foxpost számla</th>
                    <th className="text-right">Beszedett</th>
                    <th className="text-right">Utalt</th>
                    <th className="p-3">Állapot</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
                      onClick={() => void openDetail(item.id)}
                    >
                      <td className="p-3">
                        {formatDate(item.invoiceIssueDate)}
                      </td>
                      <td className="font-mono text-xs">
                        {item.settlementCode ?? "—"}
                      </td>
                      <td className="font-mono text-xs">
                        {item.invoiceNumber ?? "—"}
                      </td>
                      <td className="text-right">
                        {formatAmount(item.collectedAmount)}
                      </td>
                      <td className="text-right">
                        {formatAmount(item.transferredAmount)}
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
              <h2 className="text-sm font-semibold text-slate-900">
                {selected.settlementCode ?? "Ismeretlen elszámolás"} részletei
              </h2>
              <p className="mt-1 text-xs text-slate-500">
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
                <span className="text-slate-500">Időszak:</span>{" "}
                {formatDate(selected.periodStart)} –{" "}
                {formatDate(selected.periodEnd)}
              </div>
              <div>
                <span className="text-slate-500">Beszedett:</span>{" "}
                {formatAmount(selected.collectedAmount)}
              </div>
              <div>
                <span className="text-slate-500">Foxpost számla:</span>{" "}
                {selected.invoiceNumber ?? "—"} (
                {formatAmount(selected.invoiceGrossAmount)})
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Referencia kód</th>
                    <th>Címzett</th>
                    <th>Tranzakció</th>
                    <th>Rendelési számla / kézi jóváhagyás</th>
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
                      <td>
                        {formatDate(line.transactionDate)} ·{" "}
                        {formatAmount(line.collectedAmount)}
                      </td>
                      <td className="py-2 pr-3">
                        {line.status !== "MATCHED" && canManage ? (
                          <div className="flex min-w-[290px] items-center gap-2">
                            <input
                              aria-label={`Számlaszám – ${line.referenceCode}`}
                              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                          </div>
                        ) : (
                          <div>
                            <span className="font-mono text-xs">
                              {line.invoiceNumber ?? "—"}
                            </span>
                            {line.manualApprovedByDisplayName ? (
                              <p className="mt-1 text-xs text-slate-500">
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
