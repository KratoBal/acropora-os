import type { DueInvoicesMailSettings } from "@acropora/types";

import {
  DEFAULT_DUE_INVOICES_MAIL_SETTINGS,
  minutesOf,
} from "./due-invoices-send-rule.js";

/**
 * A LEJÁRÓ SZÁMLÁK HETI LEVELÉNEK BEÁLLÍTÁSAI: ellenőrzés és tisztítás (Balázs, 2026-11-20; acrobot 58227, 58274; barracuda 58276 a 2.
 * megjegyzésében: a címzettek kisbetűsítve és alak-ellenőrizve). TISZTA FÜGGVÉNY: egy mentés előtti kapu, ami az adatbázishoz nem nyúl.
 *
 * A CÍM ALAKJA SZIGORÚ, mert a címzett a levél fejlécébe kerül: egy szóköz, vessző, `<`, `>`, idézőjel vagy sortörés NEM fogadott (a fejléc-
 * injektálás ellen a levélküldő is véd, de a beállítás nem ad neki ilyen értéket). Egyetlen `@`, a helyi rész és a tartomány nem üres, a
 * tartományban van pont. A kis- és nagybetű eltérése nem két cím: kisbetűsítve egyedít.
 */

export const MAX_RECIPIENTS = 20;

const EMAIL = /^[^\s@<>",;()[\]\\]+@[^\s@<>",;()[\]\\]+\.[^\s@<>",;()[\]\\]+$/;

export const isMailAddress = (value: string): boolean =>
  value.length <= 254 && EMAIL.test(value);

export type DueInvoicesSettingsCheck =
  | { ok: true; value: DueInvoicesMailSettings }
  | { ok: false; errors: string[] };

export function checkDueInvoicesSettings(
  input: Partial<Record<keyof DueInvoicesMailSettings, unknown>>,
): DueInvoicesSettingsCheck {
  const errors: string[] = [];
  const enabled = input.enabled;
  if (typeof enabled !== "boolean")
    errors.push("A be- és kikapcsolás igen vagy nem érték.");

  const rawRecipients = input.recipients;
  const recipients: string[] = [];
  if (!Array.isArray(rawRecipients))
    errors.push("A címzettek listája hiányzik.");
  else {
    for (const raw of rawRecipients) {
      const address = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (!isMailAddress(address))
        errors.push(
          `Érvénytelen címzett: ${typeof raw === "string" ? raw.trim() : String(raw)}.`,
        );
      else if (!recipients.includes(address)) recipients.push(address);
    }
    if (recipients.length > MAX_RECIPIENTS)
      errors.push(`Legfeljebb ${MAX_RECIPIENTS} címzett adható meg.`);
  }

  let fromAddress: string | null = null;
  if (
    input.fromAddress !== null &&
    input.fromAddress !== undefined &&
    input.fromAddress !== ""
  ) {
    const address =
      typeof input.fromAddress === "string"
        ? input.fromAddress.trim().toLowerCase()
        : "";
    if (!isMailAddress(address)) errors.push("Érvénytelen feladó cím.");
    else fromAddress = address;
  }

  const weekday = input.weekday;
  if (
    typeof weekday !== "number" ||
    !Number.isInteger(weekday) ||
    weekday < 1 ||
    weekday > 7
  )
    errors.push("A nap 1 (hétfő) és 7 (vasárnap) közötti szám.");

  const earliest =
    typeof input.earliest === "string" ? input.earliest.trim() : "";
  const latest = typeof input.latest === "string" ? input.latest.trim() : "";
  const earliestMinutes = minutesOf(earliest);
  const latestMinutes = minutesOf(latest);
  if (earliestMinutes === null)
    errors.push("A legkorábbi időpont ÓÓ:PP alakú.");
  if (latestMinutes === null) errors.push("A legkésőbbi időpont ÓÓ:PP alakú.");
  if (
    earliestMinutes !== null &&
    latestMinutes !== null &&
    latestMinutes < earliestMinutes
  )
    errors.push("A legkésőbbi időpont nem lehet a legkorábbinál korábbi.");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      enabled: enabled as boolean,
      recipients,
      fromAddress,
      weekday: weekday as number,
      earliest,
      latest,
    },
  };
}

/** A sor nélküli állapot: az alapértékek, nincs címzett, tehát nem megy levél. */
export const DEFAULT_DUE_INVOICES_SETTINGS: DueInvoicesMailSettings = {
  ...DEFAULT_DUE_INVOICES_MAIL_SETTINGS,
  recipients: [],
  fromAddress: null,
};
