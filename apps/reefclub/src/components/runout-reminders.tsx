"use client";

import { Alert, Button } from "@acropora/ui";
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
  aquariumNames: Map<string, string>;
}

/**
 * THE RUN-OUT REMINDERS ON THE ACCOUNT PAGE (ReefClub V3.2, slice 3c): the reminders that are on, each with its turn-off, or
 * one sentence when the reminder is not available. Turning one ON belongs to the product (slice 4, where it is known which
 * products can be counted); this section only shows and stops.
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
    return {
      overview,
      aquariumNames: new Map(aquariums.aquariums.map((a) => [a.id, a.name])),
    };
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
        <Content
          loaded={state.data}
          busy={busy}
          onStop={(productId) => void stop(productId)}
        />
      ) : null}
    </section>
  );
}

function Content({
  loaded: { overview, aquariumNames },
  busy,
  onStop,
}: {
  loaded: Loaded;
  busy: string | null;
  onStop(productId: string): void;
}) {
  const { reminders } = overview;
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
