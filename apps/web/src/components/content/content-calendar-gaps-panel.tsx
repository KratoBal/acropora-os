"use client";

import { Alert, Badge, Card, Skeleton } from "@acropora/ui";
import {
  CONTENT_CALENDAR_GAP_DAYS,
  type ContentCalendarGapSlot,
  type ContentCalendarGaps,
  type ContentCalendarSlotStatus,
} from "@acropora/types";
import Link from "next/link";
import { useEffect, useState } from "react";

import { contentCalendarApi } from "@/lib/api/content-calendar";
import { shortDayLabel } from "./content-calendar-days";
import { CHANNEL_LABELS } from "./content-history";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const STATUS: Record<
  ContentCalendarSlotStatus,
  { label: string; tone: BadgeTone }
> = {
  NOT_OPENED: { label: "nincs megnyitva", tone: "danger" },
  IDEA: { label: "üres hely", tone: "warning" },
  DRAFT: { label: "vázlat", tone: "info" },
  APPROVED: { label: "jóváhagyva", tone: "success" },
  SENT: { label: "kiment", tone: "success" },
  DISCARDED: { label: "elvetve", tone: "neutral" },
};

/** „ma", „3 nap múlva", „2 napja késik": a hátralévő idő (spec 3.). */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return "ma";
  return daysLeft > 0 ? `${daysLeft} nap múlva` : `${-daysLeft} napja késik`;
}

function SlotLine({
  slot,
  omnibus,
}: {
  slot: ContentCalendarGapSlot;
  omnibus: number;
}) {
  const status = STATUS[slot.status];
  const blocked = slot.status === "APPROVED" && omnibus > 0;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Badge variant={blocked ? "danger" : status.tone}>
        {blocked ? "jóváhagyva, de Omnibus nélkül" : status.label}
      </Badge>
      {slot.contentId ? (
        <Link
          href={`/tartalom/${encodeURIComponent(slot.contentId)}`}
          className="font-medium text-dusk-900 hover:underline"
        >
          {slot.label}
        </Link>
      ) : (
        <span className="font-medium text-dusk-900">{slot.label}</span>
      )}
      <span className="text-dusk-600">
        {CHANNEL_LABELS[slot.channel]} · {shortDayLabel(slot.plannedOn)} ·{" "}
        <span
          className={slot.daysLeft < 0 && !slot.done ? "text-rose-700" : ""}
        >
          {daysLeftLabel(slot.daysLeft)}
        </span>
      </span>
    </li>
  );
}

/**
 * A HIÁNY- ÉS ÜTKÖZÉS-JELZÉS (T5.5 S6, spec 3.): a következő 14 nap eseményei, amelyekhez nincs kész tartalom, a napok,
 * ahol egy csatornán kettőnél több tétel áll, és a túl sűrű hírlevelek. A hiba nem „nincs hiány": ha a lista nem
 * olvasható, azt mondja ki. A `refresh` változása újraolvas (egy esemény vagy a helyek nyitása után).
 */
export function ContentCalendarGapsPanel({
  token,
  refresh,
}: {
  token: string;
  refresh: number;
}) {
  const [gaps, setGaps] = useState<ContentCalendarGaps | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    contentCalendarApi
      .gaps(token, controller.signal)
      .then(setGaps)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setGaps(null);
        setError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
      });
    return () => controller.abort();
  }, [token, refresh]);

  const title = `A következő ${CONTENT_CALENDAR_GAP_DAYS} nap`;
  if (error)
    return (
      <Alert
        variant="danger"
        title="A hiány-lista nem elérhető"
        description={`${error} Ez hiba, nem azt jelenti, hogy nem hiányzik semmi.`}
      />
    );
  if (!gaps)
    return <Skeleton className="h-24 w-full" data-testid="gaps-loading" />;

  const missing = gaps.events.filter((event) => event.missing);
  const letters = gaps.newsletter;
  return (
    <Card className="space-y-3 p-4" data-testid="calendar-gaps">
      <h2 className="text-base font-semibold text-dusk-900">{title}</h2>
      {missing.length === 0 ? (
        <p className="text-sm text-dusk-600">
          {gaps.events.length === 0
            ? "Nincs olyan esemény, amihez a sablon tartalmat kér."
            : "Minden esemény tartalma kész."}
        </p>
      ) : (
        <ul className="space-y-3">
          {missing.map((event) => (
            <li key={event.eventKey} className="space-y-1">
              <p className="text-sm font-semibold text-dusk-900">
                Hiányzik: {event.title}
              </p>
              {event.omnibusUnknown > 0 ? (
                <p className="text-xs text-rose-700">
                  {event.omnibusUnknown} termék Omnibus-értéke ismeretlen: az
                  akciós ár ezek nélkül nem mehet ki.
                </p>
              ) : null}
              <ul className="space-y-1 pl-2">
                {event.slots.map((slot) => (
                  <SlotLine
                    key={slot.ruleId}
                    slot={slot}
                    omnibus={event.omnibusUnknown}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {gaps.collisions.map((collision) => (
        <p
          key={`${collision.day}|${collision.channel}`}
          className="text-sm text-amber-800"
        >
          Ütközés {shortDayLabel(collision.day)}: {collision.items.length} tétel
          a(z) {CHANNEL_LABELS[collision.channel]} csatornán (
          {collision.items.map((item) => item.title).join(", ")}).
        </p>
      ))}
      {letters.minDaysBetween === null ? (
        <p className="text-xs text-dusk-500">
          A hírlevél-gyakoriság nincs beállítva (Sablon oldal): a túl sűrű
          hírlevélre ez a lista nem figyelmeztet.
        </p>
      ) : (
        letters.tooClose.map((pair) => (
          <p
            key={`${pair.first.contentId}|${pair.second.contentId}`}
            className="text-sm text-amber-800"
          >
            Túl sűrű hírlevél: „{pair.first.title}” (
            {shortDayLabel(pair.first.day)}) és „{pair.second.title}” (
            {shortDayLabel(pair.second.day)}) között {pair.days} nap, a
            beállítás legalább {letters.minDaysBetween}.
          </p>
        ))
      )}
    </Card>
  );
}
