"use client";

import {
  Alert,
  Icon,
  PilotBadge,
  PilotButton,
  PilotDataTable,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  operationsDurationText,
  operationsMonthTitle,
  operationsNumberText,
  operationsPeriodText,
  operationsSignedNumberText,
  OPERATIONS_FREQUENCY_LABELS,
  PERMISSIONS,
  type OperationsReportAssetBlock,
  type OperationsReportEntryRow,
  type OperationsReportResponse,
  type WorksheetDepartmentSummary,
} from "@acropora/types";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { PartnerPicker } from "@/components/service-jobs/partner-picker";
import { operationsLogApi } from "@/lib/api/operations-log";
import { worksheetsApi } from "@/lib/api/worksheets";
import { useUrlQuery } from "@/lib/navigation/use-url-query";

import { errorText, isAbort } from "./operations-format";
import { departmentOptions, monthOrDefault } from "./operations-report-view";

/** Az objektum-URL visszavonásának késleltetése (a partner portál `file-download.ts`-ével egyező). */
const REVOKE_DELAY_MS = 60_000;

/**
 * AZ ÜZEMELTETÉSI NAPLÓ HAVI KIMUTATÁSA (task os-uzemeltetesi-naplo, S4b). A legközelebbi meglévő képernyő az Elhullási napló listája
 * (`mortality/mortality-list-page.tsx`, Figma 535:3): fejléc, négy összesítő kártya, szűrősor, táblázat; a szűrők az URL-ben állnak,
 * hogy egy linkről ugyanaz a kimutatás nyíljon. Partner és helyszín (a részfájával együtt) és hónap szerint készül; a PDF ugyanazt a
 * számítást írja ki (`packages/types/src/operations-report.ts`), tehát a képernyő és a letöltött fájl nem mondhat mást.
 */
