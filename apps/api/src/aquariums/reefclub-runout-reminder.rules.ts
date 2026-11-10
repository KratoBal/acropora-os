import { runOutDates } from "@acropora/jev/product-enrichment";

import type { OutgoingMail } from "../notifications/mail/mail.port.js";

/**
 * THE RUN-OUT REMINDER'S SENDER, THE PURE PART (ReefClub V3.2, card cd94ed11, slice 5). The service is
 * `reefclub-runout-reminder.service.ts`; it runs in the OS process, which can read the member's shop orders (the ReefClub role
 * cannot), and sends on the ReefClub's own sender only.
 *
 * THE START DAY (acrobot 45493): the day the member's shop order with the product left the shop, when a linked customer has
 * one, else the day of the consent; the source is stored with every sent reminder, so the share can be measured. The database
 * has NO day the customer received a parcel (no carrier writes one), so "left the shop" is the order's first SHIPPING,
 * READY_FOR_PICKUP or CLOSED status event, or a till sale's completion. That is the delivery day or a day or two before it: an
 * earlier start moves the reminder earlier, never later, which is the side the core already takes (`runOutDates`).
 *
 * An order whose pack ran out before the consent is not the pack the member counts on (they consented later, with another one):
 * then the consent day starts it. A newer order starts a new cycle by itself, because the latest order is taken every day.
 */
export type StartSource = "ORDER" | "CONSENT";

export interface StartDay {
  day: string;
  source: StartSource;
}

/** A moment as the Budapest calendar day ("YYYY-MM-DD"). */
export function budapestDay(moment: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moment);
}

export function startDay(input: {
  /** The Budapest days the member's orders with the product left the shop. */
  orderDays: readonly string[];
  consentDay: string;
  days: { min: number; max: number };
}): StartDay {
  const latest = [...input.orderDays].sort().at(-1);
  if (latest) {
    const dates = runOutDates(latest, input.days);
    if (dates && dates.runsOutOn >= input.consentDay)
      return { day: latest, source: "ORDER" };
  }
  return { day: input.consentDay, source: "CONSENT" };
}

export type ReminderStep =
  | { kind: "DUE"; runsOutOn: string; remindOn: string }
  | { kind: "WAIT"; remindOn: string }
  | { kind: "SENT"; runsOutOn: string }
  | { kind: "LATE"; runsOutOn: string }
  | { kind: "INVALID" };

/**
 * Whether today is the day to send. DUE from the reminder day up to the day BEFORE the run-out (a mail on or after the day it ran
 * out is no reminder: LATE, said in the log, not sent); one mail per run-out day (SENT).
 */
export function reminderStep(input: {
  today: string;
  start: StartDay;
  days: { min: number; max: number };
  remindedForRunOut: string | null;
}): ReminderStep {
  const dates = runOutDates(input.start.day, input.days);
  if (!dates) return { kind: "INVALID" };
  if (input.remindedForRunOut === dates.runsOutOn)
    return { kind: "SENT", runsOutOn: dates.runsOutOn };
  if (input.today < dates.remindOn)
    return { kind: "WAIT", remindOn: dates.remindOn };
  if (input.today >= dates.runsOutOn)
    return { kind: "LATE", runsOutOn: dates.runsOutOn };
  return { kind: "DUE", ...dates };
}

/** "2026-12-03" as "2026. december 3." */
export function hungarianDay(day: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

export function runOutMail(input: {
  to: string;
  productName: string;
  packageText: string;
  aquariumName: string;
  litres: number;
  start: StartDay;
  runsOutOn: string;
  webUrl: string;
  unsubscribeKey: string;
}): OutgoingMail {
  const since =
    input.start.source === "ORDER"
      ? `a bolti rendelésed ${hungarianDay(input.start.day)} napjától`
      : `${hungarianDay(input.start.day)} napjától, amikor az emlékeztetőt kérted`;
  return {
    to: [input.to],
    subject: `ReefClub: hamarosan elfogy: ${input.productName}`,
    text: [
      "Szia!",
      "",
      `A(z) ${input.aquariumName} akváriumodban a(z) ${input.productName} (${input.packageText}) a gyártó adagolásával számolva ${hungarianDay(input.runsOutOn)} körül fogy el.`,
      `A számítás ${since} indul, ${input.litres} literrel. Ha kevesebbet adagolsz, tovább tart.`,
      "",
      "Ezt a levelet azért kapod, mert a ReefClubban emlékeztetőt kértél erre a termékre. Erről a termékről itt iratkozhatsz le:",
      `${input.webUrl}/emlekezteto-leiratkozas#token=${input.unsubscribeKey}`,
      "",
      "Acropora ReefClub",
    ].join("\n"),
  };
}
