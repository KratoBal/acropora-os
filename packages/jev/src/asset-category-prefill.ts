/**
 * A V1 ELOTOLTES-PILOT DONTESI SZABALYAI -- tiszta fuggvenyek, halozat es
 * adatbazis nelkul.
 *
 * Szerzodes: KratoBal/acropora-os #1199, ACD-008 P-012 es acrobot P-013
 * kommentje. Balazs: PD-005 ACCEPT P-012, 2026-09-28 11:04 UTC.
 *
 *   LATHATO csak ha:   a valasztott kategoria a 11 validalt kozul VAN, ES
 *                      a bizonyossag >= 0,90, ES nem a 10%-os kontrollba esik
 *   minden mas:        HIDDEN (a 17 ritka is, a NONE is, a hiba is)
 *   soha:              automatikus iras -- a kategoriat az ember menti
 */
import { createHash } from "node:crypto";

import { NONE_KEY } from "./evaluation.js";

/**
 * A 11 VALIDALT KATEGORIA KODJA (PD-004, a holdout futas `alloc` kulcsai,
 * `exchange/jev-holdout-frozen-2026-09-28.json`).
 *
 * KOD, NEM AZONOSITO ES NEM NEV: a kod kornyezetfuggetlen (a staging es az
 * eles azonositoja elterhet), es egy atnevezes sem rontja el. acrobot
 * 2026-09-28 13:06-kor egyetertett. A lista POLICY-KONFIGURACIO, nem adat:
 * bovitese uj policy-dontes (PD-005: „nincs visible prefill a 17 ritka
 * kategoriara").
 */
export const PREFILL_VISIBLE_CATEGORY_CODES: ReadonlySet<string> = new Set([
  "LIG",
  "COM",
  "VAL",
  "PUM",
  "HSZ",
  "VPU",
  "UVF",
  "MET",
  "FIB",
  "HEX",
  "CAN",
]);

/** A lathato elotoltes also hatara (PD-005: nincs kuszob-csokkentes 0,90 ala). */
export const PREFILL_CONFIDENCE_THRESHOLD = 0.9;

/**
 * A 10%-OS REJTETT KONTROLL: `sha256(clientOperationId + ":" + policyVersion)`
 * elso 8 hex jegye 32 bites egeszkent, modulo 10, es a 0 a kontroll.
 *
 * STABIL: ugyanazon az urlapon (ugyanaz a `clientOperationId`) minden futas
 * ugyanabba a csoportba esik, tehat egy felhasznalo nem latja egyszer a
 * javaslatot, masszor nem (P-012 3. pont). A kulcs a `clientOperationId`,
 * mert az `entityId` a kiosztas pillanataban meg nem letezik (P-013).
 */
export function isHiddenControl(
  clientOperationId: string,
  policyVersion: number,
): boolean {
  const hex = createHash("sha256")
    .update(`${clientOperationId}:${policyVersion}`, "utf8")
    .digest("hex");
  return Number.parseInt(hex.slice(0, 8), 16) % 10 === 0;
}

export type PrefillExposure = "HIDDEN" | "SHOWN";

/**
 * A JAVASLAT LATHATOSAGA. `categoryCode` a valasztott kategoria kodja (`null`,
 * ha a valasztas NONE, vagy a kategorianak nincs kodja).
 */
export function prefillExposure(input: {
  readonly selectedValue: string | null;
  readonly categoryCode: string | null;
  readonly confidence: number | null;
  readonly clientOperationId: string;
  readonly policyVersion: number;
}): PrefillExposure {
  const eligible =
    input.selectedValue !== null &&
    input.selectedValue !== NONE_KEY &&
    input.categoryCode !== null &&
    PREFILL_VISIBLE_CATEGORY_CODES.has(input.categoryCode) &&
    input.confidence !== null &&
    input.confidence >= PREFILL_CONFIDENCE_THRESHOLD;
  if (!eligible) return "HIDDEN";
  return isHiddenControl(input.clientOperationId, input.policyVersion)
    ? "HIDDEN"
    : "SHOWN";
}

export type PrefillResolution =
  "ACCEPTED" | "OVERRIDDEN" | "SHADOW_MATCH" | "SHADOW_MISMATCH" | "STALE";

/**
 * A FELOLDAS A MENTESKOR (P-012 6. pont, P-013).
 *
 *   a vetulet a javaslat utan valtozott   STALE (a Jev mast latott)
 *   SHOWN + a javasolt maradt             ACCEPTED
 *   SHOWN + mas lett                      OVERRIDDEN
 *   HIDDEN + egyezik                      SHADOW_MATCH
 *   HIDDEN + mas                          SHADOW_MISMATCH
 *
 * A `NONE` valasztas soha nem egyezik egy mentett kategoriaval, es a
 * kategoria nelkul mentett eszkoz sem egyezik semmivel.
 */
export function prefillResolution(input: {
  readonly exposure: PrefillExposure;
  readonly selectedValue: string | null;
  readonly runProjectionHash: string;
  readonly savedProjectionHash: string;
  readonly savedCategoryId: string | null;
}): PrefillResolution {
  if (input.runProjectionHash !== input.savedProjectionHash) return "STALE";
  const egyezik =
    input.selectedValue !== null &&
    input.selectedValue !== NONE_KEY &&
    input.savedCategoryId === input.selectedValue;
  if (input.exposure === "SHOWN") return egyezik ? "ACCEPTED" : "OVERRIDDEN";
  return egyezik ? "SHADOW_MATCH" : "SHADOW_MISMATCH";
}

/**
 * A KILL SWITCH (P-012 8. pont): a pilot CSAK a kimondott `live` ertekre fut
 * -- ugyanaz a szokas, mint a `TICKET_MAIL_MODE`-nal. Hianyzo vagy barmi mas
 * ertek (ures, `on`, `true`, elgepeles): KI, es az urlap pontosan ugy
 * mukodik, mint a pilot elott. A biztonsagos alapertelmezes a KI.
 */
export function prefillEnabled(value: string | undefined): boolean {
  return value?.trim() === "live";
}
