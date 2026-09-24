"use client";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  FormField,
  Input,
} from "@acropora/ui";
import {
  aquariumMeasurementParametersFor,
  type AquariumMeasurementOccasion,
  type AquariumMeasurementParameterCode,
  type WaterType,
} from "@acropora/types";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { aquariumsApi } from "@/lib/api/aquariums";

/**
 * A "VÍZÉRTÉKEK" SZAKASZ -- FELVITEL, LISTA, EGYSZERŰ GRAFIKON.
 *
 * Balázs kérése (2026-09-24 14:37): "egy mérés = egy mérési alkalom, több
 * paraméterrel", a legutóbbi mérés a tetején, alatta a korábbiak
 * időrendben, paraméterenként egy egyszerű idősoros grafikon (az utolsó 90
 * nap). Tartomány/riasztás NINCS ebben a körben; szerkesztés nincs, csak
 * felvitel és törlés (megerősítéssel).
 *
 * CSAK MEGLÉVŐ AKVÁRIUMNÁL JELENIK MEG -- lásd `aquarium-editor-page.tsx`
 * hívási helyét: a mérés az `aquariumId`-hoz kötődik, új, még nem mentett
 * akváriumnál nincs mihez kötni.
 */
export function AquariumWaterValues({
  token,
  aquariumId,
  waterType,
  canSendEmail,
}: {
  token: string;
  aquariumId: string;
  waterType?: WaterType;
  canSendEmail: boolean;
}) {
  const [occasions, setOccasions] = useState<AquariumMeasurementOccasion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [values, setValues] = useState<
    Partial<Record<AquariumMeasurementParameterCode, string>>
  >({});
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [pendingDelete, setPendingDelete] =
    useState<AquariumMeasurementOccasion | null>(null);
  const [sendingEmailFor, setSendingEmailFor] = useState<string | null>(null);

  const parameters = useMemo(
    () => aquariumMeasurementParametersFor(waterType ?? null),
    [waterType],
  );

  function load() {
    setLoading(true);
    aquariumsApi
      .listMeasurements(token, aquariumId)
      .then((response) => setOccasions(response.occasions))
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A vízértékek nem tölthetők be.",
        ),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aquariumId, token]);

  async function submit() {
    const entries = Object.entries(values).filter(
      ([, raw]) => raw !== undefined && raw.trim() !== "",
    ) as [AquariumMeasurementParameterCode, string][];
    if (entries.length === 0) {
      setError("Adj meg legalább egy paramétert.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await aquariumsApi.createMeasurement(token, aquariumId, {
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
      load();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "A mérés nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeOccasion(occasion: AquariumMeasurementOccasion) {
    setBusy(true);
    setError(null);
    try {
      await aquariumsApi.deleteMeasurement(token, aquariumId, occasion.id);
      setOccasions((current) => current.filter((o) => o.id !== occasion.id));
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "A mérési alkalom nem törölhető.",
      );
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }

  async function sendEmail(occasion: AquariumMeasurementOccasion) {
    setSendingEmailFor(occasion.id);
    setError(null);
    setNotice(null);
    try {
      await aquariumsApi.sendMeasurementEmail(token, aquariumId, occasion.id);
      setNotice("Az eredmény elküldve e-mailben.");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Az e-mail nem küldhető el.",
      );
    } finally {
      setSendingEmailFor(null);
    }
  }

  const latest = occasions[0];
  const history = occasions.slice(1);

  return (
    <Card className="space-y-4 p-4">
      <h2 className="text-sm font-semibold text-dusk-800">Vízértékek</h2>
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {notice ? (
        <Alert variant="info" title="Kész" description={notice} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4">
        {parameters.map((param) => (
          <FormField key={param.code} label={`${param.label} (${param.unit})`}>
            <Input
              value={values[param.code] ?? ""}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [param.code]: event.target.value,
                }))
              }
            />
          </FormField>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Forrás (opcionális)">
          <Input value={source} onChange={(e) => setSource(e.target.value)} />
        </FormField>
        <FormField label="Megjegyzés (opcionális)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </div>
      <Button type="button" disabled={busy} onClick={() => void submit()}>
        Mérés rögzítése
      </Button>

      {loading ? (
        <p className="text-sm text-dusk-500">Betöltés…</p>
      ) : occasions.length === 0 ? (
        <p className="text-sm text-dusk-500">Még nincs rögzített mérés.</p>
      ) : (
        <div className="space-y-4">
          {latest ? (
            <OccasionCard
              occasion={latest}
              label="Legutóbbi mérés"
              parameters={parameters}
              canSendEmail={canSendEmail}
              sendingEmail={sendingEmailFor === latest.id}
              onDelete={() => setPendingDelete(latest)}
              onSendEmail={() => void sendEmail(latest)}
            />
          ) : null}

          {history.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase text-dusk-500">
                Korábbi mérések
              </h3>
              {history.map((occasion) => (
                <OccasionCard
                  key={occasion.id}
                  occasion={occasion}
                  parameters={parameters}
                  canSendEmail={canSendEmail}
                  sendingEmail={sendingEmailFor === occasion.id}
                  onDelete={() => setPendingDelete(occasion)}
                  onSendEmail={() => void sendEmail(occasion)}
                />
              ))}
            </div>
          ) : null}

          <ParameterCharts occasions={occasions} parameters={parameters} />
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title={
          pendingDelete
            ? `Törlöd ezt a mérési alkalmat: ${formatDate(pendingDelete.measuredAt)}?`
            : ""
        }
        consequence="A mérési alkalom minden paramétere lekerül a listáról."
        recovery="Visszaállításhoz újra fel kell venni, ugyanazokkal az értékekkel."
        confirmLabel="Törlés"
        busy={busy}
        onConfirm={() => {
          if (pendingDelete) void removeOccasion(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("hu-HU");
}

function OccasionCard({
  occasion,
  label,
  parameters,
  canSendEmail,
  sendingEmail,
  onDelete,
  onSendEmail,
}: {
  occasion: AquariumMeasurementOccasion;
  label?: string;
  parameters: readonly {
    code: AquariumMeasurementParameterCode;
    label: string;
    unit: string;
  }[];
  canSendEmail: boolean;
  sendingEmail: boolean;
  onDelete: () => void;
  onSendEmail: () => void;
}) {
  const labelByCode = new Map(parameters.map((p) => [p.code, p]));
  return (
    <div className="rounded border p-3">
      <div className="flex items-center justify-between">
        <div>
          {label ? (
            <p className="text-xs font-semibold uppercase text-dusk-500">
              {label}
            </p>
          ) : null}
          <p className="text-sm font-medium text-dusk-800">
            {formatDate(occasion.measuredAt)}
            {occasion.measuredByName ? ` · ${occasion.measuredByName}` : ""}
          </p>
          {occasion.source ? (
            <p className="text-xs text-dusk-500">{occasion.source}</p>
          ) : null}
          {occasion.notes ? (
            <p className="text-xs text-dusk-500">{occasion.notes}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {canSendEmail ? (
            <Button
              type="button"
              variant="secondary"
              disabled={sendingEmail}
              onClick={onSendEmail}
            >
              Eredmény küldése e-mailben
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onDelete}>
            Törlés
          </Button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {occasion.values.map((value) => {
          const param = labelByCode.get(value.parameterCode);
          return (
            <div key={value.parameterCode}>
              <span className="text-dusk-500">
                {param?.label ?? value.parameterCode}:
              </span>{" "}
              <span className="font-medium text-dusk-800">
                {value.value} {param?.unit ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CHART_WIDTH = 240;
const CHART_HEIGHT = 60;
const CHART_WINDOW_DAYS = 90;

/**
 * EGYSZERŰ SVG IDŐSOROS VONALDIAGRAM, PARAMÉTERENKÉNT -- ÚJ FÜGGŐSÉG NÉLKÜL.
 *
 * Balázs kérése "egyszerű" grafikonra szólt; a repóban ma nincs
 * chart-könyvtár, és egyetlen vonaldiagramért nem indokolt egyet bevezetni.
 * Csak azoknak a paramétereknek jelenik meg, amikhez legalább KÉT mérés van
 * az utolsó 90 napban -- egyetlen pontból nincs mit rajzolni.
 */
function ParameterCharts({
  occasions,
  parameters,
}: {
  occasions: readonly AquariumMeasurementOccasion[];
  parameters: readonly {
    code: AquariumMeasurementParameterCode;
    label: string;
    unit: string;
  }[];
}) {
  const cutoff = Date.now() - CHART_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const series = parameters
    .map((param) => {
      const points = occasions
        .map((occasion) => {
          const value = occasion.values.find(
            (v) => v.parameterCode === param.code,
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
        .sort((a, b) => a.at - b.at);
      return { param, points };
    })
    .filter(({ points }) => points.length >= 2);

  if (series.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase text-dusk-500">
        Alakulás (utolsó {CHART_WINDOW_DAYS} nap)
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {series.map(({ param, points }) => (
          <div key={param.code} className="rounded border p-2">
            <p className="text-xs text-dusk-500">
              {param.label} ({param.unit})
            </p>
            <Sparkline points={points} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({
  points,
}: {
  points: readonly { at: number; value: number }[];
}) {
  const minAt = points[0]!.at;
  const maxAt = points[points.length - 1]!.at;
  const values = points.map((p) => p.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spanAt = maxAt - minAt || 1;
  const spanValue = maxValue - minValue || 1;

  const coords = points.map((point) => {
    const x = ((point.at - minAt) / spanAt) * CHART_WIDTH;
    const y =
      CHART_HEIGHT - ((point.value - minValue) / spanValue) * CHART_HEIGHT;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      width={CHART_WIDTH}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label="Idősoros alakulás"
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="#2a4a52"
        strokeWidth={1.5}
      />
    </svg>
  );
}
