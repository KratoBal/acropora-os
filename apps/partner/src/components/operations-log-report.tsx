"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Icon,
  PilotBadge,
  PilotThemeRoot,
  partnerStatusBadgeVariant,
} from "@acropora/ui";
import {
  OPERATIONS_FREQUENCY_LABELS,
  PARTNER_STATUS_LABELS,
  operationsDurationText,
  operationsMonthTitle,
  operationsNumberText,
  operationsPeriodText,
  operationsSignedNumberText,
  type OperationsReportAssetBlock,
  type OperationsReportEntryRow,
  type OperationsReportResponse,
  type ServiceJobPartnerStatus,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { saveBlob, type FileSurface } from "@/lib/file-download";
import { defaultMonth, isMonth, siteOptions } from "@/lib/operations-log-view";
import { Message } from "./ticket-list";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ A PARTNER SZEMÉVEL (task os-uzemeltetesi-naplo, S5): a partner a SAJÁT, hozzá kiosztott helyszíneinek havi
 * kimutatását olvassa: mikor, melyik eszközön, milyen feladat, a mért értékek, a vízóra különbsége, és a rendellenesség a hibajegyének
 * állapotával. Csak olvas.
 *
 * AMIT A PARTNER NEM LÁT, és ez a SZERVEREN dől el (a végpont már szűrt választ ad, ez a képernyő nem szűr semmit): a kollégák neve
 * („Acropora" áll helyette), a belső megjegyzés, a szabad szövegű értékek, és a hibajegy belső állapota (a négy látszó egyike jön).
 * A helyszín-lista a hozzárendelt helyszínek; hozzárendelés nélkül üres, és az oldal ezt kimondja.
 *
 * Az elrendezés a Megrendelések listájának mintáját követi (`maintenance-order-list.tsx`): fejléc, kártyák, táblázat.
 */
export function OperationsLogReport() {
  const [sites, setSites] = useState<
    { id: string; parentId: string | null; name: string }[] | null
  >(null);
  const [departmentId, setDepartmentId] = useState("");
  const [month, setMonth] = useState(defaultMonth());
  const [data, setData] = useState<OperationsReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    partnerApi
      .operationsLogSites()
      .then((response) => {
        setSites(response.items);
        // egyetlen helyszínnél nincs mit választani
        if (response.items.length === 1) setDepartmentId(response.items[0]!.id);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A helyszínek nem tölthetők be.",
        ),
      );
  }, []);

  const load = useCallback(async () => {
    if (!departmentId || !isMonth(month)) {
      setData(null);
      return;
    }
    setError(null);
    try {
      setData(await partnerApi.operationsLogReport(month, departmentId));
    } catch (cause) {
      setData(null);
      setError(
        cause instanceof Error ? cause.message : "A kimutatás nem tölthető be.",
      );
    }
  }, [departmentId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const options = useMemo(() => siteOptions(sites ?? []), [sites]);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await partnerApi.operationsLogReportPdfBlob(
        month,
        departmentId,
      );
      saveBlob(blob, `uzemeltetesi-naplo-${month}.pdf`, browserSurface);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető le.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
      <div className="mb-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          Szervizmunka
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Üzemeltetési napló
        </h1>
        <p className="mt-0.5 text-sm text-pilot-grey-400">
          A helyszíneiden elvégzett rendszeres feladatok havi kimutatása.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 ring-1 ring-pilot-grey-200">
        <label className="min-w-[220px] flex-[1_1_240px] text-xs font-medium text-pilot-grey-500">
          Helyszín
          <select
            aria-label="Helyszín"
            className="mt-1 block h-10 w-full rounded-lg border border-pilot-grey-200 bg-white px-3 text-sm text-pilot-grey-900"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            disabled={sites === null || options.length === 0}
          >
            <option value="">Válassz helyszínt</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[160px] flex-[0_1_180px] text-xs font-medium text-pilot-grey-500">
          Hónap
          <input
            aria-label="Hónap"
            type="month"
            className="mt-1 block h-10 w-full rounded-lg border border-pilot-grey-200 bg-white px-3 text-sm text-pilot-grey-900"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!data || downloading}
          onClick={() => void download()}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-pilot-grey-200 bg-white px-4 text-sm font-medium text-pilot-grey-700 disabled:opacity-50"
        >
          <Icon name="download" size={14} />
          {downloading ? "Letöltés…" : "PDF letöltése"}
        </button>
      </div>

      {error ? <Message tone="error" text={error} retry={load} /> : null}

      {sites !== null && sites.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-white py-24 text-center ring-1 ring-pilot-grey-200">
          <p className="text-base font-semibold text-pilot-grey-700">
            Nincs hozzád rendelt helyszín
          </p>
          <p className="text-sm text-pilot-grey-500">
            Az üzemeltetési napló a hozzád rendelt helyszínek bejegyzéseit
            mutatja. Kérd az Acropora ügyfélszolgálatát a hozzárendelésre.
          </p>
        </div>
      ) : !departmentId ? (
        sites !== null && sites.length > 0 ? (
          <p className="text-sm text-pilot-grey-500">
            Válassz helyszínt a kimutatáshoz.
          </p>
        ) : null
      ) : data ? (
        <ReportBody data={data} />
      ) : !error ? (
        <p className="text-sm text-pilot-grey-400">Kimutatás betöltése…</p>
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
    },
    {
      title: "Kimaradt ütemezett",
      value: String(report.totals.missed),
      hint: "napi és heti feladat",
    },
  ];
  return (
    <>
      <div
        className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Összesítő"
      >
        {cards.map((card) => (
          <section
            key={card.title}
            className="rounded-xl bg-white px-5 py-4 ring-1 ring-pilot-grey-200"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
              {card.title}
            </p>
            <p className="mt-1 text-xl font-semibold text-pilot-grey-900">
              {card.value}
            </p>
            <p className="mt-1 text-xs text-pilot-grey-500">{card.hint}</p>
          </section>
        ))}
      </div>

      {report.assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-white py-16 text-center ring-1 ring-pilot-grey-200">
          <p className="text-base font-semibold text-pilot-grey-700">
            Ebben a hónapban nincs rögzített bejegyzés
          </p>
        </div>
      ) : (
        report.assets.map((block) => (
          <AssetSection key={block.assetId} block={block} />
        ))
      )}

      {report.missed.length > 0 ? (
        <section className="mt-5 rounded-xl bg-white p-5 ring-1 ring-pilot-grey-200">
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
        </section>
      ) : null}
    </>
  );
}

