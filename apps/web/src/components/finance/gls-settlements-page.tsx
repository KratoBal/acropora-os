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
  type GlsCodLineError,
  type GlsCodReportDetail,
  type GlsCodReportLine,
  type GlsCodReportListResponse,
  type GlsCodReportStatus,
  type GlsInvoiceSummary,
} from "@acropora/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { glsSettlementsApi } from "@/lib/api/gls-settlements";

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
    <Badge variant="success">Kész</Badge>
  ) : (
    <Badge variant="warning">Ellenőrzendő</Badge>
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
    return <Badge variant="info">Kézzel jóváhagyva</Badge>;
  if (line.status === "RESOLVED")
    return (
      <Badge variant="success">
        {line.resolutionSource === "ORDER_KEY"
          ? "Párosítva rendelésből"
          : "Párosítva"}
      </Badge>
    );
  return (
    <Badge variant="warning">
      {line.errorCode ? LINE_ERRORS[line.errorCode] : "Ellenőrzendő"}
    </Badge>
  );
}

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
  const [invoices, setInvoices] = useState<GlsInvoiceSummary[]>([]);
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

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [reports, glsInvoices] = await Promise.all([
        glsSettlementsApi.list(token),
        glsSettlementsApi.invoices(token),
      ]);
      setData(reports);
      setInvoices(glsInvoices);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A GLS elszámolások nem tölthetők be.",
      );
    } finally {
      setLoading(false);
    }
  }, [canView, token]);

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
        const kind =
          result.kind === "COD_REPORT"
            ? "utánvét-részletező"
            : "számlamelléklet";
        results.push(
          result.duplicate
            ? `${file.name}: ez a ${kind} már bent volt.`
            : `${file.name}: ${kind} beolvasva, ${result.newlyResolvedLineCount} sor párosítva.`,
        );
      }
      setNotice(results.join(" "));
      if (fileInput.current) fileInput.current.value = "";
      await load();
    }, "A feltöltés nem sikerült.");

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="GLS elszámolások"
        description="A GLS heti utánvét-részletezője és kéthetes számlamelléklete. Az utánvét soronként a kimenő számlához kötve; a díjszámla külön."
        actions={
          canManage ? (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx"
                multiple
                className="hidden"
                aria-label="GLS fájlok feltöltése"
                onChange={(event) => void upload(event.target.files)}
              />
              <Button
                onClick={() => fileInput.current?.click()}
                disabled={working}
              >
                {working ? "Feldolgozás…" : "GLS fájl feltöltése"}
              </Button>
            </>
          ) : undefined
        }
      />

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

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-dusk-900">
            Havi könyvelési fájl
          </h2>
          <span className="text-xs text-dusk-500">
            Utalásonként a kifizetett számlák, a GLS díjszámlák külön lapon
          </span>
        </CardHeader>
        <CardContent>
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
              title="Még nincs GLS utánvét-utalás"
              description="Töltsd fel a GLS utánvét-részletezőt (XLSX). A számlamelléklet a díjakat és az ügyfélhivatkozást hozza."
            />
          ) : null}
          {data?.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                  <tr>
                    <th className="p-3">Utalás napja</th>
                    <th>Fájl</th>
                    <th className="text-right">Összeg</th>
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
                      <td className="p-3">{formatDate(item.transferDate)}</td>
                      <td className="font-mono text-xs">{item.fileName}</td>
                      <td className="text-right">{formatAmount(item.total)}</td>
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
                {formatDate(selected.transferDate)} utalás részletei
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
            {selected.status !== "COMPLETED" ? (
              <Alert
                variant="info"
                title="Ellenőrzés szükséges"
                description="Add meg a helyes számlaszámot az érintett sornál. Ahol van javaslat (például előtag nélküli számlaszám előtaggal), a mező előre ki van töltve: ellenőrzés után hagyd jóvá."
              />
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                  <tr>
                    <th className="p-3">Csomagszám</th>
                    <th>Utánvét-hivatkozás</th>
                    <th>Ügyfélhivatkozás</th>
                    <th className="text-right">Összeg</th>
                    <th className="pl-4">Kimenő számla / kézi jóváhagyás</th>
                    <th className="p-3">Párosítás</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line) => (
                    <tr key={line.id} className="border-b last:border-0">
                      <td className="p-3 font-mono text-xs">
                        {line.parcelNumber}
                      </td>
                      <td className="font-mono text-xs">
                        {line.codReference ?? "—"}
                      </td>
                      <td className="font-mono text-xs">
                        {line.clientReference ?? "—"}
                      </td>
                      <td className="text-right">
                        {formatAmount(line.amount)}
                      </td>
                      <td className="py-2 pl-4 pr-3">
                        {line.status !== "RESOLVED" && canManage ? (
                          <div className="flex min-w-[290px] items-center gap-2">
                            <input
                              aria-label={`Számlaszám – ${line.parcelNumber}`}
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

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-dusk-900">
            GLS díjszámlák
          </h2>
          <span className="text-xs text-dusk-500">
            A díj nem az utalásból megy le: külön számla
          </span>
        </CardHeader>
        <CardContent>
          {!loading && invoices.length === 0 ? (
            <p className="text-sm text-dusk-500">
              Még nincs feltöltött GLS számlamelléklet.
            </p>
          ) : null}
          {invoices.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                  <tr>
                    <th className="p-3">Számlaszám</th>
                    <th>Kelte</th>
                    <th className="text-right">Csomag</th>
                    <th className="text-right">Díj</th>
                    <th className="p-3 text-right">Kártyadíj</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b last:border-0">
                      <td className="p-3 font-mono text-xs">
                        {invoice.invoiceNumber}
                      </td>
                      <td>{formatDate(invoice.invoiceDate)}</td>
                      <td className="text-right">{invoice.parcelCount}</td>
                      <td className="text-right">
                        {formatAmount(invoice.feeTotal)}
                      </td>
                      <td className="p-3 text-right">
                        {formatAmount(invoice.cardFeeTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
