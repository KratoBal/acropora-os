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
      setSelected(await foxpostSettlementsApi.detail(token, id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A részletek nem tölthetők be.",
      );
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
              Még nincs teljesen feldolgozott havi Foxpost riport.
            </p>
          ) : null}
          {reports.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
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
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={
                            report.blockedByUnresolvedSettlements > 0 ||
                            downloadingId === report.id
                          }
                          onClick={() => void download(report)}
                        >
                          {report.blockedByUnresolvedSettlements > 0
                            ? `${report.blockedByUnresolvedSettlements} ellenőrzendő`
                            : downloadingId === report.id
                              ? "Letöltés…"
                              : "XLSX letöltése"}
                        </Button>
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
                description={selected.errorCode}
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
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Referencia kód</th>
                    <th>Címzett</th>
                    <th>Tranzakció</th>
                    <th>Rendelési számla</th>
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
                      <td className="font-mono text-xs">
                        {line.invoiceNumber ?? "—"}
                      </td>
                      <td className="p-3">{lineStatus(line.status)}</td>
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