export function OperationsReportPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.OPERATIONS_LOG_VIEW),
  );
  const { params, update } = useUrlQuery();
  const partnerId = params.get("partnerId") ?? "";
  const departmentId = params.get("departmentId") ?? "";
  const month = monthOrDefault(params.get("month"));

  const [departments, setDepartments] = useState<
    WorksheetDepartmentSummary[] | null
  >(null);
  const [data, setData] = useState<OperationsReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // a partner helyszínei
  useEffect(() => {
    if (!canView || !partnerId) {
      setDepartments(null);
      return;
    }
    const controller = new AbortController();
    setDepartments(null);
    worksheetsApi
      .departments(token, partnerId, controller.signal)
      .then((response) => setDepartments(response.items))
      .catch((cause) => {
        if (!isAbort(cause))
          setError(errorText(cause, "A helyszínek nem tölthetők be."));
      });
    return () => controller.abort();
  }, [canView, partnerId, token]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView || !departmentId) {
        setData(null);
        return;
      }
      setError(null);
      try {
        setData(
          await operationsLogApi.report(token, { month, departmentId }, signal),
        );
      } catch (cause) {
        if (!isAbort(cause)) {
          setData(null);
          setError(errorText(cause, "A kimutatás nem tölthető be."));
        }
      }
    },
    [canView, departmentId, month, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // A KIMUTATÁS CSAK AKKOR LÁTSZIK ÉS CSAK AKKOR LEHET LETÖLTENI, HA A MOSTANI VÁLASZTÁSRA KÉSZÜLT: helyszín- vagy hónapváltáskor az előző
  // kimutatás nem maradhat a képernyőn az új választás alatt (és a PDF-gomb nem tölthet le mást, mint amit a képernyő mutat)
  const shown =
    data !== null &&
    data.report.month === month &&
    data.departmentId === departmentId;
  const options = useMemo(
    () => departmentOptions(departments ?? []),
    [departments],
  );

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const file = await operationsLogApi.reportPdf(token, {
        month,
        departmentId,
      });
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      // KÉSLELTETVE, mint a repó többi letöltőjénél: a letöltés az URL-t aszinkron olvassa, és egyes böngészők a szinkron visszavonásnál megszakítják
      window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    } catch (cause) {
      setError(errorText(cause, "A PDF nem tölthető le."));
    } finally {
      setDownloading(false);
    }
  }

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az üzemeltetési naplóhoz"
        description="operations-log.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Szerviz / Üzemeltetési napló"
        title="Üzemeltetési napló"
        description="Havi kimutatás helyszínenként: mi készült el, ki végezte, mennyi ideig, a vízóra különbsége és a kimaradt ütemezett feladatok."
        actions={
          <PilotButton
            size="regular"
            variant="secondary"
            disabled={!shown || downloading}
            onClick={() => void download()}
          >
            <Icon name="download" size={14} />
            {downloading ? "Letöltés…" : "PDF letöltése"}
          </PilotButton>
        }
      />

      <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-[1_1_240px]">
            <span className="mb-1 block text-xs font-medium text-pilot-grey-600">
              Partner
            </span>
            <PartnerPicker
              id="operations-report-partner"
              variant="pilot"
              value={partnerId}
              onPick={(partner) =>
                update({ partnerId: partner.customerId, departmentId: null })
              }
              onClear={() => update({ partnerId: null, departmentId: null })}
            />
          </div>
          <div className="min-w-[220px] flex-[1_1_240px]">
            <span className="mb-1 block text-xs font-medium text-pilot-grey-600">
              Helyszín
            </span>
            <PilotSelect
              chevron
              aria-label="Helyszín"
              value={departmentId}
              onChange={(value) => update({ departmentId: value })}
              disabled={!partnerId || departments === null}
              className="[&_select]:h-10"
            >
              <option value="">
                {partnerId ? "Válassz helyszínt" : "Előbb válassz partnert"}
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </PilotSelect>
          </div>
          <div className="min-w-[160px] flex-[0_1_180px]">
            <span className="mb-1 block text-xs font-medium text-pilot-grey-600">
              Hónap
            </span>
            <PilotInput
              aria-label="Hónap"
              type="month"
              value={month}
              onChange={(value) => update({ month: value })}
              className="h-10"
            />
          </div>
        </div>
      </section>

      {error ? (
        <Alert
          variant="danger"
          title="Hiba történt"
          description={error}
          action={
            departmentId ? (
              <PilotButton variant="secondary" onClick={() => void load()}>
                Újrapróbálás
              </PilotButton>
            ) : undefined
          }
        />
      ) : null}

      {!departmentId ? (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-16 text-center">
          <Icon name="clipboard" size={24} className="text-pilot-grey-400" />
          <p className="text-base font-semibold text-pilot-grey-700">
            Válassz partnert és helyszínt a kimutatáshoz
          </p>
        </section>
      ) : shown && data ? (
        <ReportBody data={data} />
      ) : !error ? (
        <div aria-label="Kimutatás betöltése" className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
    </PilotThemeRoot>
  );
}

