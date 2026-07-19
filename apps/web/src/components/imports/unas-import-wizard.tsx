"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatCard,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ImportIssue,
  type ImportIssueSeverity,
  type UnasImportReport,
} from "@acropora/types";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { importApi, validateUnasImportFile } from "@/lib/api/imports";

const STEPS = ["Feltöltés", "Összegzés", "Validáció", "Változások", "Riport"];
const DIFF_LABELS = {
  title: "Terméknév",
  category: "Kategóriák",
  brand: "Brand",
  images: "Képek",
  activeState: "Aktív állapot",
  channelListing: "UNAS listing",
} as const;

const printable = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

export function UnasImportWizard() {
  const { session } = useAuth();
  const [step, setStep] = useState(1);
  const [report, setReport] = useState<UnasImportReport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [severity, setSeverity] =
    useState<Extract<ImportIssueSeverity, "ERROR" | "WARNING">>("ERROR");
  const [entityType, setEntityType] = useState("ALL");
  const [search, setSearch] = useState("");
  const retryRef = useRef<(() => void) | null>(null);

  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const token = session?.token ?? "";

  const filteredIssues = useMemo(() => {
    if (!report) return [];
    const normalizedSearch = search.trim().toLocaleLowerCase("hu");
    return report.issues.filter((issue) => {
      const product = report.products.find(
        (row) => row.sourceRowNumber === issue.sourceRowNumber,
      );
      const searchable = [
        issue.code,
        issue.message,
        product?.sku,
        product?.productName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("hu");
      return (
        issue.severity === severity &&
        (entityType === "ALL" || issue.entityType === entityType) &&
        (!normalizedSearch || searchable.includes(normalizedSearch))
      );
    });
  }, [entityType, report, search, severity]);

  if (!canManage) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az UNAS importhoz"
        description="A varázsló használatához products.manage jogosultság szükséges."
      />
    );
  }

  const upload = async (selected: File) => {
    const validationError = validateUnasImportFile(selected);
    if (validationError) {
      setError(validationError);
      return;
    }
    setFile(selected);
    setError(null);
    setProgress(0);
    setLoading(true);
    retryRef.current = () => void upload(selected);
    try {
      const nextReport = await importApi.uploadDryRun(
        token,
        selected,
        setProgress,
      );
      setReport(nextReport);
      setBatchId(nextReport.batchId);
      setStep(2);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az import dry-run nem sikerült.",
      );
    } finally {
      setLoading(false);
    }
  };

  const reloadReport = async () => {
    const normalized = batchId.trim();
    if (!normalized) {
      setError("A batch ID megadása kötelező.");
      return;
    }
    setLoading(true);
    setError(null);
    retryRef.current = () => void reloadReport();
    try {
      const loaded = await importApi.report(token, normalized);
      setReport(loaded);
      setStep(2);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A riport betöltése nem sikerült.",
      );
    } finally {
      setLoading(false);
    }
  };

  const copySummary = async () => {
    if (!report) return;
    const summary = Object.entries(report.summary)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    await navigator.clipboard.writeText(summary);
  };

  const downloadJson = () => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `unas-import-${report.batchId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="UNAS katalógus import"
        description="XLSX validáció, staging és dry-run áttekintés. A varázsló nem módosít termékadatot."
      />

      <nav aria-label="Import lépései" className="grid grid-cols-5 gap-2">
        {STEPS.map((label, index) => {
          const number = index + 1;
          return (
            <button
              key={label}
              type="button"
              disabled={number > 1 && !report}
              onClick={() => setStep(number)}
              className={`rounded-lg border px-3 py-3 text-left text-xs font-semibold transition ${
                step === number
                  ? "border-teal-500 bg-teal-50 text-teal-800"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span className="mr-2 text-slate-400">{number}.</span>
              {label}
            </button>
          );
        })}
      </nav>

      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
          action={
            retryRef.current ? (
              <Button variant="secondary" size="sm" onClick={retryRef.current}>
                Újrapróbálás
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {loading ? (
        <Card className="space-y-4 p-6" aria-label="Import feldolgozása">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-900">
              {file ? "Feltöltés és feldolgozás" : "Riport betöltése"}
            </span>
            {file ? <span>{progress}%</span> : null}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-teal-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <Skeleton className="h-20 w-full" />
        </Card>
      ) : null}

      {step === 1 && !loading ? (
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <Card className="p-6">
            <div
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const selected = event.dataTransfer.files[0];
                if (selected) void upload(selected);
              }}
              className={`flex min-h-72 flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition ${
                dragging
                  ? "border-teal-500 bg-teal-50"
                  : "border-slate-300 bg-slate-50"
              }`}
              aria-label="UNAS XLSX feltöltési terület"
            >
              <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm">
                <Icon name="package" />
              </span>
              <h2 className="font-semibold text-slate-950">
                Húzd ide az UNAS XLSX exportot
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                vagy válaszd ki a számítógépedről
              </p>
              <label className="mt-5">
                <span className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">
                  Fájl kiválasztása
                </span>
                <input
                  className="sr-only"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => {
                    const selected = event.target.files?.[0];
                    if (selected) void upload(selected);
                  }}
                />
              </label>
              <p className="mt-4 text-xs text-slate-400">
                Csak XLSX · maximum 25 MiB
              </p>
            </div>
          </Card>
          <Card className="p-6">
            <h2 className="font-semibold text-slate-950">
              Korábbi riport megnyitása
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Add meg a staging batch azonosítóját.
            </p>
            <Input
              className="mt-5"
              aria-label="Batch ID"
              placeholder="pl. cm..."
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
            />
            <Button
              className="mt-3 w-full"
              variant="secondary"
              onClick={() => void reloadReport()}
            >
              Riport betöltése
            </Button>
          </Card>
        </div>
      ) : null}

      {step === 2 && report && !loading ? (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Létrehozandó termékek"
              value={String(report.summary.productsToCreate)}
            />
            <StatCard
              label="Frissítendő termékek"
              value={String(report.summary.productsToUpdate)}
            />
            <StatCard
              label="Változatlan termékek"
              value={String(report.summary.productsUnchanged)}
            />
            <StatCard
              label="Létrehozandó kategóriák"
              value={String(report.summary.categoriesToCreate)}
            />
            <StatCard
              label="Frissítendő kategóriák"
              value={String(report.summary.categoriesToUpdate)}
            />
            <StatCard
              label="Hibák"
              value={String(report.summary.validationErrors)}
            />
            <StatCard
              label="Figyelmeztetések"
              value={String(report.summary.warnings)}
            />
          </div>
          <WizardNavigation step={step} onStep={setStep} />
        </div>
      ) : null}

      {step === 3 && report && !loading ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button
              variant={severity === "ERROR" ? "primary" : "secondary"}
              onClick={() => setSeverity("ERROR")}
            >
              Hibák ({report.summary.validationErrors})
            </Button>
            <Button
              variant={severity === "WARNING" ? "primary" : "secondary"}
              onClick={() => setSeverity("WARNING")}
            >
              Figyelmeztetések ({report.summary.warnings})
            </Button>
            <Select
              aria-label="Entitástípus"
              className="w-48"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
            >
              <option value="ALL">Minden entitás</option>
              <option value="PRODUCT">Termék</option>
              <option value="CATEGORY">Kategória</option>
              <option value="BRAND">Brand</option>
            </Select>
            <Input
              aria-label="Validáció keresése"
              className="max-w-xs"
              placeholder="Kód, SKU, név…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <ValidationTable issues={filteredIssues} report={report} />
          <WizardNavigation step={step} onStep={setStep} />
        </div>
      ) : null}

      {step === 4 && report && !loading ? (
        <div className="space-y-4">
          {report.products.filter((product) => product.changes.length)
            .length ? (
            report.products
              .filter((product) => product.changes.length)
              .map((product) => (
                <Card
                  key={`${product.sourceRowNumber}-${product.sku}`}
                  className="overflow-hidden"
                >
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div>
                      <h2 className="font-semibold text-slate-950">
                        {product.productName || "Névtelen termék"}
                      </h2>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        {product.sku || "Nincs SKU"}
                      </p>
                    </div>
                    <Badge variant="warning">
                      {product.changes.length} változás
                    </Badge>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Mező</th>
                        <th className="px-5 py-3">Jelenlegi</th>
                        <th className="px-5 py-3">UNAS érték</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {product.changes.map((change) => (
                        <tr key={change.field}>
                          <td className="px-5 py-3 font-semibold">
                            {DIFF_LABELS[change.field]}
                          </td>
                          <td className="max-w-md bg-rose-50/50 px-5 py-3 text-slate-600">
                            {printable(change.before)}
                          </td>
                          <td className="max-w-md bg-emerald-50/50 px-5 py-3 text-slate-900">
                            {printable(change.after)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ))
          ) : (
            <EmptyState
              title="Nincs mezőszintű változás"
              description="A dry-run nem talált módosítandó terméket."
            />
          )}
          <WizardNavigation step={step} onStep={setStep} />
        </div>
      ) : null}

      {step === 5 && report && !loading ? (
        <Card className="p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Batch ID
              </p>
              <code className="mt-2 block rounded-md bg-slate-100 px-3 py-2 text-sm">
                {report.batchId}
              </code>
              <p className="mt-3 text-xs text-slate-500">
                Létrehozva:{" "}
                {new Date(report.generatedAt).toLocaleString("hu-HU")}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/admin/brands/import-assistant?batchId=${encodeURIComponent(report.batchId)}&returnTo=${encodeURIComponent(`/admin/imports/unas?batchId=${report.batchId}`)}`}
                className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Márkaimport asszisztens
              </Link>
              {report.brandResolution?.products.some(
                (product) => product.status !== "RESOLVED",
              ) ? (
                <Link
                  href={`/admin/imports/unas/${encodeURIComponent(report.batchId)}/review`}
                  className="inline-flex h-9 items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Brandek ellenőrzése
                </Link>
              ) : null}
              <Button variant="secondary" onClick={() => void copySummary()}>
                Összegzés másolása
              </Button>
              <Button onClick={downloadJson}>JSON letöltése</Button>
            </div>
          </div>
          <Alert
            className="mt-6"
            variant="info"
            title="Ez csak dry-run riport"
            description="Termék, készlet és egyéb üzleti adat nem módosult."
          />
          <WizardNavigation step={step} onStep={setStep} />
        </Card>
      ) : null}
    </div>
  );
}

function WizardNavigation({
  step,
  onStep,
}: {
  step: number;
  onStep(step: number): void;
}) {
  return (
    <div className="flex justify-between pt-2">
      <Button
        variant="secondary"
        disabled={step <= 1}
        onClick={() => onStep(step - 1)}
      >
        Vissza
      </Button>
      <Button disabled={step >= 5} onClick={() => onStep(step + 1)}>
        Tovább
      </Button>
    </div>
  );
}

function ValidationTable({
  issues,
  report,
}: {
  issues: ImportIssue[];
  report: UnasImportReport;
}) {
  if (!issues.length)
    return (
      <EmptyState
        title="Nincs megjeleníthető probléma"
        description="A kiválasztott szűrőknek nincs megfelelő validációs találata."
      />
    );
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Forrássor</th>
            <th className="px-4 py-3">Entitás</th>
            <th className="px-4 py-3">SKU / név</th>
            <th className="px-4 py-3">Kód</th>
            <th className="px-4 py-3">Üzenet</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {issues.map((issue, index) => {
            const product = report.products.find(
              (row) => row.sourceRowNumber === issue.sourceRowNumber,
            );
            return (
              <tr
                key={`${issue.code}-${issue.sourceRowNumber ?? "global"}-${index}`}
              >
                <td className="px-4 py-3 font-mono text-xs">
                  {issue.sourceRowNumber ?? "—"}
                </td>
                <td className="px-4 py-3">{issue.entityType ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className="block font-mono text-xs">
                    {product?.sku || "—"}
                  </span>
                  <span className="text-slate-500">
                    {product?.productName || "—"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge
                    variant={issue.severity === "ERROR" ? "danger" : "warning"}
                  >
                    {issue.code}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-600">{issue.message}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
