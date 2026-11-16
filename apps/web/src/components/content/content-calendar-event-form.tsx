"use client";

import {
  Alert,
  ConfirmDialog,
  PilotButton,
  PilotCard,
  PilotDateField,
  PilotFormField,
  PilotInput,
  PilotSelect,
} from "@acropora/ui";
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_KIND_LABELS,
  CALENDAR_EVENT_LIMITS,
  type CalendarEvent,
  type CalendarEventKind,
  type CalendarEventResponsibleOption,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { contentCalendarApi } from "@/lib/api/content-calendar";

/**
 * A KÉZZEL FELVITT ESEMÉNY ŰRLAPJA (T5.5 S3): bolti esemény vagy ünnep, nyitvatartás-változás. Új eseménynél `event`
 * nincs; szerkesztésnél a szerverről frissen olvasott rekord jön, és a mentés az ő `updatedAt`-jét MINDIG elküldi:
 * ha közben valaki módosította, a szerver 409-cel elutasítja, és az űrlap ezt kimondja, nem írja felül a másikat.
 */
export function ContentCalendarEventForm({
  token,
  event,
  defaultDay,
  onSaved,
  onCancel,
}: {
  token: string;
  event: CalendarEvent | null;
  defaultDay: string;
  onSaved(): void;
  onCancel(): void;
}) {
  const [kind, setKind] = useState<CalendarEventKind>(
    event?.kind ?? "SHOP_EVENT",
  );
  const [title, setTitle] = useState(event?.title ?? "");
  const [startsOn, setStartsOn] = useState(event?.startsOn ?? defaultDay);
  const [endsOn, setEndsOn] = useState(event?.endsOn ?? defaultDay);
  const [location, setLocation] = useState(event?.location ?? "");
  const [responsibleUserId, setResponsibleUserId] = useState(
    event?.responsible?.id ?? "",
  );
  const [options, setOptions] = useState<
    CalendarEventResponsibleOption[] | null
  >(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    contentCalendarApi
      .responsibleOptions(token)
      .then((list) => alive && setOptions(list))
      .catch(
        (cause: unknown) =>
          alive &&
          setOptionsError(
            cause instanceof Error ? cause.message : "Ismeretlen hiba.",
          ),
      );
    return () => {
      alive = false;
    };
  }, [token]);

  // a már beállított felelős akkor is látszik, ha azóta nem választható (távozott kolléga): nem tűnik el csendben
  const stored = event?.responsible;
  const choices =
    stored && options && !options.some((o) => o.id === stored.id)
      ? [
          ...options,
          { id: stored.id, name: stored.name ?? "ismeretlen felhasználó" },
        ]
      : (options ?? []);

  async function save() {
    setBusy(true);
    setError(null);
    const input = {
      kind,
      title,
      startsOn,
      endsOn: endsOn || startsOn,
      location: location.trim() || null,
      responsibleUserId: responsibleUserId || null,
    };
    try {
      if (event)
        await contentCalendarApi.updateEvent(
          token,
          event.id,
          input,
          event.updatedAt,
        );
      else await contentCalendarApi.createEvent(token, input);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "Az eseményt közben valaki módosította. Zárd be az űrlapot, és nyisd meg újra: a mostani változtatásod nem került mentésre."
          : cause instanceof Error
            ? cause.message
            : "Ismeretlen hiba.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!event) return;
    setBusy(true);
    setError(null);
    try {
      await contentCalendarApi.deleteEvent(token, event.id);
      setConfirmDelete(false);
      onSaved();
    } catch (cause) {
      setConfirmDelete(false);
      setError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PilotCard className="space-y-4 p-4">
      <h2 className="text-base font-semibold text-dusk-900">
        {event ? "Esemény szerkesztése" : "Új esemény"}
      </h2>
      {error ? (
        <Alert
          variant="danger"
          title="A mentés nem sikerült"
          description={error}
        />
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PilotFormField label="Fajta" htmlFor="calendar-event-kind">
          <PilotSelect
            id="calendar-event-kind"
            value={kind}
            onChange={(value) => setKind(value as CalendarEventKind)}
          >
            {CALENDAR_EVENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {CALENDAR_EVENT_KIND_LABELS[value]}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
        <PilotFormField label="Cím" htmlFor="calendar-event-title">
          <PilotInput
            id="calendar-event-title"
            value={title}
            onChange={(value) =>
              setTitle(value.slice(0, CALENDAR_EVENT_LIMITS.title.max))
            }
          />
        </PilotFormField>
        <PilotFormField label="Első nap" htmlFor="calendar-event-starts">
          <PilotDateField
            id="calendar-event-starts"
            value={startsOn}
            onChange={(next) => {
              // egy napos eseménynél a vég követi a kezdetet: különben a kezdet áthúzása hibát adna
              if (next && (endsOn === startsOn || endsOn < next))
                setEndsOn(next);
              setStartsOn(next);
            }}
          />
        </PilotFormField>
        <PilotFormField
          label="Utolsó nap"
          htmlFor="calendar-event-ends"
          help="Egynapos eseménynél ugyanaz, mint az első nap."
        >
          <PilotDateField
            id="calendar-event-ends"
            value={endsOn}
            min={startsOn}
            onChange={setEndsOn}
          />
        </PilotFormField>
        <PilotFormField label="Hely" htmlFor="calendar-event-location">
          <PilotInput
            id="calendar-event-location"
            value={location}
            onChange={(value) =>
              setLocation(value.slice(0, CALENDAR_EVENT_LIMITS.location.max))
            }
          />
        </PilotFormField>
        <PilotFormField
          label="Felelős"
          htmlFor="calendar-event-responsible"
          error={
            optionsError
              ? `A választható kollégák nem tölthetők be: ${optionsError}`
              : undefined
          }
        >
          <PilotSelect
            id="calendar-event-responsible"
            value={responsibleUserId}
            disabled={options === null && !optionsError}
            onChange={setResponsibleUserId}
          >
            <option value="">nincs megadva</option>
            {choices.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PilotButton
          onClick={() => void save()}
          disabled={busy || !title.trim() || !startsOn}
        >
          Mentés
        </PilotButton>
        <PilotButton variant="secondary" onClick={onCancel} disabled={busy}>
          Mégse
        </PilotButton>
        {event ? (
          <PilotButton
            variant="danger"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            Törlés
          </PilotButton>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Törlöd ezt az eseményt?"
        consequence="Az esemény eltűnik a naptárból."
        recovery="A naplóban megmarad, mi volt benne, de a naptárba csak újra felvíve kerül vissza."
        confirmLabel="Esemény törlése"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </PilotCard>
  );
}
