"use client";

import { Alert, Button, Input, Select } from "@acropora/ui";
import {
  CONTENT_RESULT_FIELDS,
  CONTENT_RESULT_FIELD_LABELS,
  CONTENT_RESULT_LIMITS,
  contentTrackingUrl,
  hasPermission,
  PERMISSIONS,
  type ContentChannel,
  type ContentResultValues,
  type ContentResults,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentResultsApi } from "@/lib/api/content-results";

const DAY_MS = 86_400_000;

const budapestDay = (at: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(at);

/** A hét hétfője (`ÉÉÉÉ-HH-NN`). */
export function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - weekday * DAY_MS).toISOString().slice(0, 10);
}

/** A felvihető hetek a kiküldés hetétől a mostani hétig, a legutóbbi elöl. */
export function resultWeeks(sentAt: string, now: Date = new Date()): string[] {
  const first = mondayOf(budapestDay(new Date(sentAt)));
  const last = mondayOf(budapestDay(now));
  const weeks: string[] = [];
  for (
    let day = last;
    day >= first;
    day = new Date(new Date(`${day}T00:00:00Z`).getTime() - 7 * DAY_MS)
      .toISOString()
      .slice(0, 10)
  )
    weeks.push(day);
  return weeks;
}

const EMPTY_FORM = Object.fromEntries(
  CONTENT_RESULT_FIELDS.map((field) => [field, ""]),
) as Record<keyof ContentResultValues, string>;

const shown = (value: number | null) =>
  value === null ? "–" : value.toLocaleString("hu-HU");

/**
 * A TÉTEL EREDMÉNYE (T5.5 S8, spec 4.): a mérőparaméteres hivatkozás (minden tételen: a kimenő link a tétel azonosítóját
 * viszi), és kiment tételnél a heti számok, a felvitelükkel. A számokat ember viszi fel, amíg a csatorna statisztikája
 * nincs bekötve; a ki nem töltött mező „–", nem 0.
 */
export function ContentResultsPanel({
  contentId,
  channel,
  sentAt,
}: {
  contentId: string;
  channel: ContentChannel;
  sentAt: string | null;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session?.user && hasPermission(session.user, PERMISSIONS.CONTENT_MANAGE),
  );
  const [link, setLink] = useState("");
  const [results, setResults] = useState<ContentResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!sentAt) return;
    const controller = new AbortController();
    contentResultsApi
      .results(token, contentId, controller.signal)
      .then(setResults)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
      });
    return () => controller.abort();
  }, [token, contentId, sentAt]);

  const tracked = link.trim()
    ? contentTrackingUrl(link, { id: contentId, channel })
    : null;
  const weeks = sentAt ? resultWeeks(sentAt) : [];
  const chosenWeek = week || weeks[0] || "";

  function pickWeek(next: string) {
    setWeek(next);
    const stored = results?.weeks.find((w) => w.weekStart === next);
    setForm(
      stored
        ? (Object.fromEntries(
            CONTENT_RESULT_FIELDS.map((field) => [
              field,
              stored[field] === null ? "" : String(stored[field]),
            ]),
          ) as Record<keyof ContentResultValues, string>)
        : EMPTY_FORM,
    );
  }

  const num = (text: string) => (text.trim() === "" ? null : Number(text));
  const values: ContentResultValues = {
    reach: num(form.reach),
    reactions: num(form.reactions),
    opens: num(form.opens),
    clicks: num(form.clicks),
    preorders: num(form.preorders),
    orders: num(form.orders),
  };
  const valid =
    CONTENT_RESULT_FIELDS.some((field) => values[field] !== null) &&
    CONTENT_RESULT_FIELDS.every((field) => {
      const value = values[field];
      return (
        value === null ||
        (Number.isInteger(value) &&
          value >= CONTENT_RESULT_LIMITS.value.min &&
          value <= CONTENT_RESULT_LIMITS.value.max)
      );
    });

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      setResults(
        await contentResultsApi.saveWeek(token, contentId, chosenWeek, values),
      );
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase text-dusk-500">
        Mérés és eredmény
      </h4>
      <div className="space-y-1">
        <label
          htmlFor={`tracking-${contentId}`}
          className="text-sm text-dusk-700"
        >
          Mérőparaméteres hivatkozás: illeszd be a kimenő linket
        </label>
        <Input
          id={`tracking-${contentId}`}
          value={link}
          placeholder="https://acropora.hu/..."
          onChange={(e) => setLink(e.target.value)}
        />
        {link.trim() ? (
          tracked ? (
            <p
              className="break-all rounded bg-white p-2 text-xs text-dusk-700"
              data-testid="tracking-url"
            >
              {tracked}
            </p>
          ) : (
            <p className="text-xs text-rose-700">
              Ez nem webcím (https://...): erre nem kerül mérőparaméter.
            </p>
          )
        ) : null}
      </div>

      {!sentAt ? (
        <p className="text-sm text-dusk-500">
          Eredményt a kiküldés után lehet felvinni.
        </p>
      ) : error ? (
        <Alert
          variant="danger"
          title="Az eredmény nem tölthető be"
          description={error}
        />
      ) : results ? (
        <>
          <p className="text-sm text-dusk-700" data-testid="results-totals">
            Összesen:{" "}
            {CONTENT_RESULT_FIELDS.map(
              (field) =>
                `${CONTENT_RESULT_FIELD_LABELS[field]} ${shown(results.totals[field])}`,
            ).join(" · ")}
          </p>
          {results.weeks.length === 0 ? (
            <p className="text-sm text-dusk-500">Még nincs felvitt hét.</p>
          ) : (
            <ul className="space-y-1 text-xs text-dusk-600">
              {results.weeks.map((w) => (
                <li key={w.weekStart}>
                  {w.weekStart} hete:{" "}
                  {CONTENT_RESULT_FIELDS.map(
                    (field) =>
                      `${CONTENT_RESULT_FIELD_LABELS[field]} ${shown(w[field])}`,
                  ).join(" · ")}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <div className="space-y-2 rounded border border-dusk-200 bg-white p-2">
              {saveError ? (
                <Alert
                  variant="danger"
                  title="A mentés nem sikerült"
                  description={saveError}
                />
              ) : null}
              <label
                htmlFor={`week-${contentId}`}
                className="text-sm text-dusk-700"
              >
                Hét (hétfő)
              </label>
              <Select
                id={`week-${contentId}`}
                value={chosenWeek}
                onChange={(e) => pickWeek(e.target.value)}
              >
                {weeks.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {CONTENT_RESULT_FIELDS.map((field) => (
                  <div key={field} className="space-y-1 text-xs text-dusk-700">
                    <label htmlFor={`result-${contentId}-${field}`}>
                      {CONTENT_RESULT_FIELD_LABELS[field]}
                    </label>
                    <Input
                      id={`result-${contentId}-${field}`}
                      type="number"
                      min={0}
                      value={form[field]}
                      onChange={(e) =>
                        setForm({ ...form, [field]: e.target.value })
                      }
                    />
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                disabled={busy || !valid}
                onClick={() => void save()}
              >
                Hét mentése
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
