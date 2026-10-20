"use client";

import { aquariumMeasurementParametersFor } from "@acropora/types";
import { Alert, Button, FormField, Input } from "@acropora/ui";
import { useState, type FormEvent } from "react";

import { rc } from "@/lib/api";
import { parseDecimal } from "@/lib/labels";
import type { ReefClubAquarium, ReefClubOccasion } from "@/lib/types";

/** `datetime-local` wants the local wall clock, minutes only. */
export function localInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * A manual measurement: a moment and a value for each parameter the user
 * filled in. The moment defaults to now and may not be in the future (the
 * server refuses it too). `clientOperationId` is kept until the save succeeds,
 * so a retry after a lost answer returns the occasion that was created instead
 * of a second one.
 */
export function MeasurementForm({
  aquarium,
  now = () => new Date(),
  onSaved,
}: {
  aquarium: ReefClubAquarium;
  now?: () => Date;
  onSaved(): Promise<void>;
}) {
  const parameters = aquariumMeasurementParametersFor(aquarium.waterType);
  const [moment, setMoment] = useState(() => localInputValue(now()));
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const entries = parameters.flatMap((parameter) => {
    const text = (texts[parameter.code] ?? "").trim();
    return text === "" ? [] : [{ parameter, text, value: parseDecimal(text) }];
  });
  const invalid = entries.filter((entry) => entry.value === null);
  const at = new Date(moment);
  const momentProblem = Number.isNaN(at.getTime())
    ? "Add meg a mérés időpontját."
    : at.getTime() > now().getTime()
      ? "A mérés időpontja nem lehet a jövőben."
      : undefined;
  const ready = entries.length > 0 && invalid.length === 0 && !momentProblem;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await rc<ReefClubOccasion>(
        "POST",
        `/aquariums/${encodeURIComponent(aquarium.id)}/measurements`,
        {
          body: {
            clientOperationId: operationId,
            measuredAt: at.toISOString(),
            values: entries.map((entry) => ({
              parameterCode: entry.parameter.code,
              value: entry.value,
            })),
          },
        },
      );
      setTexts({});
      setOperationId(crypto.randomUUID());
      setSaved(true);
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A mérés mentése nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert
          variant="danger"
          title="A mérés nem mentődött"
          description={error}
        />
      ) : null}
      {saved ? <Alert title="A mérés mentve" /> : null}
      <FormField
        label="Mérés időpontja"
        htmlFor="measurement-moment"
        error={momentProblem}
      >
        <Input
          id="measurement-moment"
          type="datetime-local"
          value={moment}
          onChange={(event) => setMoment(event.target.value)}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        {parameters.map((parameter) => {
          const entry = entries.find(
            (e) => e.parameter.code === parameter.code,
          );
          return (
            <FormField
              key={parameter.code}
              label={`${parameter.label} (${parameter.unit})`}
              htmlFor={`measurement-${parameter.code}`}
              error={
                entry && entry.value === null
                  ? "Számot írj, például 8,2."
                  : undefined
              }
            >
              <Input
                id={`measurement-${parameter.code}`}
                inputMode="decimal"
                autoComplete="off"
                value={texts[parameter.code] ?? ""}
                onChange={(event) =>
                  setTexts({ ...texts, [parameter.code]: event.target.value })
                }
              />
            </FormField>
          );
        })}
      </div>
      <p className="text-xs text-pilot-grey-500">
        Elég azt kitölteni, amit mértél; a többit hagyd üresen.
      </p>
      <Button type="submit" disabled={busy || !ready}>
        {busy ? "Mentés…" : "Mérés mentése"}
      </Button>
    </form>
  );
}