function ReportBody({ data }: { data: OperationsReportResponse }) {
  const { report } = data;
  const cards = [
    {
      title: "Elvégzett feladat",
      value: String(report.totals.entries),
      hint: operationsMonthTitle(report.month),
    },
    {
      title: "Összes idő",
      value: operationsDurationText(report.totals.totalMinutes),
      hint: `${report.assets.length} eszközön`,
    },
    {
      title: "Rendellenesség",
      value: String(report.totals.anomalies),
      hint: report.totals.anomalies > 0 ? "hibajegy nyílt" : "nem volt",
      warn: report.totals.anomalies > 0,
    },
    {
      title: "Kimaradt ütemezett",
      value: String(report.totals.missed),
      hint: "napi és heti feladat",
      warn: report.totals.missed > 0,
    },
  ];
  return (
    <>
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Összesítő"
      >
        {cards.map((card) => (
          <section
            key={card.title}
            className="rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-pilot-grey-500">
              {card.title}
            </p>
            <p
              className={`mt-1 text-xl font-semibold ${card.warn ? "text-pilot-red-700" : "text-pilot-grey-900"}`}
            >
              {card.value}
            </p>
            <p className="mt-1 text-xs text-pilot-grey-500">{card.hint}</p>
          </section>
        ))}
      </div>

      {report.assets.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-12 text-center">
          <p className="text-base font-semibold text-pilot-grey-700">
            Ebben a hónapban nincs rögzített bejegyzés
          </p>
        </section>
      ) : (
        report.assets.map((block) => (
          <AssetSection key={block.assetId} block={block} />
        ))
      )}

      {report.missed.length > 0 ? (
        <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-pilot-grey-900">
            Kimaradt ütemezett feladatok
          </h2>
          <ul className="space-y-2">
            {report.missed.map((item) => (
              <li
                key={`${item.assetId}-${item.templateId}`}
                className="text-sm text-pilot-grey-700"
              >
                <span className="font-medium">{item.assetLabel}</span>
                {" · "}
                {item.templateName} (
                {OPERATIONS_FREQUENCY_LABELS[item.frequency].toLowerCase()}):{" "}
                {item.periods
                  .map((period) => operationsPeriodText(period, item.frequency))
                  .join(", ")}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-pilot-grey-500">
            A mai nap, a sablon létrehozásának ideje és a kivezetett vagy
            alkalmi sablonok nem számítanak kimaradásnak.
          </p>
        </section>
      ) : null}
    </>
  );
}

function AssetSection({ block }: { block: OperationsReportAssetBlock }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-pilot-grey-200 px-5 py-4">
        <h2 className="text-base font-semibold text-pilot-grey-900">
          {block.assetLabel}
        </h2>
        <p className="text-xs text-pilot-grey-600">
          {block.entries.length} bejegyzés ·{" "}
          {operationsDurationText(block.totalMinutes)}
          {block.meterTotal !== null
            ? ` · vízóra ${operationsSignedNumberText(block.meterTotal, block.meterUnit)}`
            : ""}
          {block.anomalies > 0 ? ` · ${block.anomalies} rendellenesség` : ""}
        </p>
      </div>
      <PilotDataTable
        columns={COLUMNS}
        rows={block.entries}
        rowKey={(row) => row.id}
        rowLabel={(row) => `${row.templateName}, ${dateTime(row.startedAt)}`}
        minWidth={860}
      />
    </section>
  );
}

function dateTime(iso: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

const COLUMNS: readonly PilotTableColumn<OperationsReportEntryRow>[] = [
  {
    id: "time",
    header: "Időpont",
    width: "130px",
    nowrap: true,
    cell: (row) => dateTime(row.startedAt),
  },
  {
    id: "task",
    header: "Feladat",
    cell: (row) => (
      <div>
        <div className="font-medium text-pilot-grey-900">
          {row.templateName}
        </div>
        <div className="text-xs text-pilot-grey-500">
          {OPERATIONS_FREQUENCY_LABELS[row.frequency]}
        </div>
      </div>
    ),
  },
  {
    id: "duration",
    header: "Tartam",
    width: "100px",
    nowrap: true,
    cell: (row) => operationsDurationText(row.minutes),
  },
  {
    id: "meter",
    header: "Vízóra",
    width: "170px",
    cell: (row) =>
      row.meterBefore === null && row.meterAfter === null ? (
        "—"
      ) : (
        <div className="text-xs text-pilot-grey-700">
          <div>
            előtte:{" "}
            {row.meterBefore === null
              ? "?"
              : `${operationsNumberText(row.meterBefore)} ${row.meterUnit ?? ""}`}
          </div>
          <div>
            utána:{" "}
            {row.meterAfter === null
              ? "?"
              : `${operationsNumberText(row.meterAfter)} ${row.meterUnit ?? ""}`}
          </div>
          {row.meterDifference !== null ? (
            <div
              className={`font-medium ${row.meterSuspicious ? "text-pilot-red-700" : "text-pilot-grey-900"}`}
            >
              különbség:{" "}
              {operationsSignedNumberText(row.meterDifference, row.meterUnit)}
              {row.meterSuspicious ? " (ellenőrizendő)" : ""}
            </div>
          ) : null}
        </div>
      ),
  },
  {
    id: "who",
    header: "Végezte",
    width: "160px",
    cell: (row) => row.performers.join(", "),
  },
  {
    id: "notes",
    header: "Megjegyzés",
    cell: (row) =>
      row.anomaly ? (
        <div className="space-y-1">
          <PilotBadge variant="danger">Rendellenesség</PilotBadge>
          {row.anomalyNote ? (
            <p className="text-xs text-pilot-grey-700">{row.anomalyNote}</p>
          ) : null}
          {row.ticket ? (
            <p className="text-xs text-pilot-grey-600">
              Hibajegy: {row.ticket.jobNumber}
            </p>
          ) : null}
        </div>
      ) : (
        "—"
      ),
  },
];
