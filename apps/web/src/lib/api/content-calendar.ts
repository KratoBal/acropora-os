import type {
  CalendarEvent,
  CalendarEventKind,
  CalendarEventResponsibleOption,
  ContentCalendarFeed,
} from "@acropora/types";

import { apiRequest } from "./client";

/** Az űrlap tartalma: a hely és a felelős `null`-lal törlődik. */
export interface CalendarEventInput {
  kind: CalendarEventKind;
  title: string;
  startsOn: string;
  endsOn: string;
  location: string | null;
  responsibleUserId: string | null;
}

/**
 * A tartalomnaptár (T5.5): az adatfolyam egy időszakra, és a kézzel felvitt események. Szerkesztéskor az
 * `expectedUpdatedAt` MINDIG megy: egy közben módosított eseményt a szerver 409-cel utasít el, nem írja felül.
 */
export const contentCalendarApi = {
  feed(token: string, from: string, to: string, signal?: AbortSignal) {
    return apiRequest<ContentCalendarFeed>(
      `/content/calendar/feed?from=${from}&to=${to}`,
      token,
      { signal },
    );
  },
  event(token: string, id: string) {
    return apiRequest<CalendarEvent>(
      `/content/calendar/events/${encodeURIComponent(id)}`,
      token,
    );
  },
  responsibleOptions(token: string) {
    return apiRequest<CalendarEventResponsibleOption[]>(
      `/content/calendar/events/options/responsible`,
      token,
    );
  },
  createEvent(token: string, input: CalendarEventInput) {
    return apiRequest<CalendarEvent>(`/content/calendar/events`, token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateEvent(
    token: string,
    id: string,
    input: CalendarEventInput,
    expectedUpdatedAt: string,
  ) {
    return apiRequest<CalendarEvent>(
      `/content/calendar/events/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ ...input, expectedUpdatedAt }),
      },
    );
  },
  deleteEvent(token: string, id: string) {
    return apiRequest<void>(
      `/content/calendar/events/${encodeURIComponent(id)}`,
      token,
      { method: "DELETE" },
    );
  },
};