function AssetSection({ block }: { block: OperationsReportAssetBlock }) {
  return (
    <section className="mb-5 overflow-hidden rounded-xl bg-white ring-1 ring-pilot-grey-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-pilot-grey-100 px-5 py-4">
        <h2 className="text-base font-semibold text-pilot-grey-900">
          {block.assetLabel}
        </h2>
        <p className="text-xs text-pilot-grey-500">
          {block.entries.length} bejegyzés ·{" "}
          {operationsDurationText(block.totalMinutes)}
          {block.meterTotal !== null
            ? ` · vízóra ${operationsSignedNumberText(block.meterTotal, block.meterUnit)}`
            : ""}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-pilot-grey-100">
              {["Időpont", "Feladat", "Tartam", "Vízóra", "Megjegyzés"].map(
                (head) => (
                  <th
                    key={head}
                    className="whitespace-nowrap px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                  >
                    {head}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {block.entries.map((row, index) => (
              <EntryRow key={row.id} row={row} stripe={index % 2 === 1} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EntryRow({
  row,
  stripe,
}: {
  row: OperationsReportEntryRow;
  stripe: boolean;
}) {
  return (
    <tr
      className={`border-b border-pilot-grey-100 align-top last:border-0 ${stripe ? "bg-pilot-grey-50/50" : "bg-white"}`}
    >
      <td className="whitespace-nowrap px-5 py-3 text-pilot-grey-600">
        {dateTime(row.startedAt)}
      </td>
      <td className="px-5 py-3">
        <div className="font-medium text-pilot-grey-900">
          {row.templateName}
        </div>
        <div className="text-xs text-pilot-grey-500">
          {OPERATIONS_FREQUENCY_LABELS[row.frequency]}
        </div>
        {row.values.map((value) => (
          <div key={value.label} className="text-xs text-pilot-grey-700">
            {value.label}: {valueText(value.value)}
            {value.unit ? ` ${value.unit}` : ""}
          </div>
        ))}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-pilot-grey-600">
        {operationsDurationText(row.minutes)}
      </td>
      <td className="px-5 py-3 text-xs text-pilot-grey-700">
        {row.meterBefore === null && row.meterAfter === null ? (
          "—"
        ) : (
          <>
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
              <div className="font-medium text-pilot-grey-900">
                különbség:{" "}
                {operationsSignedNumberText(row.meterDifference, row.meterUnit)}
              </div>
            ) : null}
          </>
        )}
      </td>
      <td className="px-5 py-3">
        {row.anomaly ? (
          <div className="space-y-1">
            <PilotBadge variant="danger">Rendellenesség</PilotBadge>
            {row.anomalyNote ? (
              <p className="text-xs text-pilot-grey-700">{row.anomalyNote}</p>
            ) : null}
            {row.ticket ? (
              <p className="text-xs text-pilot-grey-600">
                Hibajegy:{" "}
                <Link
                  href={`/hibajegyek/${row.ticket.id}`}
                  className="font-mono text-pilot-aqua-700"
                >
                  {row.ticket.jobNumber}
                </Link>{" "}
                <PilotBadge
                  variant={partnerStatusBadgeVariant(
                    row.ticket.status as ServiceJobPartnerStatus,
                  )}
                >
                  {PARTNER_STATUS_LABELS[
                    row.ticket.status as ServiceJobPartnerStatus
                  ] ?? row.ticket.status}
                </PilotBadge>
              </p>
            ) : null}
          </div>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function valueText(value: number | boolean | string): string {
  if (typeof value === "number") return operationsNumberText(value);
  if (typeof value === "boolean") return value ? "igen" : "nem";
  return value;
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

/** The real browser behind `saveBlob`; the helper takes it injected. */
const browserSurface: FileSurface = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createAnchor: () => document.createElement("a"),
  later: (run, ms) => {
    window.setTimeout(run, ms);
  },
};
