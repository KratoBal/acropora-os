"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParametersFor,
  type AquariumMeasurementOccasion,
  type AquariumMeasurementParameterCode,
  type AquariumMeasurementTarget,
  type WaterType,
} from "@acropora/types";
import {
  Icon,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDrawer,
  PilotFormField,
  PilotInput,
} from "@acropora/ui";

import { partnerApi } from "@/lib/api";
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/aquariums/measurement-time";

/**
 * A "VÍZÉRTÉKEK" KÁRTYA A PORTÁLON -- 2. kör (Balázs sorrendje, emlék 1847,
 * acrobot msg_id 23638), a belső `pilot-aquarium-water-values.tsx` másolata,
 * PARTNER hatókörre szűkítve.
 *
 * === MI MARADT KI A BELSŐ KÁRTYÁHOZ KÉPEST, ÉS MIÉRT ===
 *
 * A `aquarium-measurements.service.ts` mind a törlést (`delete`), mind az
 * e-mail küldést (`sendEmail`), mind az Excel-exportot (`exportXlsx`)
 * `requireInternalWriter`-rel zárja, a saját fejlécük szó szerint: "Balázs
 * 2026-09-25-i döntése a portálra a listát, adatlapot és ÚJ mérést
 * engedte, törlést nem." A `create()` VISZONT NYITOTT -- nincs
 * `requireInternalWriter` hívás benne. Ez a kártya ezért a tiltott
 * hármat (törlés gomb, "E-mail küldés" gomb, `PilotEmailDialog`)
 * KIHAGYJA, a felvitelt (drawer, "Új mérés") és a listát MEGTARTJA.
 *
 * === NINCS `token` PARAMÉTER ===
 *
 * A belső web `aquariumsApi.listMeasurements(token, ...)` explicit
 * tokent visz (a belső auth mintája). A portál `partnerApi` a saját,
 * cookie-alapú session-jét használja -- lásd `aquarium-detail.tsx`
 * fejlécét ugyanerről a különbségről a `partnerApi.aquarium(id)`-nál.
 *
 * === A SPARKLINE MÁSOLAT, NEM ÚJRAÍRÁS ===
 *
 * `PilotSparkline` a belső fájl betű szerinti másolata -- saját SVG,
 * nincs `recharts`-függősége (azt csak a teljes előzmény-oldal, a
 * `/akvariumok/[id]/meresek` route használja).
 */
