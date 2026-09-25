"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParametersFor,
  AQUARIUM_MEASUREMENT_PARAMETER_COLOR,
  type AquariumDetail,
  type AquariumMeasurementOccasion,
  type AquariumMeasurementParameterCode,
  type AquariumMeasurementParameterDefinition,
  type AquariumMeasurementTarget,
} from "@acropora/types";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Icon,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotThemeRoot,
} from "@acropora/ui";

import { partnerApi } from "@/lib/api";
import { WATER_BODY_LABEL, WATER_TYPE_LABEL } from "@/lib/aquarium-labels";

/**
 * "MÉRÉSI ELŐZMÉNYEK" -- ÖNÁLLÓ OLDAL A PORTÁLON, 2. kör (emlék 1847,
 * acrobot msg_id 23638). A belső `pilot-measurement-history-page.tsx`
 * másolata, PARTNER hatókörre szűkítve.
 *
 * === MI MARADT KI, ÉS MIÉRT ===
 *
 * `aquarium-measurements.service.ts` `sendEmail()` és `exportXlsx()` is
 * `requireInternalWriter`-rel zár -- lásd `aquarium-water-values.tsx`
 * fejlécét ugyanerről. Ez az oldal ezért a "PDF e-mailben" táblázat-oszlopot
 * és a "Letöltés Excelben" gombot (és a hozzá tartozó `PilotEmailDialog`-ot)
 * NEM veszi át. A szűrés, a grafikon (közös/külön skála), az
 * összehasonlító kártyák és a táblázat a belső oldal TELJES logikáját
 * követi.
 *
 * === NINCS `hasPermission`/`session` KAPU ===
 *
 * A belső oldal a saját `useAuth()`-ját és `hasPermission(user,
 * PERMISSIONS.AQUARIUMS_VIEW)`-t olvassa, mert több szerepkör közül azt is
 * ELUTASÍTHATJA, aki nincs feljogosítva. A portálon a hatókört a szerver
 * dönti el (`partnerApi.aquarium(id)`/`aquariumMeasurements(id)` idegen
 * akváriumra 404-et ad, nem 403-at) -- ugyanaz a minta, mint
 * `aquarium-detail.tsx` fejlécében.
 *
 * === NINCS `OWNERSHIP_LABEL` CÍMKE ===
 *
 * Az 1. kör (`aquarium-list.tsx`) szándékosan hagyta ki a tulajdon-típust
 * a portál listájáról ("nincs tulajdon-szűrő/oszlop, 'Helyszín' oszlop
 * 'Ügyfél' helyett"). Ez az oldal ugyanezt a döntést követi: a fejléc
 * csak a víztípus és a medence-típus címkét mutatja.
 */

const TIME_RANGE_OPTIONS = [
  { value: "30", label: "30 nap" },
  { value: "90", label: "90 nap" },
  { value: "365", label: "1 év" },
  { value: "all", label: "Összes" },
  { value: "egyeni", label: "Egyéni" },
] as const;
type TimeRange = (typeof TIME_RANGE_OPTIONS)[number]["value"];

const DEFAULT_PARAMS: Record<
  "TENGERI" | "EDESVIZI",
  AquariumMeasurementParameterCode[]
> = {
  TENGERI: ["KH", "KALCIUM", "MAGNEZIUM"],
  EDESVIZI: ["PH", "KH", "NITRAT"],
};

const TABLE_PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("hu-HU");
}

