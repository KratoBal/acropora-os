import { createHash } from "node:crypto";

import type {
  ProductHusbandryFacts,
  ProductHusbandryField,
  ProductHusbandryInput,
  ProductLivestockKind,
} from "@acropora/types";

/**
 * THE RULES OF THE HUSBANDRY BLOCK (V2.2, card d2fc06e7; spec exchange/otletek-2026-11-04/v2-2-tartasi-blokk.md).
 *
 * Pure functions, no database: the write path (`product-husbandry.repository.ts`) and the tests call them.
 *
 * ONE RULE RUNS THROUGH ALL OF IT: a null fact is "being checked", never a default, and nothing is guessed. A required
 * field that is missing is NAMED (`missingHusbandryFields`), it is not filled in.
 */

/**
 * The words the spec forbids in the block's own texts ("tökéletes", "mindenkinek", "problémamentes", spec section 2). A
 * substring match on the stem, so a suffixed form ("mindenkinek", "tökéletesen") is caught as well.
 */
const FORBIDDEN_WORD = /tökéletes|mindenkinek|problémamentes/i;

/** The free-text facts the forbidden-word rule reads. */
const TEXT_FACTS = [
  "reefSafeIndok",
  "kinekNem",
  "etetesGyakorisag",
  "handlingWarning",
  "acclimatization",
] as const satisfies readonly ProductHusbandryField[];

/** The genus the first step may never be given to (spec section 2: "az 1-es fokozat semmilyen Acropora fajra"). */
const NEVER_BEGINNER_GENUS = "acropora";

export interface HusbandryWriteCheck {
  patch: ProductHusbandryInput;
  /** The stored facts the write is applied to. */
  current: ProductHusbandryFacts;
}

/** The value a fact will have AFTER the patch (an absent key keeps the stored value). */
function after<K extends Exclude<ProductHusbandryField, "magyarNev">>(
  check: HusbandryWriteCheck,
  key: K,
): unknown {
  const value = check.patch[key];
  return value === undefined ? check.current[key] : value;
}

function numberOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function filled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/**
 * THE WRITE RULES: the messages are Hungarian (they reach the screen), an empty list means the write may go ahead.
 *
 * - the first difficulty step is never given to an Acropora genus, and not to a row whose genus is not filled in either:
 *   without the genus the rule cannot be applied, and a rule that cannot be applied does not pass (the schema comment
 *   already asks for the genus to be filled FIRST);
 * - the forbidden words stay out of the block's texts;
 * - the verification needs the source's type and reference.
 */
export function husbandryWriteErrors(
  check: HusbandryWriteCheck,
  verifies: boolean,
): string[] {
  const errors: string[] = [];

  if (after(check, "careDifficulty") === "KONNYU") {
    const genus = after(check, "genus");
    if (typeof genus !== "string" || genus.trim() === "")
      errors.push(
        "Az 1-es fokozat (Kezdőknek is) csak kitöltött nemzetséggel adható: nemzetség nélkül nem dönthető el, hogy Acropora-e.",
      );
    else if (genus.trim().toLowerCase() === NEVER_BEGINNER_GENUS)
      errors.push("Az 1-es fokozat (Kezdőknek is) Acropora fajra nem adható.");
  }

  for (const key of TEXT_FACTS) {
    const value = check.patch[key];
    if (typeof value === "string" && FORBIDDEN_WORD.test(value))
      errors.push(
        `A(z) ${key} szövegében tiltott szó áll (tökéletes, mindenkinek, problémamentes).`,
      );
  }

  /*
    THE OPTIONAL FACTS' RULES (V2.2 S1b). A range is two ends that must not cross (judged on the state AFTER the write, so one end
    written alone is held against the stored other end); a sting or venom that is stated needs its handling warning (a hazard
    stated without the warning is the block's one safety hole).
  */
  for (const [low, high, label] of [
    ["tempMinC", "tempMaxC", "hőmérséklet"],
    ["salinityMinSg", "salinityMaxSg", "sótartalom"],
    ["khMinDkh", "khMaxDkh", "KH"],
  ] as const) {
    const min = numberOf(after(check, low));
    const max = numberOf(after(check, high));
    if (min !== null && max !== null && min > max)
      errors.push(
        `A(z) ${label} tartomány alsó értéke nem lehet nagyobb a felsőnél.`,
      );
  }
  if (
    after(check, "stingOrVenom") === true &&
    !filled(after(check, "handlingWarning"))
  )
    errors.push("Csípés vagy méreg jelzéséhez a kezelési figyelmeztetés kell.");

  if (verifies) {
    if (!filled(after(check, "forrasTipus")))
      errors.push("Az ellenőrzéshez a forrás típusa kell.");
    if (!filled(after(check, "forrasHivatkozas")))
      errors.push("Az ellenőrzéshez a forrás hivatkozása kell.");
  }
  return errors;
}

