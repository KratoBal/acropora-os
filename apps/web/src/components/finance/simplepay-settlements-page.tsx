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
  type SimplePayLineError,
  type SimplePayReportDetail,
  type SimplePayReportListResponse,
  type SimplePayReportStatus,
  type SimplePaySyncState,
  type SimplePaySyncStatus,
  type SimplePayTransactionLine,
} from "@acropora/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { simplePaySettlementsApi } from "@/lib/api/simplepay-settlements";

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
    <Badge variant="success">Kész</Badge>
  ) : (
    <Badge variant="warning">Ellenőrzendő</Badge>
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
    return <Badge variant="info">Kézzel jóváhagyva</Badge>;
  if (line.status === "RESOLVED")
    return <Badge variant="success">Párosítva rendelésből</Badge>;
  return (
    <Badge variant="warning">
      {line.errorCode ? LINE_ERRORS[line.errorCode] : "Ellenőrzendő"}
    </Badge>
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="SimplePay elszámolások"
        description="A SimplePay heti forgalmi kimutatása: fizetésenként a webshop-rendelés és a kimenő számla, a jutalék és az utalt összeg."
        actions={
          canManage ? (
            <>
              {syncStatus?.canRunNow ? (
                <Button
                  variant="secondary"
                  onClick={() => void syncNow()}
                  disabled={working}
                >
                  Gmail ellenőrzése most
                </Button>
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
              <Button
                onClick={() => fileInput.current?.click()}
                disabled={working}
              >
                {working ? "Feldolgozás…" : "Kimutatás feltöltése"}
              </Button>
            </>
          ) : undefined
        }
      />

      {syncStatus && syncStatus.state !== "ENABLED" ? (
        <Alert
          variant="info"
          title="Az automatikus Gmail-behúzás ki van kapcsolva"
          description={`Ok: ${SYNC_OFF[syncStatus.state]}. A heti kimutatást (report_ÉÉÉÉHHNN.csv) addig kézzel töltsd fel.`}
        />
      ) : null}
      {syncStatus?.state === "ENABLED" ? (
        <p className="text-sm text-dusk-600">
          Automatikus Gmail-behúzás: {syncStatus.intervalMinutes} percenként.{" "}
          {syncStatus.lastScheduledRun
            ? `Utolsó automatikus futás: ${new Date(syncStatus.lastScheduledRun.startedAt).toLocaleString("hu-HU")}, ${
                syncStatus.lastScheduledRun.status === "FAILED"
                  ? `sikertelen (${syncStatus.lastScheduledRun.errorCode ?? "ismeretlen hiba"})`
                  : `${syncStatus.lastScheduledRun.documentsRead} új kimutatás`
              }.`
            : "Automatikus futás még nincs rögzítve."}
        </p>
      ) : null}
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

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-dusk-900">
            Havi fájl a könyveléshez
          </h2>
          <span className="text-xs text-dusk-500">
            Hetente a kifizetett számlák, összesen, jutalék és utalt, ahogy Luca
            táblája
          </span>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="month"
              aria-label="A havi fájl hónapja"
              className="rounded-md border border-dusk-300 bg-white px-2 py-1.5 text-sm text-dusk-900"
              value={reportMonth}
              onChange={(event) => setReportMonth(event.target.value)}
            />
            <Button
              variant="secondary"
              onClick={() => void download()}
              disabled={downloading || !reportMonth}
            >
              {downloading ? "Letöltés…" : "XLSX letöltése"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-dusk-900">
            Heti kimutatások
          </h2>
          <span className="text-xs text-dusk-500">
            {data?.pagination.totalItems ?? 0} kimutatás
          </span>
        </CardHeader>
        <CardContent>
          {loading && !data ? <Skeleton className="h-56" /> : null}
          {data && data.items.length === 0 ? (
            <EmptyState
              title="Még nincs SimplePay kimutatás"
              description="Töltsd fel a SimplePay heti forgalmi kimutatását (report_ÉÉÉÉHHNN.csv)."
            />
          ) : null}
          {data?.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                  <tr>
                    <th className="p-3">Időszak</th>
                    <th className="text-right">Összesen</th>
                    <th className="text-right">Jutalék</th>
                    <th className="text-right">Utalt</th>
                    <th className="text-right">Párosítva</th>
                    <th className="p-3">Állapot</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      data-testid="simplepay-kimutatas"
                      className="cursor-pointer border-b last:border-0 hover:bg-dusk-50"
                      onClick={() => void openDetail(item.id)}
                    >
                      <td className="p-3">{reportPeriod(item)}</td>
                      <td className="text-right">
                        {formatAmount(item.amountTotal)}
                      </td>
                      <td className="text-right">
                        {formatAmount(item.commissionTotal)}
                      </td>
                      <td className="text-right">
                        {formatAmount(item.netTotal)}
                      </td>
                      <td className="text-right">
                        {item.resolvedLineCount} / {item.lineCount}
                      </td>
                      <td className="p-3">{reportStatus(item.status)}</td>
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
                {reportPeriod(selected)} kimutatás részletei
              </h2>
              <p className="mt-1 text-xs text-dusk-500">{selected.fileName}</p>
            </div>
            <div className="flex items-center gap-2">
              {reportStatus(selected.status)}
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
            {selected.warnings.length ? (
              <Alert
                variant="info"
                title="A kimutatás figyelmeztetései"
                description={selected.warnings.join(" ")}
              />
            ) : null}
            {selected.status !== "COMPLETED" ? (
              <Alert
                variant="info"
                title="Ellenőrzés szükséges"
                description="Ahol a párosítás nem sikerült, add meg a kimenő számla számát, és hagyd jóvá. A számla nélküli rendelés számlája később is megérkezhet: akkor az Újrafeldolgozás párosítja."
              />
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                  <tr>
                    <th className="p-3">Tranzakció</th>
                    <th>Időpont</th>
                    <th className="text-right">Összeg</th>
                    <th className="text-right">Jutalék</th>
                    <th className="pl-4">Rendelés</th>
                    <th className="pl-4">Kimenő számla / kézi jóváhagyás</th>
                    <th className="p-3">Párosítás</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line) => (
                    <tr
                      key={line.id}
                      data-testid="simplepay-sor"
                      className="border-b last:border-0"
                    >
                      <td className="p-3 font-mono text-xs">
                        {line.merchantTransactionId}
                      </td>
                      <td className="text-xs">{line.transactionAt}</td>
                      <td className="text-right">
                        {formatAmount(line.amount)}
                      </td>
                      <td className="text-right">
                        {formatAmount(line.commission)}
                      </td>
                      <td className="pl-4 font-mono text-xs">
                        {line.orderNumber ?? "—"}
                        {line.errorCode === "AMOUNT_MISMATCH" &&
                        line.orderTotal ? (
                          <p className="mt-1 font-sans text-dusk-500">
                            végösszege {formatAmount(line.orderTotal)}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-2 pl-4 pr-3">
                        {line.status !== "RESOLVED" && canManage ? (
                          <div className="flex min-w-[290px] items-center gap-2">
                            <input
                              aria-label={`Számlaszám – ${line.merchantTransactionId}`}
                              className="min-w-0 flex-1 rounded-md border border-dusk-300 bg-white px-2 py-1.5 font-mono text-xs text-dusk-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              value={invoiceDrafts[line.id] ?? ""}
                              placeholder="ACRW-2026/00000"
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
                              {line.invoiceNumbers.join(", ") || "—"}
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
