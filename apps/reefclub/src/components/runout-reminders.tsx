"use client";

import { Alert, Button, FormField, Select } from "@acropora/ui";
import { useState } from "react";

import { ReefClubApiError, rc } from "@/lib/api";
import { formatMoment } from "@/lib/labels";
import type { ReefClubAquarium, ReefClubRunOutOverview } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const NOT_AVAILABLE: ReefClubRunOutOverview = {
  state: "off",
  text: null,
  version: null,
  reminders: [],
};

interface Loaded {
  overview: ReefClubRunOutOverview;
  aquariums: ReefClubAquarium[];
}

/**
 * THE RUN-OUT REMINDERS ON THE ACCOUNT PAGE (ReefClub V3.2, slices 3c and 6): the reminders that are on, each with its
 * turn-off, and a form to turn one on: a product of the run-out list (only those the reminder can count), one of the member's
 * aquariums (the days are counted from its litres), and the consent text with a checkbox; the turn-on sends the text's version
 * back, so a text changed since the page loaded records nothing.
 *
 * While any of the three locks is closed (the switch, the consent text, the unsubscribe secret) the section says only that the
 * reminder is not available yet: which lock is closed is the operators' business, not the member's.
 */
export function RunOutReminders() {
  const { state, reload } = useLoad<Loaded>(async () => {
    const [overview, aquariums] = await Promise.all([
      // a server without the routes yet (404) is the same as a closed lock: not available, not an error
      rc<ReefClubRunOutOverview>("GET", "/runout-reminders").catch(
        (cause: unknown) => {
          if (cause instanceof ReefClubApiError && cause.status === 404)
            return NOT_AVAILABLE;
          throw cause;
        },
      ),
      rc<{ aquariums: ReefClubAquarium[] }>("GET", "/aquariums"),
    ]);
    return { overview, aquariums: aquariums.aquariums };
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function stop(productId: string) {
    setBusy(productId);
    setError(null);
    try {
      await rc("DELETE", `/runout-reminders/${encodeURIComponent(productId)}`);
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az emlékeztető kikapcsolása nem sikerült.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Kifogyási emlékeztetők</h2>
      {state.status === "loading" ? (
        <p role="status" className="text-sm text-pilot-grey-600">
          Betöltés…
        </p>
      ) : null}
      {state.status === "failed" ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.message}
        </p>
      ) : null}
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {state.status === "ready" ? (
        <>
          <Content
            loaded={state.data}
            busy={busy}
            onStop={(productId) => void stop(productId)}
          />
          <TurnOn loaded={state.data} onDone={reload} />
        </>
      ) : null}
    </section>
  );
}

function Content({
  loaded: { overview, aquariums },
  busy,
  onStop,
}: {
  loaded: Loaded;
  busy: string | null;
  onStop(productId: string): void;
}) {
  const { reminders } = overview;
  const aquariumNames = new Map(aquariums.map((a) => [a.id, a.name]));
  return (
    <>
      <p className="text-sm text-pilot-grey-600">
        {overview.state === "available"
          ? "Egy vízkezelő szernél kérhetsz e-mailt arra, mikor fogy ki az akváriumodban. Itt látod, melyiknél kérted, és itt kapcsolhatod ki."
          : "Az emlékeztető még nem érhető el."}
      </p>
      {reminders.length > 0 ? (
        <ul className="divide-y divide-line">
          {reminders.map((reminder) => (
            <li
              key={reminder.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                <strong>{reminder.productName ?? "Ismeretlen termék"}</strong>
                <span className="text-pilot-grey-500">
                  {" "}
                  · {aquariumNames.get(reminder.aquariumId) ??
                    "akvárium"} · {formatMoment(reminder.consentAt)} óta
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => onStop(reminder.productId)}
              >
                Kikapcsolás
              </Button>
            </li>
          ))}
        </ul>
      ) : overview.state === "available" ? (
        <p className="text-sm text-pilot-grey-600">
          Most egyik termékre sem kértél emlékeztetőt.
        </p>
      ) : null}
    </>
  );
}

/** The turn-on form; nothing while a lock is closed or when no product can be counted. */
function TurnOn({
  loaded: { overview, aquariums },
  onDone,
}: {
  loaded: Loaded;
  onDone(): Promise<void>;
}) {
  const on = new Set(overview.reminders.map((r) => r.productId));
  const products = (overview.products ?? []).filter(
    (p) => !on.has(p.productId),
  );
  const [productId, setProductId] = useState("");
  const [aquariumId, setAquariumId] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (
    overview.state !== "available" ||
    !overview.text ||
    !overview.version ||
    products.length === 0 ||
    aquariums.length === 0
  )
    return null;
  const version = overview.version;

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      await rc("POST", "/runout-reminders", {
        body: { productId, aquariumId, consentVersion: version },
      });
      setProductId("");
      setAccepted(false);
      await onDone();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az emlékeztető bekapcsolása nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-semibold">Új emlékeztető</h3>
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      <FormField label="Termék" htmlFor="runout-product">
        <Select
          id="runout-product"
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
        >
          <option value="">Válassz terméket</option>
          {products.map((p) => (
            <option key={p.productId} value={p.productId}>
              {p.productName} ({p.packageText})
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Akvárium" htmlFor="runout-aquarium">
        <Select
          id="runout-aquarium"
          value={aquariumId}
          onChange={(event) => setAquariumId(event.target.value)}
        >
          <option value="">Válassz akváriumot</option>
          {aquariums.map((a) => (
            // the days are counted from the litres: an aquarium without them cannot be chosen (barracuda, #2350), and says why
            <option key={a.id} value={a.id} disabled={!a.systemVolumeLiters}>
              {a.name}
              {a.systemVolumeLiters
                ? ` (${a.systemVolumeLiters} l)`
                : " (liter nélkül nem számolható)"}
            </option>
          ))}
        </Select>
      </FormField>
      <p className="whitespace-pre-line rounded-lg border border-line bg-pilot-grey-50 p-3 text-sm text-pilot-grey-700">
        {overview.text}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>Elolvastam, és kérem az emlékeztetőt.</span>
      </label>
      <Button
        disabled={busy || !accepted || !productId || !aquariumId}
        onClick={() => void turnOn()}
      >
        Emlékeztető kérése
      </Button>
    </div>
  );
}
