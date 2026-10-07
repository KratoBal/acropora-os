/**
 * A HIANYZO SZAMLAK PAROSITASI JAVASLATANAK SZABALYAI -- tiszta fuggvenyek.
 *
 * Terv: nautilus `jev-hianyzo-szamlak-terv-2026-10-01.md` 3. pont; acrobot
 * 25535. A meres: a celzott DEV es a HOLDOUT r11-gyel, 0,9-es kuszobon 0 rossz
 * SHOWN (DEV 25/48, HOLDOUT 18/27, mind nev-elteres fajta).
 *
 *   LATHATO csak ha:   a valasztas egy jelolt (nem NONE), ES a bizonyossag
 *                      >= 0,80, ES a valasztott szamla legalabb egy ponton
 *                      egyezik a terhelessel (R1: osszeg 5 Ft-on belul VAGY
 *                      hasonlo szallito), ES a terheles nem a 10%-os
 *                      kontrollba esik, ES a kapcsolo `live` (nem `shadow`)
 *   minden mas:        HIDDEN
 *   soha:              automatikus parositas -- az ember parosit, a mai kezi uton
 *
 * 2. VALTOZAT (kartya e34247c0, acrobot 27201): a 0,9-es kuszob helyett 0,8 az
 * R1 elo-szaballyal. Barracuda merese a harom halmazon (v3 DEV, v3 HOLDOUT, a
 * szeptemberi HOLDOUT): szabaly nelkul 0,8-on 55 mutatott / 3 rossz, R1-gyel
 * 52 / 0, jot nem vesz el; 0,9-en 47 / 0. A harom halmaz ezzel ELHASZNALODOTT:
 * a kapu vak halmaza CSAK az oktoberi, es ott ez a valtozat egyszer,
 * hangolas nelkul pontozodik. Arra hangolni nem szabad.
 */
import { isHiddenControl } from "./asset-category-prefill.js";
import { JEV_MODEL, PAIR_POLICY_KEY } from "./redact-r11-data.js";

export const MISSING_INVOICE_PAIR_POLICY = {
  key: PAIR_POLICY_KEY,
  version: 2,
  /** Rogzitett modell; eltunese eseten a javaslat leall, nincs `jev-latest`. */
  model: JEV_MODEL,
  /**
   * A mert kuszob, az R1 elo-szaballyal EGYUTT (2. valtozat). Csokkentese uj
   * meres; R1 nelkul a 0,8 a mert halmazokon 3 rossz javaslatot mutatott.
   */
  threshold: 0.8,
  /** A projekcio sema-azonositoja a `DecisionRun.projectionHash`-ben. */
  schema: "missing-invoices.pair@1",
  entityType: "BankTransaction",
} as const;

export const PAIR_NONE_KEY = "NONE";

export type PairMode = "off" | "shadow" | "live";

/**
 * A kapcsolo. `live`: fut es mutat. `shadow` (acrobot 25821): fut es rogzit, de
 * SOHA nem mutat; a kezi parositas feloldja (SHADOW_MATCH / SHADOW_MISMATCH),
 * tehat a friss HOLDOUT magatol gyulik, es a cimke az ember sajat dontese. Minden
 * mas ertek: KI.
 */
export function pairSuggestionMode(value: string | undefined): PairMode {
  const v = value?.trim();
  return v === "live" ? "live" : v === "shadow" ? "shadow" : "off";
}

/** Fut-e egyaltalan (`live` vagy `shadow`). */
export function pairSuggestionEnabled(value: string | undefined): boolean {
  return pairSuggestionMode(value) !== "off";
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
  /** `shadow` modban minden futas rejtett. */
  readonly mode: PairMode;
  /**
   * Az R1 elo-szabaly a VALASZTOTT szamlara (`pairRuleR1`): legalabb egy ponton
   * egyezik-e a terhelessel. Hamis: rejtett, barmilyen bizonyos a Jev.
   */
  readonly ruleR1: boolean;
}): PairExposure {
  if (input.mode !== "live") return "HIDDEN";
  const eligible =
    input.choice !== null &&
    input.choice !== PAIR_NONE_KEY &&
    input.confidence !== null &&
    input.confidence >= MISSING_INVOICE_PAIR_POLICY.threshold &&
    input.ruleR1;
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
