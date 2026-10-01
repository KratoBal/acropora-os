/**
 * A HIANYZO SZAMLAK PAROSITASI JAVASLATANAK SZABALYAI -- tiszta fuggvenyek.
 *
 * Terv: nautilus `jev-hianyzo-szamlak-terv-2026-10-01.md` 3. pont; acrobot
 * 25535. A meres: a celzott DEV es a HOLDOUT r11-gyel, 0,9-es kuszobon 0 rossz
 * SHOWN (DEV 25/48, HOLDOUT 18/27, mind nev-elteres fajta).
 *
 *   LATHATO csak ha:   a valasztas egy jelolt (nem NONE), ES a bizonyossag
 *                      >= 0,90, ES a terheles nem a 10%-os kontrollba esik
 *   minden mas:        HIDDEN
 *   soha:              automatikus parositas -- az ember parosit, a mai kezi uton
 */
import { isHiddenControl } from "./asset-category-prefill.js";
import { JEV_MODEL, PAIR_POLICY_KEY } from "./redact-data.js";

export const MISSING_INVOICE_PAIR_POLICY = {
  key: PAIR_POLICY_KEY,
  version: 1,
  /** Rogzitett modell; eltunese eseten a javaslat leall, nincs `jev-latest`. */
  model: JEV_MODEL,
  /** A mert kuszob; csokkentese uj meres (a kapu nem sullyed, a kuszob emelkedik). */
  threshold: 0.9,
  /** A projekcio sema-azonositoja a `DecisionRun.projectionHash`-ben. */
  schema: "missing-invoices.pair@1",
  entityType: "BankTransaction",
} as const;

export const PAIR_NONE_KEY = "NONE";

/** A kapcsolo: CSAK a kimondott `live` ertekre fut; minden mas KI. */
export function pairSuggestionEnabled(value: string | undefined): boolean {
  return value?.trim() === "live";
}

export type PairExposure = "HIDDEN" | "SHOWN";

/**
 * A 10%-os rejtett kontroll a terheles azonositojan: ugyanaz a terheles minden
 * futasnal ugyanabba a csoportba esik.
 */
export function pairExposure(input: {
  readonly choice: string | null;
  readonly confidence: number | null;
  readonly bankTransactionId: string;
}): PairExposure {
  const eligible =
    input.choice !== null &&
    input.choice !== PAIR_NONE_KEY &&
    input.confidence !== null &&
    input.confidence >= MISSING_INVOICE_PAIR_POLICY.threshold;
  if (!eligible) return "HIDDEN";
  return isHiddenControl(
    input.bankTransactionId,
    MISSING_INVOICE_PAIR_POLICY.version,
  )
    ? "HIDDEN"
    : "SHOWN";
}

export type PairResolution =
  "ACCEPTED" | "OVERRIDDEN" | "SHADOW_MATCH" | "SHADOW_MISMATCH";

/**
 * A FELOLDAS A KEZI PAROSITASKOR: a javasolt szamla (azonosito) es amit az ember
 * valasztott. Egy NONE javaslat soha nem egyezik egy parositott szamlaval.
 */
export function pairResolution(input: {
  readonly exposure: PairExposure;
  readonly selectedDocumentId: string | null;
  readonly pairedDocumentId: string;
}): PairResolution {
  const match =
    input.selectedDocumentId !== null &&
    input.selectedDocumentId !== PAIR_NONE_KEY &&
    input.selectedDocumentId === input.pairedDocumentId;
  if (input.exposure === "SHOWN") return match ? "ACCEPTED" : "OVERRIDDEN";
  return match ? "SHADOW_MATCH" : "SHADOW_MISMATCH";
}