export function AquariumMeasurementHistory({
  aquariumId,
}: {
  aquariumId: string;
}) {
  const [aquarium, setAquarium] = useState<AquariumDetail | null>(null);
  const [occasions, setOccasions] = useState<AquariumMeasurementOccasion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [timeRange, setTimeRange] = useState<TimeRange>("90");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedParams, setSelectedParams] = useState<
    AquariumMeasurementParameterCode[]
  >([]);
  const [scale, setScale] = useState<"kozos" | "kulon">("kozos");
  const [compFrom, setCompFrom] = useState<string>("");
  const [compTo, setCompTo] = useState<string>("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      partnerApi.aquarium(aquariumId),
      partnerApi.aquariumMeasurements(aquariumId),
    ])
      .then(([detail, measurements]) => {
        if (!active) return;
        setAquarium(detail);
        setOccasions(measurements.occasions);
        const waterKey = detail.waterType ?? "TENGERI";
        setSelectedParams(DEFAULT_PARAMS[waterKey]);
        if (measurements.occasions.length >= 2) {
          setCompFrom(
            measurements.occasions[measurements.occasions.length - 1]!.id,
          );
          setCompTo(measurements.occasions[0]!.id);
        }
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A mérési előzmények nem tölthetők be.",
        ),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [aquariumId]);

  const parameters = useMemo(
    () => aquariumMeasurementParametersFor(aquarium?.waterType ?? null),
    [aquarium?.waterType],
  );

  const filteredOccasions = useMemo(() => {
    if (timeRange === "egyeni") {
      const from = customFrom ? new Date(customFrom) : null;
      const to = customTo ? new Date(customTo) : null;
      return occasions.filter((o) => {
        const at = new Date(o.measuredAt);
        return (!from || at >= from) && (!to || at <= to);
      });
    }
    if (timeRange === "all") return occasions;
    const days = timeRange === "30" ? 30 : timeRange === "90" ? 90 : 365;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return occasions.filter((o) => new Date(o.measuredAt).getTime() >= cutoff);
  }, [occasions, timeRange, customFrom, customTo]);

  // Idősoros sorrend a grafikonhoz -- az occasions API-válasz legújabb-elsőre rendezett.
  const chartRows = useMemo(() => {
    return [...filteredOccasions].reverse().map((occasion) => {
      const row: Record<string, number | string> = {
        measuredAt: occasion.measuredAt,
        datumLabel: formatDate(occasion.measuredAt),
      };
      for (const value of occasion.values)
        row[value.parameterCode] = value.value;
      return row;
    });
  }, [filteredOccasions]);

  const activeParams = useMemo(
    () => parameters.filter((p) => selectedParams.includes(p.code)),
    [parameters, selectedParams],
  );

  const toggleParam = (code: AquariumMeasurementParameterCode) => {
    setSelectedParams((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code],
    );
  };

  const tablePageCount = Math.ceil(filteredOccasions.length / TABLE_PAGE_SIZE);
  const tableRows = filteredOccasions.slice(
    page * TABLE_PAGE_SIZE,
    (page + 1) * TABLE_PAGE_SIZE,
  );

  const compFromOccasion = occasions.find((o) => o.id === compFrom);
  const compToOccasion = occasions.find((o) => o.id === compTo);

  if (error)
    return (
      <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50 px-8 py-6">
        <p className="text-sm text-red-600">{error}</p>
      </PilotThemeRoot>
    );
  if (loading || !aquarium)
    return (
      <PilotThemeRoot className="-m-6 h-96 animate-pulse bg-pilot-grey-100" />
    );

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400">
          <Link
            href="/akvariumok"
            className="transition-colors hover:text-pilot-aqua-600"
          >
            Akváriumok
          </Link>
          <span>/</span>
          <Link
            href={`/akvariumok/${aquariumId}`}
            className="transition-colors hover:text-pilot-aqua-600"
          >
            {aquarium.name}
          </Link>
          <span>/</span>
          <span className="font-medium text-pilot-grey-700">
            Mérési előzmények
          </span>
        </nav>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-pilot-grey-900">
              {aquarium.name}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              {aquarium.waterType ? (
                <PilotBadge variant="teal">
                  {WATER_TYPE_LABEL[aquarium.waterType]}
                </PilotBadge>
              ) : null}
              <PilotBadge variant="grey">
                {WATER_BODY_LABEL[aquarium.waterBodyType]}
              </PilotBadge>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 px-8 py-6">
        {occasions.length === 0 ? (
          <PilotCard className="p-5">
            <HistoryEmptyState aquariumId={aquariumId} />
          </PilotCard>
        ) : (
          <>
            {/* Szűrősáv */}
            <PilotCard>
              <div className="flex flex-wrap items-start gap-5 px-5 py-4">
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                    Időszak
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    {TIME_RANGE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setTimeRange(opt.value);
                          setPage(0);
                        }}
                        className={`cursor-pointer rounded-md border px-3 py-1 text-xs font-medium transition-all ${
                          timeRange === opt.value
                            ? "border-pilot-grey-900 bg-pilot-grey-900 text-white"
                            : "border-pilot-grey-200 bg-white text-pilot-grey-600 hover:bg-pilot-grey-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {timeRange === "egyeni" ? (
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="rounded-md px-2.5 py-1 text-xs text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                      />
                      <span className="text-xs text-pilot-grey-400">–</span>
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="rounded-md px-2.5 py-1 text-xs text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="h-auto w-px self-stretch bg-pilot-grey-100" />

                <div className="flex flex-1 flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                    Paraméterek
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {parameters.map((param) => {
                      const active = selectedParams.includes(param.code);
                      const hasData = filteredOccasions.some((o) =>
                        o.values.some((v) => v.parameterCode === param.code),
                      );
                      return (
                        <div
                          key={param.code}
                          className="flex items-center gap-1"
                        >
                          <button
                            type="button"
                            onClick={() => toggleParam(param.code)}
                            className={`cursor-pointer whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                              active
                                ? "border-pilot-aqua-600 bg-pilot-aqua-600 text-white"
                                : "border-pilot-grey-200 bg-white text-pilot-grey-600 hover:border-pilot-grey-300 hover:bg-pilot-grey-50"
                            }`}
                          >
                            {param.label} ({param.unit})
                          </button>
                          {active && !hasData ? (
                            <span className="text-[10px] italic text-pilot-grey-300">
                              nincs adat
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </PilotCard>

            {/* Grafikon */}
            <PilotCard>
              <div className="flex items-center justify-between border-b border-pilot-grey-100 px-5 py-4">
                <h3 className="text-sm font-semibold text-pilot-grey-900">
                  Értékek időben
                </h3>
                {filteredOccasions.length > 1 ? (
                  <div className="inline-flex gap-0.5 rounded-md bg-pilot-grey-100 p-0.5">
                    {(
                      [
                        ["kozos", "Közös skála"],
                        ["kulon", "Külön skálák"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setScale(value)}
                        className={`cursor-pointer rounded px-3 py-1 text-xs font-medium transition-all ${
                          scale === value
                            ? "bg-white text-pilot-grey-900 shadow-sm"
                            : "bg-transparent text-pilot-grey-500 hover:text-pilot-grey-700"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="px-5 py-5">
                {filteredOccasions.length === 0 ? (
                  <p className="py-12 text-center text-sm text-pilot-grey-400">
                    Nincs találat ebben az időszakban.
                  </p>
                ) : filteredOccasions.length === 1 ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-pilot-grey-200 bg-pilot-grey-50/60 py-12 text-center">
                    <p className="max-w-sm text-sm text-pilot-grey-500">
                      Egy mérésből még nincs görbe, a második után jelenik meg.
                    </p>
                    <p className="text-xs text-pilot-grey-400">
                      Egyetlen rögzített mérés:{" "}
                      <span className="font-medium">
                        {formatDate(filteredOccasions[0]!.measuredAt)}
                      </span>
                    </p>
                  </div>
                ) : activeParams.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-sm text-pilot-grey-400">
                    Válassz legalább egy paramétert a megjelenítéshez.
                  </div>
                ) : scale === "kozos" ? (
                  <CombinedChart
                    data={chartRows}
                    params={activeParams}
                    waterType={aquarium.waterType}
                    targets={aquarium.targets}
                  />
                ) : (
                  <SmallMultiples
                    data={chartRows}
                    params={activeParams}
                    waterType={aquarium.waterType}
                    targets={aquarium.targets}
                    hasData={(code) =>
                      filteredOccasions.some((o) =>
                        o.values.some((v) => v.parameterCode === code),
                      )
                    }
                  />
                )}
              </div>
            </PilotCard>

            {/* Összehasonlítás */}
            {occasions.length > 1 ? (
              <PilotCard>
                <PilotCardHeader title="Két mérés összehasonlítása" />
                <div className="px-5 py-4">
                  <div className="mb-5 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-pilot-grey-500">
                        Ettől:
                      </span>
                      <select
                        value={compFrom}
                        onChange={(e) => setCompFrom(e.target.value)}
                        className="cursor-pointer rounded-md px-2.5 py-1.5 text-xs text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                      >
                        {occasions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {formatDate(o.measuredAt)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-pilot-grey-500">
                        Eddig:
                      </span>
                      <select
                        value={compTo}
                        onChange={(e) => setCompTo(e.target.value)}
                        className="cursor-pointer rounded-md px-2.5 py-1.5 text-xs text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                      >
                        {occasions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {formatDate(o.measuredAt)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {activeParams.map((param) => (
                      <ComparisonTile
                        key={param.code}
                        param={param}
                        waterType={aquarium.waterType}
                        targets={aquarium.targets}
                        from={compFromOccasion}
                        to={compToOccasion}
                      />
                    ))}
                    {activeParams.length === 0 ? (
                      <p className="text-sm text-pilot-grey-400">
                        Válassz legalább egy paramétert.
                      </p>
                    ) : null}
                  </div>
                </div>
              </PilotCard>
            ) : null}

            {/* Táblázat */}
            <PilotCard>
              <PilotCardHeader title="Minden mérés" />
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-pilot-grey-100 bg-white">
                      <th className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-3 text-left font-medium uppercase tracking-wide text-pilot-grey-400">
                        Időpont
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-medium uppercase tracking-wide text-pilot-grey-400">
                        Mérte
                      </th>
                      {activeParams.map((param) => (
                        <th
                          key={param.code}
                          className="whitespace-nowrap px-4 py-3 text-right font-medium uppercase tracking-wide text-pilot-grey-400"
                        >
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{
                                backgroundColor:
                                  AQUARIUM_MEASUREMENT_PARAMETER_COLOR[
                                    param.code
                                  ],
                              }}
                            />
                            {param.label}
                            <span className="text-pilot-grey-300">
                              ({param.unit})
                            </span>
                          </span>
                        </th>
                      ))}
                      <th className="px-4 py-3 text-left font-medium uppercase tracking-wide text-pilot-grey-400">
                        Megjegyzés
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((occasion, index) => {
                      const byCode = new Map(
                        occasion.values.map((v) => [v.parameterCode, v.value]),
                      );
                      return (
                        <tr
                          key={occasion.id}
                          className={`border-b border-pilot-grey-50 transition-colors hover:bg-pilot-aqua-50/30 ${
                            index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/40"
                          }`}
                        >
                          <td
                            className={`sticky left-0 z-10 whitespace-nowrap px-4 py-3 font-medium text-pilot-grey-700 ${
                              index % 2 === 0
                                ? "bg-white"
                                : "bg-pilot-grey-50/70"
                            }`}
                          >
                            {formatDateTime(occasion.measuredAt)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-pilot-grey-500">
                            {occasion.measuredByName ?? "—"}
                          </td>
                          {activeParams.map((param) => {
                            const value = byCode.get(param.code);
                            const range =
                              aquariumEffectiveMeasurementTargetRange(
                                aquarium.waterType,
                                param.code,
                                aquarium.targets,
                              );
                            const out =
                              value !== undefined &&
                              range !== undefined &&
                              ((range.min !== undefined && value < range.min) ||
                                (range.max !== undefined && value > range.max));
                            return (
                              <td
                                key={param.code}
                                className={`px-4 py-3 text-right font-mono tabular-nums ${
                                  out
                                    ? "font-semibold text-amber-600"
                                    : "text-pilot-grey-700"
                                }`}
                              >
                                {value !== undefined ? (
                                  value
                                ) : (
                                  <span className="text-pilot-grey-200">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="max-w-[200px] truncate px-4 py-3 text-pilot-grey-400">
                            {occasion.notes || (
                              <span className="text-pilot-grey-200">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {tableRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={activeParams.length + 3}
                          className="px-4 py-10 text-center text-sm text-pilot-grey-300"
                        >
                          Nincs találat ebben az időszakban.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {tablePageCount > 1 ? (
                <div className="flex items-center justify-between border-t border-pilot-grey-100 px-5 py-3">
                  <p className="text-xs text-pilot-grey-400">
                    {filteredOccasions.length} mérés, {TABLE_PAGE_SIZE} / oldal
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-pilot-grey-600 ring-1 ring-pilot-grey-200 transition hover:bg-pilot-grey-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ← Előző
                    </button>
                    {Array.from({ length: tablePageCount }).map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setPage(i)}
                        className={`h-7 w-7 cursor-pointer rounded-md text-xs font-medium transition ${
                          i === page
                            ? "bg-pilot-grey-900 text-white"
                            : "bg-transparent text-pilot-grey-500 hover:bg-pilot-grey-100"
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setPage((p) => Math.min(tablePageCount - 1, p + 1))
                      }
                      disabled={page === tablePageCount - 1}
                      className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-pilot-grey-600 ring-1 ring-pilot-grey-200 transition hover:bg-pilot-grey-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Következő →
                    </button>
                  </div>
                </div>
              ) : null}
            </PilotCard>
          </>
        )}
      </div>
    </PilotThemeRoot>
  );
}

function HistoryEmptyState({ aquariumId }: { aquariumId: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
        <Icon name="aquarium" size={24} className="text-pilot-aqua-600" />
      </div>
      <div className="text-center">
        <p className="mb-1 text-sm font-semibold text-pilot-grey-700">
          Még nincs mérés
        </p>
        <p className="max-w-xs text-xs text-pilot-grey-400">
          Rögzítsd az első vízmérést, hogy nyomon követhesd a paramétereket
          időben.
        </p>
      </div>
      <Link href={`/akvariumok/${aquariumId}`}>
        <PilotButton variant="primary">
          <Icon name="plus" size={13} />
          Vissza az adatlapra
        </PilotButton>
      </Link>
    </div>
  );
}

function ComparisonTile({
  param,
  waterType,
  targets,
  from,
  to,
}: {
  param: AquariumMeasurementParameterDefinition;
  waterType: AquariumDetail["waterType"];
  targets: AquariumMeasurementTarget[];
  from: AquariumMeasurementOccasion | undefined;
  to: AquariumMeasurementOccasion | undefined;
}) {
  const a = from?.values.find((v) => v.parameterCode === param.code)?.value;
  const b = to?.values.find((v) => v.parameterCode === param.code)?.value;
  if (a === undefined || b === undefined) return null;
  const diff = b - a;
  const range = aquariumEffectiveMeasurementTargetRange(
    waterType,
    param.code,
    targets,
  );
  const outOfRange =
    diff !== 0 &&
    range !== undefined &&
    ((range.min !== undefined && b < range.min) ||
      (range.max !== undefined && b > range.max));

  return (
    <div className="flex min-w-[140px] flex-col gap-1 rounded-xl px-4 py-3 ring-1 ring-pilot-grey-200">
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: AQUARIUM_MEASUREMENT_PARAMETER_COLOR[param.code],
          }}
        />
        <p className="text-xs font-medium text-pilot-grey-500">{param.label}</p>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-xs text-pilot-grey-400">{a}</span>
        <span className="text-xs text-pilot-grey-300">→</span>
        <span className="font-mono text-sm font-semibold text-pilot-grey-900">
          {b}
        </span>
        <span className="text-[10px] text-pilot-grey-400">{param.unit}</span>
      </div>
      <div
        className={`flex items-center gap-1 text-xs font-medium ${
          outOfRange
            ? "text-amber-600"
            : diff > 0
              ? "text-pilot-aqua-600"
              : diff < 0
                ? "text-pilot-grey-500"
                : "text-pilot-grey-300"
        }`}
      >
        {diff > 0 ? "↑" : diff < 0 ? "↓" : "—"}
        {diff !== 0 ? (
          <span className="font-mono">
            {Math.abs(Math.round(diff * 100) / 100)}
          </span>
        ) : null}
        {outOfRange ? (
          <span className="ml-1 text-[10px] text-amber-500">
            célértéken kívül
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: {
    color?: string;
    name?: string;
    value?: number;
    dataKey?: string;
    payload: Record<string, number | string>;
  }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="min-w-[180px] rounded-xl bg-white px-4 py-3 shadow-xl ring-1 ring-pilot-grey-200">
      <p className="mb-2 text-xs font-semibold text-pilot-grey-700">
        {row?.datumLabel}
      </p>
      {payload.map((p) => (
        <div
          key={p.dataKey}
          className="flex items-center justify-between gap-4 py-0.5"
        >
          <div className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-xs text-pilot-grey-500">{p.name}</span>
          </div>
          <span className="font-mono text-xs font-semibold text-pilot-grey-900">
            {p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function CombinedChart({
  data,
  params,
  waterType,
  targets,
}: {
  data: Record<string, number | string>[];
  params: AquariumMeasurementParameterDefinition[];
  waterType: AquariumDetail["waterType"];
  targets: AquariumMeasurementTarget[];
}) {
  return (
    <div style={{ height: 340 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e5e9" />
          <XAxis
            dataKey="datumLabel"
            tick={{ fontSize: 10, fill: "#9ba3ae" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#9ba3ae" }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            formatter={(value) => {
              const param = params.find((p) => p.label === value);
              return (
                <span style={{ fontSize: 11, color: "#6b7583" }}>
                  {value}
                  {param ? ` (${param.unit})` : ""}
                </span>
              );
            }}
          />
          {params.map((param) => {
            const range = aquariumEffectiveMeasurementTargetRange(
              waterType,
              param.code,
              targets,
            );
            const color = AQUARIUM_MEASUREMENT_PARAMETER_COLOR[param.code];
            return (
              <Line
                key={param.code}
                type="monotone"
                dataKey={param.code}
                name={param.label}
                stroke={color}
                strokeWidth={2}
                connectNulls
                dot={(dotProps: {
                  cx?: number;
                  cy?: number;
                  value?: number;
                }) => {
                  const { cx = 0, cy = 0, value = 0 } = dotProps;
                  const out =
                    range &&
                    ((range.min !== undefined && value < range.min) ||
                      (range.max !== undefined && value > range.max));
                  return (
                    <circle
                      key={`${param.code}-${cx}-${cy}`}
                      cx={cx}
                      cy={cy}
                      r={3.5}
                      fill={out ? "#d97706" : color}
                      stroke="white"
                      strokeWidth={1.5}
                    />
                  );
                }}
                activeDot={{ r: 5 }}
              />
            );
          })}
          {(() => {
            const range = aquariumEffectiveMeasurementTargetRange(
              waterType,
              params[0]!.code,
              targets,
            );
            return range ? (
              <ReferenceArea
                y1={range.min}
                y2={range.max}
                fill={AQUARIUM_MEASUREMENT_PARAMETER_COLOR[params[0]!.code]}
                fillOpacity={0.05}
                stroke="none"
              />
            ) : null;
          })()}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SmallMultiples({
  data,
  params,
  waterType,
  targets,
  hasData,
}: {
  data: Record<string, number | string>[];
  params: AquariumMeasurementParameterDefinition[];
  waterType: AquariumDetail["waterType"];
  targets: AquariumMeasurementTarget[];
  hasData: (code: AquariumMeasurementParameterCode) => boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {params.map((param) => {
        const color = AQUARIUM_MEASUREMENT_PARAMETER_COLOR[param.code];
        const range = aquariumEffectiveMeasurementTargetRange(
          waterType,
          param.code,
          targets,
        );
        const paramHasData = hasData(param.code);
        return (
          <div key={param.code}>
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <p className="text-xs font-medium text-pilot-grey-600">
                {param.label} ({param.unit})
              </p>
              {!paramHasData ? (
                <span className="text-[10px] italic text-pilot-grey-300">
                  nincs adat ebben az időszakban
                </span>
              ) : null}
            </div>
            {paramHasData ? (
              <div style={{ height: 100 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data}
                    margin={{ top: 4, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f3" />
                    <XAxis dataKey="datumLabel" hide />
                    <YAxis
                      tick={{ fontSize: 9, fill: "#9ba3ae" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    {range ? (
                      <ReferenceArea
                        y1={range.min}
                        y2={range.max}
                        fill={color}
                        fillOpacity={0.07}
                        stroke="none"
                        label={{
                          value: "Célérték",
                          position: "insideTopRight",
                          fontSize: 9,
                          fill: color,
                        }}
                      />
                    ) : null}
                    <Line
                      type="monotone"
                      dataKey={param.code}
                      name={param.label}
                      stroke={color}
                      strokeWidth={1.5}
                      connectNulls
                      dot={(dotProps: {
                        cx?: number;
                        cy?: number;
                        value?: number;
                      }) => {
                        const { cx = 0, cy = 0, value = 0 } = dotProps;
                        const out =
                          range &&
                          ((range.min !== undefined && value < range.min) ||
                            (range.max !== undefined && value > range.max));
                        return (
                          <circle
                            key={`${param.code}-${cx}-${cy}`}
                            cx={cx}
                            cy={cy}
                            r={2.5}
                            fill={out ? "#d97706" : color}
                            stroke="white"
                            strokeWidth={1}
                          />
                        );
                      }}
                    />
                    {range?.min !== undefined ? (
                      <ReferenceLine
                        y={range.min}
                        stroke={color}
                        strokeDasharray="4 3"
                        strokeOpacity={0.4}
                      />
                    ) : null}
                    {range?.max !== undefined ? (
                      <ReferenceLine
                        y={range.max}
                        stroke={color}
                        strokeDasharray="4 3"
                        strokeOpacity={0.4}
                      />
                    ) : null}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-12 items-center justify-center rounded-lg bg-pilot-grey-50">
                <span className="text-xs text-pilot-grey-300">
                  nincs adat ebben az időszakban
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