/**
 * THE REQUIRED FIELDS STILL MISSING (spec section 1, "Kötelező"). Empty = complete.
 *
 * The names are the fact keys, plus `livestockKind` (the category tree does not say what animal this is, so the space
 * rule cannot be applied) and `verification` (the facts were not verified after their last edit).
 *
 * THE SPACE RULE, by kind: a fish needs the minimum tank volume; a coral needs the placement zone (the spec: "korallnál
 * helyette: elhelyezés"); an invertebrate needs either (the spec says "nagyobb gerincteleneknél" and does not say which
 * ones, so either answer to "how much space, where" is taken; this is a reading, named in the pull request).
 */
export function missingHusbandryFields(
  facts: ProductHusbandryFacts,
  kind: ProductLivestockKind | null,
  verified: boolean,
): string[] {
  const missing: string[] = [];
  const need = (key: ProductHusbandryField): void => {
    if (!filled(facts[key])) missing.push(key);
  };

  for (const key of [
    "magyarNev",
    "genus",
    "careDifficulty",
    "medenceErettsegHonap",
    "reefSafe",
    "reefSafeIndok",
    "socialKeeping",
    "aggression",
    "korallevo",
    "gerinctelenevo",
    "feedingType",
    "etetesGyakorisag",
    "eloEleseg",
    "fenyIgeny",
    "aramlasIgeny",
    "meretMax",
    "meretDimenzio",
    "szarmazas",
    "kinekNem",
    "forrasTipus",
    "forrasHivatkozas",
  ] as const satisfies readonly ProductHusbandryField[])
    need(key);

  if (kind === null) missing.push("livestockKind");
  else if (kind === "FISH") need("minLiter");
  else if (kind === "CORAL") need("elhelyezesZona");
  else if (!filled(facts.minLiter) && !filled(facts.elhelyezesZona))
    missing.push("minLiter");

  if (!verified) missing.push("verification");
  return missing;
}

/** The text columns are trimmed on the way in; an empty text clears the fact (null), it is not "filled". */
export function normalizedHusbandryTexts(
  patch: ProductHusbandryInput,
): ProductHusbandryInput {
  const out: ProductHusbandryInput = { ...patch };
  for (const key of [
    "genus",
    "species",
    "reefSafeIndok",
    "etetesGyakorisag",
    "kinekNem",
    "forrasTipus",
    "forrasHivatkozas",
    "handlingWarning",
    "acclimatization",
  ] as const) {
    const value = out[key];
    if (typeof value === "string") out[key] = value.trim() || null;
  }
  return out;
}

/**
 * THE VERSION OF THE FACTS (V2.2 S2, barracuda on #2375): a digest of every fact the block carries, the Hungarian name
 * included. A verification must name the version its author SAW; the decision compares it with the stored row inside the
 * serializable transaction, so a fact that changed in between (from another tab, a colleague, the names path or the general
 * update) cannot be stamped as verified by someone who never saw it. The key order is the facts object's own, fixed by
 * `husbandryFactsOf`; the verification stamp is not part of it (a stamp is not a fact).
 */
export function husbandryVersionOf(facts: ProductHusbandryFacts): string {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}
