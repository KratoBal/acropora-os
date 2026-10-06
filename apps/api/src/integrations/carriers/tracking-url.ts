import type { CarrierCode } from "./carrier.types.js";

/**
 * THE PUBLIC TRACKING ADDRESS, PER CARRIER, FROM CONFIGURATION ONLY.
 *
 * Neither carrier's public tracking address has been measured from here
 * (foxpost.hu and gls-group.com are not on the quarantine reader's
 * allowlist), and acrobot decided (26620): a configurable field, and no link
 * until it is measured; never an invented address. Unset or malformed means
 * no link, on the order page and in the customer's shipped mail alike.
 *
 * The template is an https address with `{parcelNumber}` where the number
 * goes, e.g. `https://example.carrier/track?code={parcelNumber}`.
 */
export const TRACKING_URL_ENV: Readonly<Record<CarrierCode, string>> = {
  foxpost: "FOXPOST_TRACKING_URL",
  gls: "GLS_TRACKING_URL",
};

const PLACEHOLDER = "{parcelNumber}";

export function trackingUrlFor(
  carrier: CarrierCode,
  parcelNumber: string | null,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const template = env[TRACKING_URL_ENV[carrier]]?.trim();
  if (!template || !parcelNumber || !template.includes(PLACEHOLDER))
    return null;
  const url = template
    .split(PLACEHOLDER)
    .join(encodeURIComponent(parcelNumber));
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
