/**
 * ONE CLAIM AS ONE SENTENCE (plan v4, 7 mode A; S6 slice 3): the statement
 * the answering model may select and copy, never rewrite. It is built from
 * the claim's own fields and the approved vocabulary, so it names exactly what
 * the evidence covers: the layer phrase, the certainty phrase of the claim's
 * evidence level, the species and settings of the evidence, the quantity as
 * the source wrote it, the effect and the direction.
 *
 * The sentence matches the vocabulary by STEM (sentence-parts.ts), so it is
 * built from base forms in a fixed order, not from inflected Hungarian:
 * "Kutatás szerint, egy kísérlet szerint zátony környezetben, Acropora esetén
 * 0,3–1 µmol/l foszfát mellett a kalcifikáció csökken."
 *
 * The builder checks its own result through the answer gate before it hands
 * it out: a statement the gate would drop is never sent to the model.
 *
 * Pure: no database, no clock.
 */

import { gateAnswer, LAYER_PHRASES, type PackageClaim } from "./answer-gate.js";
import type { EvidenceLevel } from "./evidence-level.js";
import type { Vocabulary } from "./vocabulary.js";

/** The quantity as the source wrote it (the claim's original columns). */
export interface OriginalQuantity {
  min: string | null;
  max: string | null;
  /** As stored: "µmol/l", "mg/l", "µg/l", "ppm", "ppb". */
  unit: string;
  basis: "PO4" | "P" | null;
}

export type StatementFailure =
  | "NO_EFFECT"
  | "NO_DIRECTION"
  | "NO_EVIDENCE_LEVEL"
  | "TERM_NOT_IN_VOCABULARY"
  | "NO_CERTAINTY_PHRASE"
  | "QUANTITY_NOT_WRITABLE"
  | "BUILT_SENTENCE_FAILS_GATE";

export type StatementResult =
  | { ok: true; statement: string }
  | { ok: false; failure: StatementFailure; detail: string };

const MOLAR = new Set(["µmol/l"]);
const MASS = new Set(["mg/l", "µg/l", "ppm", "ppb"]);

/**
 * A stored decimal in Hungarian. Three decimals after a non-zero integer part
 * ("1,125") would be read as a thousands group and not recognised, so such a
 * value gets a fourth, zero decimal ("1,1250").
 */
export function writtenNumber(value: string): string | null {
  const m = /^(\d+)(?:\.(\d+?))?0*$/.exec(value.trim());
  if (!m) return null;
  const [, int = "0", fraction = ""] = m;
  const digits = /^0*$/.test(fraction) ? "" : fraction;
  if (!digits) return int;
  const pad = digits.length === 3 && !/^0+$/.test(int) ? `${digits}0` : digits;
  return `${int},${pad}`;
}

function quantityText(q: OriginalQuantity): string | null {
  if (!MOLAR.has(q.unit) && !MASS.has(q.unit)) return null;
  if (MASS.has(q.unit) && q.basis === null) return null;
  const unit = MASS.has(q.unit) ? `${q.unit} ${q.basis}` : q.unit;
  const min = q.min === null ? null : writtenNumber(q.min);
  const max = q.max === null ? null : writtenNumber(q.max);
  if ((q.min !== null && min === null) || (q.max !== null && max === null))
    return null;
  if (min !== null && max !== null)
    return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
  if (min !== null) return `legalább ${min} ${unit}`;
  if (max !== null) return `legfeljebb ${max} ${unit}`;
  return null;
}

/** "kalcifikáció" -> "kalcifikációra", "színezet" -> "színezetre" (sublative). */
function onto(word: string): string {
  const lengthened = word.replace(/a$/u, "á").replace(/e$/u, "é");
  const vowels = word.match(/[aáeéiíoóöőuúüű]/giu) ?? [];
  const back = /[aáoóuú]/iu.test(vowels[vowels.length - 1] ?? "");
  return `${lengthened}${back ? "ra" : "re"}`;
}

/** "a kalcifikáció", "az elszíneződés". */
const the = (word: string) =>
  `${/^[aáeéiíoóöőuúüű]/iu.test(word) ? "az" : "a"} ${word}`;

const capital = (s: string) =>
  s.charAt(0).toLocaleUpperCase("hu-HU") + s.slice(1);

