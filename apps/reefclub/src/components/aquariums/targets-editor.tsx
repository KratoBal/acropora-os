"use client";

import {
  aquariumMeasurementParametersFor,
  aquariumMeasurementTargetRange,
  type AquariumMeasurementParameterCode,
} from "@acropora/types";
import { Alert, Button, Input } from "@acropora/ui";
import { useState, type FormEvent } from "react";

import { rc } from "@/lib/api";
import { parseDecimal } from "@/lib/labels";
import { formatValue } from "@/lib/series";
import type { ReefClubAquarium, ReefClubTarget } from "@/lib/types";

interface Row {
  min: string;
  max: string;
}

function asText(value: number | null): string {
  return value === null ? "" : String(value).replace(".", ",");
}

/**
 * The aquarium's OWN target ranges (plan 3.4: PUT /aquariums/:id/targets,
 * an own aquarium only). The whole set goes at once and what is not sent is
 * removed on the server, so a parameter left empty falls back to the default
 * range: "ha nincs megadva, az alapértékből" (the OS's rule). A range may
 * have only one bound; a row with neither is not sent.
 */
export function TargetsEditor({
  aquarium,
  targets,
  onSaved,
}: {
  aquarium: ReefClubAquarium;
  targets: ReefClubTarget[];
  onSaved(): Promise<void>;
}) {
  const parameters = aquariumMeasurementParametersFor(aquarium.waterType);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      targets.map((t) => [
        t.parameterCode,
        { min: asText(t.min), max: asText(t.max) },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = new Map<string, string>();
  const body: { parameterCode: string; min?: number; max?: number }[] = [];
  // THE STORED RANGES THIS FORM DOES NOT SHOW GO BACK UNCHANGED (barracuda, #1744 note a):
  // the form lists the parameters of the CURRENT water type, but the save sends the whole
  // set and the server removes what is not sent. An own range kept for a parameter that
  // is not on the list now (the water type was changed since) would be deleted silently.
  const shown = new Set<string>(parameters.map((parameter) => parameter.code));
  for (const stored of targets) {
    if (shown.has(stored.parameterCode)) continue;
    body.push({
      parameterCode: stored.parameterCode,
      ...(stored.min !== null ? { min: stored.min } : {}),
      ...(stored.max !== null ? { max: stored.max } : {}),
    });
  }
  for (const parameter of parameters) {
    const row = rows[parameter.code] ?? { min: "", max: "" };
    const min = row.min.trim() === "" ? undefined : parseDecimal(row.min);
    const max = row.max.trim() === "" ? undefined : parseDecimal(row.max);
    if (min === null || max === null) {
      problems.set(parameter.code, "Számot írj, például 8,2.");
      continue;
    }
    if (min !== undefined && max !== undefined && min > max) {
      problems.set(
        parameter.code,
        "Az alsó határ nem lehet nagyobb a felsőnél.",
      );
      continue;
    }
    if (min !== undefined || max !== undefined)
      body.push({
        parameterCode: parameter.code,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rc("PUT", `/aquariums/${encodeURIComponent(aquarium.id)}/targets`, {
        body: { targets: body },
      });
      setOpen(false);
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A célsávok mentése nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Célsávok szerkesztése
      </Button>
    );

  return (
    <form
      onSubmit={save}
      className="space-y-3 rounded-xl border border-line bg-white p-4"
      noValidate
    >
      <p className="text-sm text-pilot-grey-600">
        Add meg a saját sávodat annál a paraméternél, amelyiknél eltérsz az
        alapértelmezettől. Ami üres marad, annál az alapértelmezett sáv érvényes
        (ha van). Elég az egyik határt megadni.
      </p>
      {error ? (
        <Alert
          variant="danger"
          title="A mentés nem sikerült"
          description={error}
        />
      ) : null}
      <div className="space-y-2">
        {parameters.map((parameter) => {
          const row = rows[parameter.code] ?? { min: "", max: "" };
          const fallback = aquariumMeasurementTargetRange(
            aquarium.waterType,
            parameter.code as AquariumMeasurementParameterCode,
          );
          const problem = problems.get(parameter.code);
          return (
            <div
              key={parameter.code}
              className="grid grid-cols-[1fr_6rem_6rem] items-start gap-2 text-sm"
            >
              <div>
                <p className="font-medium">
                  {parameter.label}{" "}
                  <span className="text-pilot-grey-500">
                    ({parameter.unit})
                  </span>
                </p>
                {fallback ? (
                  <p className="text-xs text-pilot-grey-500">
                    alap: {formatValue(fallback.min)} –{" "}
                    {formatValue(fallback.max)}
                  </p>
                ) : null}
                {problem ? (
                  <p className="text-xs font-medium text-rose-600">{problem}</p>
                ) : null}
              </div>
              <Input
                aria-label={`${parameter.label} alsó határ`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="alsó"
                value={row.min}
                onChange={(event) =>
                  setRows({
                    ...rows,
                    [parameter.code]: { ...row, min: event.target.value },
                  })
                }
              />
              <Input
                aria-label={`${parameter.label} felső határ`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="felső"
                value={row.max}
                onChange={(event) =>
                  setRows({
                    ...rows,
                    [parameter.code]: { ...row, max: event.target.value },
                  })
                }
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || problems.size > 0}>
          {busy ? "Mentés…" : "Célsávok mentése"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Mégse
        </Button>
      </div>
    </form>
  );
}