export function AquariumWaterValues({
  aquariumId,
  waterType,
  targets,
}: {
  aquariumId: string;
  waterType?: WaterType;
  targets?: AquariumMeasurementTarget[];
}) {
  const router = useRouter();
  const [occasions, setOccasions] = useState<AquariumMeasurementOccasion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [values, setValues] = useState<
    Partial<Record<AquariumMeasurementParameterCode, string>>
  >({});
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [measuredAtValue, setMeasuredAtValue] = useState(() =>
    toDatetimeLocalValue(new Date()),
  );
  const [measuredAtTouched, setMeasuredAtTouched] = useState(false);
  const [selectedParam, setSelectedParam] =
    useState<AquariumMeasurementParameterCode | null>(null);

  const parameters = useMemo(
    () => aquariumMeasurementParametersFor(waterType ?? null),
    [waterType],
  );

  const load = useCallback(() => {
    setLoading(true);
    partnerApi
      .aquariumMeasurements(aquariumId)
      .then((response) => setOccasions(response.occasions))
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A vízértékek nem tölthetők be.",
        ),
      )
      .finally(() => setLoading(false));
  }, [aquariumId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    const entries = Object.entries(values).filter(
      ([, raw]) => raw !== undefined && raw.trim() !== "",
    ) as [AquariumMeasurementParameterCode, string][];
    if (entries.length === 0) {
      setError("Adj meg legalább egy paramétert.");
      return;
    }

    /**
     * ÉRINTETLENÜL NEM KÜLDÜNK `measuredAt`-et -- a szerver a MENTÉS
     * PILLANATÁT írja. Ugyanaz az ellenőrzés és ugyanaz a szöveg, mint a
     * belső kártyánál (`pilot-aquarium-water-values.tsx` `submit()`
     * fejléce) és a szerveren (`aquarium-measurements.service.ts`
     * `rejectFutureMeasuredAt`).
     */
    let measuredAt: string | undefined;
    if (measuredAtTouched) {
      const parsed = fromDatetimeLocalValue(measuredAtValue);
      if (!parsed) {
        setError("A mérés ideje érvénytelen.");
        return;
      }
      if (parsed.getTime() > Date.now()) {
        setError("A mérés ideje nem lehet a jövőben.");
        return;
      }
      measuredAt = parsed.toISOString();
    }

    setBusy(true);
    setError(null);
    try {
      await partnerApi.createAquariumMeasurement(aquariumId, {
        measuredAt,
        source: source || undefined,
        notes: notes || undefined,
        values: entries.map(([parameterCode, raw]) => ({
          parameterCode,
          value: Number(raw.replace(",", ".")),
        })),
      });
      setValues({});
      setSource("");
      setNotes("");
      setMeasuredAtValue(toDatetimeLocalValue(new Date()));
      setMeasuredAtTouched(false);
      setDrawerOpen(false);
      load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mérés nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  }

  const latest = occasions[0];
  const activeParam = selectedParam ?? latest?.values[0]?.parameterCode ?? null;
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const activePoints = activeParam
    ? occasions
        .map((occasion) => {
          const value = occasion.values.find(
            (v) => v.parameterCode === activeParam,
          );
          return value
            ? {
                at: new Date(occasion.measuredAt).getTime(),
                value: value.value,
              }
            : null;
        })
        .filter(
          (point): point is { at: number; value: number } =>
            point !== null && point.at >= cutoff,
        )
        .sort((a, b) => a.at - b.at)
    : [];

  return (
    <PilotCard>
      <PilotCardHeader
        title="Vízértékek"
        action={
          <PilotButton variant="primary" onClick={() => setDrawerOpen(true)}>
            <Icon name="plus" size={13} />
            Új mérés
          </PilotButton>
        }
      />

      {error ? <p className="px-5 pt-3 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="px-5 py-6 text-sm text-pilot-grey-500">Betöltés…</p>
      ) : occasions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pilot-aqua-50">
            <Icon name="aquarium" size={18} className="text-pilot-aqua-600" />
          </div>
          <p className="text-sm font-medium text-pilot-grey-700">
            Még nincs mérés
          </p>
          <p className="text-xs text-pilot-grey-400">
            Rögzítsd az első vízmérést, hogy nyomon követhesd a paramétereket.
          </p>
          <PilotButton variant="primary" onClick={() => setDrawerOpen(true)}>
            <Icon name="plus" size={13} />
            Új mérés
          </PilotButton>
        </div>
      ) : (
        <>
          <div className="border-b border-pilot-grey-100 bg-pilot-grey-50/60 px-4 py-3">
            <p className="text-xs text-pilot-grey-400">
              Utolsó mérés: {latest ? formatDate(latest.measuredAt) : "—"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 px-4 py-4 sm:grid-cols-4">
            {(latest?.values ?? []).map((value) => {
              const param = parameters.find(
                (p) => p.code === value.parameterCode,
              );
              const selected = activeParam === value.parameterCode;
              const range = aquariumEffectiveMeasurementTargetRange(
                waterType,
                value.parameterCode,
                targets,
              );
              const outOfRange =
                range !== undefined &&
                ((range.min !== undefined && value.value < range.min) ||
                  (range.max !== undefined && value.value > range.max));
              return (
                <button
                  key={value.parameterCode}
                  type="button"
                  onClick={() => setSelectedParam(value.parameterCode)}
                  title={
                    outOfRange ? "A megadott céltartományon kívül" : undefined
                  }
                  className={`cursor-pointer rounded-lg p-2.5 text-left ring-1 transition-all ${
                    selected
                      ? "bg-pilot-aqua-600 text-white ring-transparent"
                      : outOfRange
                        ? "bg-amber-50 ring-amber-200 hover:bg-amber-100"
                        : "bg-pilot-grey-50 ring-transparent hover:bg-pilot-grey-100"
                  }`}
                >
                  <p
                    className={`mb-0.5 text-[10px] font-medium ${
                      selected
                        ? "text-pilot-aqua-100"
                        : outOfRange
                          ? "text-amber-600"
                          : "text-pilot-grey-400"
                    }`}
                  >
                    {param?.label ?? value.parameterCode}
                    {outOfRange && !selected ? " ⚠" : ""}
                  </p>
                  <p
                    className={`font-mono text-sm font-semibold tabular-nums ${
                      selected
                        ? "text-white"
                        : outOfRange
                          ? "text-amber-700"
                          : "text-pilot-grey-900"
                    }`}
                  >
                    {value.value}
                  </p>
                  {param?.unit ? (
                    <p
                      className={`text-[10px] ${
                        selected ? "text-pilot-aqua-200" : "text-pilot-grey-400"
                      }`}
                    >
                      {param.unit}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
          {activeParam && activePoints.length >= 2 ? (
            <div className="px-4 pb-4">
              <p className="mb-2 text-[11px] text-pilot-grey-400">
                {parameters.find((p) => p.code === activeParam)?.label ??
                  activeParam}{" "}
                – elmúlt 90 nap
              </p>
              <PilotSparkline points={activePoints} />
            </div>
          ) : null}
          <div className="px-4 pb-4">
            <PilotButton
              variant="primary"
              onClick={() => router.push(`/akvariumok/${aquariumId}/meresek`)}
            >
              Összes mérés és grafikon
            </PilotButton>
          </div>
          <div className="border-t border-pilot-grey-100">
            {occasions.map((occasion) => (
              <div
                key={occasion.id}
                className="border-t border-pilot-grey-50 px-5 py-2.5 first:border-t-0 hover:bg-pilot-grey-50"
              >
                <span className="text-xs text-pilot-grey-600">
                  {formatDate(occasion.measuredAt)}
                </span>
                {occasion.measuredByName ? (
                  <span className="text-xs text-pilot-grey-400">
                    {" "}
                    · {occasion.measuredByName}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}

      <PilotDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Új vízmérés"
      >
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-1">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
              Paraméterek
            </p>
            <p className="mb-3 text-xs text-pilot-grey-300">
              Csak a kitöltött sorokat menti a rendszer.
            </p>
            <div className="flex flex-col divide-y divide-pilot-grey-50">
              {parameters.map((param) => (
                <div
                  key={param.code}
                  className="flex items-center gap-3 py-2.5"
                >
                  <span
                    className={`flex-1 text-sm ${
                      values[param.code]
                        ? "font-medium text-pilot-grey-800"
                        : "text-pilot-grey-400"
                    }`}
                  >
                    {param.label}
                  </span>
                  <div className="relative w-28">
                    <input
                      type="number"
                      step="any"
                      placeholder="—"
                      value={values[param.code] ?? ""}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [param.code]: event.target.value,
                        }))
                      }
                      className="w-full rounded-md py-1.5 pl-3 pr-10 text-right text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-pilot-grey-300">
                      {param.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <PilotFormField label="Mérés ideje">
            <PilotInput
              type="datetime-local"
              value={measuredAtValue}
              max={toDatetimeLocalValue(new Date())}
              onChange={(value) => {
                setMeasuredAtValue(value);
                setMeasuredAtTouched(true);
              }}
            />
          </PilotFormField>
          <div className="grid grid-cols-2 gap-3">
            <PilotFormField label="Forrás (opcionális)">
              <PilotInput value={source} onChange={setSource} />
            </PilotFormField>
            <PilotFormField label="Megjegyzés (opcionális)">
              <PilotInput value={notes} onChange={setNotes} />
            </PilotFormField>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-pilot-grey-100 px-6 py-4">
          <PilotButton variant="secondary" onClick={() => setDrawerOpen(false)}>
            Mégse
          </PilotButton>
          <PilotButton
            variant="primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            Mérés mentése
          </PilotButton>
        </div>
      </PilotDrawer>
    </PilotCard>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("hu-HU");
}

function PilotSparkline({
  points,
}: {
  points: readonly { at: number; value: number }[];
}) {
  const width = 280;
  const height = 64;
  const minAt = points[0]!.at;
  const maxAt = points[points.length - 1]!.at;
  const values = points.map((p) => p.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spanAt = maxAt - minAt || 1;
  const spanValue = maxValue - minValue || 1;
  const coords = points.map((point) => {
    const x = ((point.at - minAt) / spanAt) * width;
    const y = height - ((point.value - minValue) / spanValue) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${height} ${coords.join(" ")} ${width},${height}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Idősoros alakulás"
      className="overflow-visible"
    >
      <defs>
        <linearGradient id="pilot-sparkline-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b7a6e" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#0b7a6e" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#pilot-sparkline-fill)" />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="#0b7a6e"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
