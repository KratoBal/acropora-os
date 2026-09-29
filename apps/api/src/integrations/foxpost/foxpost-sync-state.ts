import type { FoxpostSyncState } from "@acropora/types";

import { foxpostGmailKeyPresent } from "./foxpost-gmail.client.js";

export type FoxpostSyncSwitch =
  { on: true } | { on: false; reason: "NOT_SET" | "OFF" | "UNRECOGNISED" };

/**
 * THE ONE READER of GMAIL_FOXPOST_SYNC_ENABLED: the schedule, its start-up
 * log line and the page's status all go through it, so the page cannot say
 * "on" while the scheduler stays off.
 */
export function foxpostSyncSwitch(raw: string | undefined): FoxpostSyncSwitch {
  // "True", " true" and a trailing newline all mean on. Measured on
  // production 2026-09-29: the variable was set, the scheduler never ran
  // once in seven weeks (5 sync runs, all manual), and nothing said so.
  const value = raw?.trim().toLowerCase();
  if (!value) return { on: false, reason: "NOT_SET" };
  if (value === "true") return { on: true };
  if (value === "false") return { on: false, reason: "OFF" };
  return { on: false, reason: "UNRECOGNISED" };
}

/** The interval the status reports; never throws (the schedule itself does). */
export function foxpostSyncIntervalMinutes(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment.GMAIL_FOXPOST_SYNC_INTERVAL_MINUTES?.trim();
  const value = raw ? Number(raw) : 60;
  return Number.isSafeInteger(value) && value >= 5 && value <= 1440
    ? value
    : 60;
}

export function foxpostSyncState(
  environment: NodeJS.ProcessEnv = process.env,
): FoxpostSyncState {
  const switchState = foxpostSyncSwitch(environment.GMAIL_FOXPOST_SYNC_ENABLED);
  if (!switchState.on)
    return (
      {
        NOT_SET: "DISABLED_NOT_SET",
        OFF: "DISABLED_OFF",
        UNRECOGNISED: "DISABLED_UNRECOGNISED",
      } as const
    )[switchState.reason];
  return foxpostGmailKeyPresent(environment) ? "ENABLED" : "NO_KEY";
}
