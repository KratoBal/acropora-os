import type {
  CalendarEvent,
  CalendarEventKind,
  CalendarEventResponsibleOption,
  ContentCalendarFeed,
  ContentCalendarGaps,
  ContentCalendarSettings,
  ContentCalendarSlotsResult,
  ContentChannel,
  ContentTemplateAnchor,
  ContentTemplateEventKind,
  ContentTemplateRule,
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

/** A sablon egy sorának űrlapja (T5.5 S4); az esemény-fajta új sornál megy, szerkesztéskor nem változik. */
export interface ContentTemplateRuleInput {
  label: string;
  channel: ContentChannel;
  anchor: ContentTemplateAnchor;
  offsetDays: number;
  active: boolean;
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
  template(token: string, signal?: AbortSignal) {
    return apiRequest<ContentTemplateRule[]>(
      `/content/calendar/template`,
      token,
      {
        signal,
      },
    );
  },
  createTemplateRule(
    token: string,
    eventKind: ContentTemplateEventKind,
    input: ContentTemplateRuleInput,
  ) {
    return apiRequest<ContentTemplateRule>(
      `/content/calendar/template`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ eventKind, ...input }),
      },
    );
  },
  updateTemplateRule(
    token: string,
    id: string,
    input: ContentTemplateRuleInput,
    expectedUpdatedAt: string,
  ) {
    return apiRequest<ContentTemplateRule>(
      `/content/calendar/template/${encodeURIComponent(id)}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ ...input, expectedUpdatedAt }),
      },
    );
  },
  /** A látott időszak eseményeihez a sablon szerinti tartalom-helyek; ismételhető, a meglévőt nem nyitja újra. */
  openSlots(token: string, from: string, to: string) {
    return apiRequest<ContentCalendarSlotsResult>(
      `/content/calendar/slots/open`,
      token,
      { method: "POST", body: JSON.stringify({ from, to }) },
    );
  },
  /** A következő 14 nap hiányai, ütközései és a hírlevél-gyakoriság (S6). */
  gaps(token: string, signal?: AbortSignal) {
    return apiRequest<ContentCalendarGaps>(`/content/calendar/gaps`, token, {
      signal,
    });
  },
  settings(token: string, signal?: AbortSignal) {
    return apiRequest<ContentCalendarSettings>(
      `/content/calendar/settings`,
      token,
      { signal },
    );
  },
  /** `null` törli a beállítást: a hírlevél-szabály akkor nem jelez. */
  saveSettings(token: string, newsletterMinDays: number | null) {
    return apiRequest<ContentCalendarSettings>(
      `/content/calendar/settings`,
      token,
      { method: "PUT", body: JSON.stringify({ newsletterMinDays }) },
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