export function claimStatement(input: {
  claim: PackageClaim;
  quantity: OriginalQuantity | null;
  vocabulary: Vocabulary;
}): StatementResult {
  const { claim, vocabulary } = input;
  const { scope } = claim;
  const fail = (
    failure: StatementFailure,
    detail: string,
  ): StatementResult => ({
    ok: false,
    failure,
    detail,
  });
  if (scope.effect === null)
    return fail("NO_EFFECT", "the claim has no effect");
  if (scope.direction === null)
    return fail("NO_DIRECTION", "the claim has no direction");
  if (scope.evidenceLevel === null)
    return fail("NO_EVIDENCE_LEVEL", "the claim has no evidence level");

  const formOf = (
    terms: readonly { key: string; forms: string[][] }[],
    key: string,
  ) => terms.find((t) => t.key === key)?.forms[0]?.join(" ") ?? null;

  const taxa: string[] = [];
  for (const key of scope.taxa) {
    const term = vocabulary.taxa.find((t) => t.key === key);
    const form = term?.forms[0]?.join(" ");
    if (!term || !form) return fail("TERM_NOT_IN_VOCABULARY", `TAXON/${key}`);
    // a genus or species is a scientific name (capital genus); a group is a word,
    // except an abbreviation ("sps", "lps")
    taxa.push(
      term.extra.rank === "GROUP"
        ? /^\p{L}{2,3}$/u.test(form)
          ? form.toLocaleUpperCase("hu-HU")
          : form
        : capital(form),
    );
  }
  const environments: string[] = [];
  for (const key of scope.environments) {
    const form = formOf(vocabulary.environments, key);
    if (!form) return fail("TERM_NOT_IN_VOCABULARY", `ENVIRONMENT/${key}`);
    environments.push(form);
  }
  const effect = formOf(vocabulary.effects, scope.effect);
  if (!effect) return fail("TERM_NOT_IN_VOCABULARY", `EFFECT/${scope.effect}`);

  // MANUFACTURER: "a gyártó tájékoztatása szerint" is the layer phrase and a
  // SINGLE_REPORT certainty phrase at once, the weakest level, so it fits any.
  let lead: string;
  if (claim.layer === "MANUFACTURER") lead = "A gyártó tájékoztatása szerint";
  else {
    const certainty = vocabulary.certainty.find(
      (c) => c.extra.minLevel === (scope.evidenceLevel as EvidenceLevel),
    );
    const phrase = certainty?.forms[0]?.join(" ");
    if (!phrase)
      return fail(
        "NO_CERTAINTY_PHRASE",
        `no phrase for ${scope.evidenceLevel}`,
      );
    lead = `${capital(LAYER_PHRASES[claim.layer][0]!)}, ${phrase}`;
  }

  let amount = "";
  if (scope.quantity !== null) {
    const text = input.quantity === null ? null : quantityText(input.quantity);
    if (text === null)
      return fail(
        "QUANTITY_NOT_WRITABLE",
        "the claim's quantity has no writable original value, unit and basis",
      );
    // the basis word agrees with the written basis: "mg/l P foszfor", otherwise phosphate
    amount = ` ${text} ${input.quantity?.basis === "P" ? "foszfor" : "foszfát"} mellett`;
  }

  const setting = [
    environments.length ? ` ${environments.join(" és ")} környezetben` : "",
    taxa.length ? ` ${taxa.join(" és ")} esetén` : "",
  ]
    .filter(Boolean)
    .join(",");
  const outcome =
    scope.direction === "NONE"
      ? `nincs hatás ${the(onto(effect))}`
      : `${the(effect)} ${scope.direction === "INCREASE" ? "nő" : "csökken"}`;
  const statement = `${lead}${setting}${amount} ${outcome}.`
    .replace(/\s+/gu, " ")
    .replace(/ ,/gu, ",");

  const gated = gateAnswer({
    text: `${statement.replace(/\.$/u, "")} [[claim:${claim.id}]].`,
    package: [claim],
    vocabulary,
  });
  const reasons = gated.sentences.flatMap((s) => s.reasons.map((r) => r.code));
  if (gated.counts.cited !== 1 || gated.sentences.length !== 1)
    return fail(
      "BUILT_SENTENCE_FAILS_GATE",
      `${statement} -> ${reasons.join(", ") || "not one sentence"}`,
    );
  return { ok: true, statement };
}
