import type { StripeSyncState } from "@acropora/types";

/**
 * THE STRIPE SETTLEMENT PULL'S SETTINGS, read in ONE place (the SimplePay pull's shape and reasons: the switch read patiently, an
 * unrecognised value reported as such, one sentence for the log and the page). OFF BY DEFAULT: an OS deployed before the shop
 * knows the feed asks for nothing.
 *
 *   STRIPE_SETTLEMENT_SYNC_ENABLED            true / false (anything else: off, and said so)
 *   STRIPE_SETTLEMENT_SYNC_INTERVAL_MINUTES   default 360 (5..1440)
 *
 * No key here: the OS holds no Stripe credential. The data comes through the webshop connection (Beállítások, Medusa kapcsolat).
 */
export type StripeSyncSwitch =
  { on: true } | { on: false; reason: "NOT_SET" | "OFF" | "UNRECOGNISED" };

export function stripeSyncSwitch(raw: string | undefined): StripeSyncSwitch {
  if (raw === undefined || raw.trim() === "")
    return { on: false, reason: "NOT_SET" };
  const value = raw.trim().toLowerCase();
  if (value === "true") return { on: true };
  if (value === "false") return { on: false, reason: "OFF" };
  return { on: false, reason: "UNRECOGNISED" };
}

export function stripeSyncState(
  environment: NodeJS.ProcessEnv = process.env,
): StripeSyncState {
  const state = stripeSyncSwitch(environment.STRIPE_SETTLEMENT_SYNC_ENABLED);
  if (state.on) return "ENABLED";
  return (
    {
      NOT_SET: "DISABLED_NOT_SET",
      OFF: "DISABLED_OFF",
      UNRECOGNISED: "DISABLED_UNRECOGNISED",
    } as const
  )[state.reason];
}

export function stripeSyncIntervalMinutes(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment.STRIPE_SETTLEMENT_SYNC_INTERVAL_MINUTES?.trim();
  if (!raw) return 360;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 5 && value <= 1440 ? value : 360;
}

export function describeStripeSyncState(
  state: StripeSyncState,
  intervalMinutes: number,
): string {
  switch (state) {
    case "ENABLED":
      return `Stripe settlement pull: on, every ${intervalMinutes} minutes`;
    case "DISABLED_NOT_SET":
      return "Stripe settlement pull: off (STRIPE_SETTLEMENT_SYNC_ENABLED is not set)";
    case "DISABLED_OFF":
      return "Stripe settlement pull: off (STRIPE_SETTLEMENT_SYNC_ENABLED=false)";
    case "DISABLED_UNRECOGNISED":
      return "Stripe settlement pull: off (STRIPE_SETTLEMENT_SYNC_ENABLED is neither true nor false)";
  }
}
