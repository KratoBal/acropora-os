import { parseDose } from "@acropora/jev/product-enrichment";

import { kivonat, normalizalt } from "./water-effects-lexicon.js";

/**
 * THE MANUFACTURER'S DOSING, READ FROM THE SOURCE PAGE'S DESCRIPTION (Product
 * Knowledge 2a, card 85c38ab1; Balázs 2026-10-21 20:44 UTC: "csak azt hozza
 * ellenőrzésre amiben bizonytalan vagy nem talált hozzá adatot").
 *
 * Deterministic, like the water-effects lexicon: fixed HU/EN/DE words, and the
 * verbatim text around the match is the evidence. Nothing is guessed: the
 * value is built from the numbers and units that stand in ONE sentence, and
 * goes through the `dosing` field's own parser (`parseDose`).
 *
 * A value comes out only when the page is unambiguous. Everything else gives
 * no value and a note (shown with the fetch, like the lexicon's notes), so the
 * field stays MISSING and a person looks at it:
 * - a sentence with an amount and a water volume but no period, or with more
 *   than one amount, volume or period;
 * - two different doses on the page;
 * - a conditional dose anywhere on the page (test results, first week, as
 *   needed), a range or a qualifier (max., up to) in the dose;
 * - a unit the canonical form cannot hold or a person has to interpret
 *   (gallon, gram, capful, measuring spoon), or a period other than a day or
 *   a week (every other day, monthly).
 * Any such sentence holds the value back, even next to a clean one. Only the
 * pack's reach (bottle, treats, enough, reicht, elegendő, tartalom...) is
 * noted and blocks nothing.
 */
export interface DosingReading {
  /** The canonical dose (`5 ml/100 L/day`), or `null`. */
  raw: string | null;
  /** The text around the dose, from the raw description. */
  excerpt: string | null;
  /** Why no value: one line per reason, with the text it is about. */
  notes: string[];
}

const NUM = "(?<![\\d.,])(\\d+(?:[.,]\\d+)?)";
const AMOUNT = new RegExp(
  `${NUM}\\s*(ml|milliliter[a-z]*|millilitres?|drops?|csepp[a-z]*|tropfen)(?![a-z])`,
  "g",
);
const VOLUME = new RegExp(
  `${NUM}\\s*(?:l|ltr|liters?|litres?|liter[a-z]*)(?![a-z])`,
  "g",
);
/** A range in front of a number: "1-2 ml", "1 bis 2 ml", "1–2 csepp". */
const RANGE = new RegExp(
  `\\d+(?:[.,]\\d+)?\\s*(?:-|–|to|bis|or|oder|vagy)\\s*\\d+(?:[.,]\\d+)?\\s*(?:ml|milliliter|millilitre|drop|csepp|tropfen|l\\b|liter|litre)`,
);
const PERIODS: readonly [RegExp, "day" | "week"][] = [
  [
    /\b(?:daily|a day|per day|every day|each day|taglich|pro tag|je tag|am tag|naponta|naponkent|napi|minden nap)\b|\/\s*(?:day|tag|nap)\b/g,
    "day",
  ],
  [
    /\b(?:weekly|a week|per week|every week|each week|wochentlich|pro woche|je woche|hetente|hetenkent|heti|minden heten)\b|\/\s*(?:week|woche|het)\b/g,
    "week",
  ],
];
/** How many times per period, in front of or after the period word. */
const FREQUENCY =
  /\b(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:x|times|mal|alkalommal|-?szor|-?szer|-?sz[oe]r)\b|\b(once|twice|einmal|zweimal|egyszer|ketszer)\b/g;
const FREQUENCY_WORD: Record<string, number> = {
  once: 1,
  einmal: 1,
  egyszer: 1,
  twice: 2,
  zweimal: 2,
  ketszer: 2,
};
/** A period the canonical form has no room for. */
const OTHER_PERIOD =
  /\b(?:every other day|every \d+ days|every \d+ weeks|every other week|bi-?weekly|monthly|alle \d+ tage|jeden zweiten tag|monatlich|ketnaponta|kethetente|havonta|minden masodik nap)\b/;
/** A unit a person has to interpret, next to a number. */
const OTHER_UNIT =
  /\d\s*(?:gallons?|gal\b|us gal|g\b|gramm?s?\b|grams?\b|capful|caps?\b|scoops?|spoons?|teaspoons?|tablespoons?|tsp\b|messloffel|loffel|messbecher|kupak[a-z]*|merokanal[a-z]*|kanal[a-z]*|pump[a-z]*|spritz[a-z]*)/;
/** A dose that depends on something: then the page's number is not THE dose. */
const CONDITIONAL =
  /\b(?:depending on|according to (?:the )?(?:test|measur|consumption|need)|based on (?:test|measur|consumption)|as needed|if needed|if necessary|first (?:week|weeks|days|day|month)|initially|start(?:ing)? (?:with|dose)|ramp|gradually|half (?:the )?dose|double (?:the )?dose|je nach|bei bedarf|anfangs|zu beginn|in der ersten|erste woche|ersten woche|kezdetben|eleinte|az elso het|elso heten|meres(?:ek)? alapjan|meresi eredmeny|fogyasztas(?:tol|nak megfelelo)|igeny szerint|szukseg szerint|szukseg eseten)\b/;
/**
 * A THOUSANDS GROUP ("1,000 l", "1.000 Liter", "10 000 literhez"): `NUM` takes
 * one separator as a decimal, so "1,000 l" would be ONE litre, a thousandfold
 * dose (barracuda, #1800). Refused, not read. "0.125 ml" is a decimal, not a group.
 */
const THOUSANDS =
  /(?<!\d)(?!0[.,]\d)\d{1,3}(?:[\s.,'’\u00a0\u202f]\d{3})+(?!\d)/;
/**
 * The pack's reach, not a dose ("A 250 ml bottle treats 2500 l per week",
 * "reicht für 1000 l pro Woche"): a period word does not make it an
 * instruction (barracuda, #1800).
 */
const REACH =
  /\b(?:bottles?|flasche|flakon|uveg|treats?|enough|sufficient|reicht|ausreichend|elegendo|eleg|kiszereles|tartalom|inhalt|contents?)\b/;
const QUALIFIER =
  /(?:\b(?:max|maximum|min|minimum|up to|approx|approximately|about|ca|bis zu|hochstens|maximal|legfeljebb|kb|korulbelul|akar)\b|[~≤≥<>±])/;

/** Sentences, as [start, end) offsets into the text; a decimal point is no end. */
function sentences(norm: string): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  const end = /(?<!\d)[.!?;](?!\d)|\n|<[^>]*>/g;
  for (const m of norm.matchAll(end)) {
    const at = m.index ?? 0;
    out.push([start, at]);
    start = at + m[0].length;
  }
  out.push([start, norm.length]);
  return out.filter(([a, b]) => norm.slice(a, b).trim() !== "");
}

const all = (pattern: RegExp, text: string) => [...text.matchAll(pattern)];

export function readDosing(text: string): DosingReading {
  const norm = normalizalt(text);
  const notes: string[] = [];
  // a sentence that states a dose we could not read: then no value at all
  let unreadDose = false;
  const refuse = (note: string) => {
    notes.push(note);
    unreadDose = true;
  };
  const found: { canonical: string; excerpt: string }[] = [];
  const at = (start: number, end: number) => kivonat(text, start, end);

  const conditional = CONDITIONAL.exec(norm);

  for (const [from, to] of sentences(norm)) {
    const sentence = norm.slice(from, to);
    const amounts = all(AMOUNT, sentence);
    const volumes = all(VOLUME, sentence);
    const odd = OTHER_UNIT.exec(sentence);
    const periods = PERIODS.flatMap(([pattern, period]) =>
      all(pattern, sentence).map(() => period),
    );
    const otherPeriod = OTHER_PERIOD.test(sentence);
    const where = at(from, to);
    // The pack's reach first ("500 ml 10 000 literhez elegendő", "A 250 ml bottle treats
    // 2500 l per week"): said, and it blocks nothing, with or without a period.
    if (amounts.length > 0 && volumes.length > 0 && REACH.test(sentence)) {
      notes.push(`adagolás: kiszerelés-mondat, nem adag: ${where}`);
      continue;
    }
    // An amount per volume WITHOUT a period is a dose we cannot read ("1 ml per
    // 100 l for every 20 ppm"), not a harmless remark: it holds the value back
    // like any other unread dose (Aquaforest Component A, 2026-10-21: three doses
    // on one page, two of them without a period word).
    if (periods.length === 0 && !otherPeriod) {
      if (amounts.length > 0 && volumes.length > 0)
        refuse(`adagolás: nincs gyakoriság (naponta, hetente): ${where}`);
      continue;
    }
    if (amounts.length === 0 && volumes.length === 0 && !odd) continue;
    if (REACH.test(sentence)) {
      notes.push(`adagolás: kiszerelés-mondat, nem adag: ${where}`);
      continue;
    }
    if (otherPeriod) {
      refuse(`adagolás: nem napi és nem heti gyakoriság: ${where}`);
      continue;
    }
    if (odd) {
      refuse(`adagolás: értelmezendő egység (${odd[0].trim()}): ${where}`);
      continue;
    }
    // a period with only one of the two ("1 ml naponta", "100 literenként naponta")
    if (amounts.length === 0 || volumes.length === 0) {
      refuse(`adagolás: hiányzik a mennyiség vagy a vízmennyiség: ${where}`);
      continue;
    }
    if (THOUSANDS.test(sentence)) {
      refuse(`adagolás: ezres elválasztó, kézi: ${where}`);
      continue;
    }
    if (RANGE.test(sentence)) {
      refuse(`adagolás: tartomány az adagban: ${where}`);
      continue;
    }
    if (QUALIFIER.test(sentence)) {
      refuse(`adagolás: feltételes mennyiség (max., kb.): ${where}`);
      continue;
    }
    if (amounts.length > 1 || volumes.length > 1 || new Set(periods).size > 1) {
      refuse(`adagolás: egy mondatban több adag vagy gyakoriság: ${where}`);
      continue;
    }
    const frequencies = all(FREQUENCY, sentence);
    if (frequencies.length > 1) {
      refuse(`adagolás: több gyakoriság egy mondatban: ${where}`);
      continue;
    }
    const f = frequencies[0];
    const min = f ? (f[3] ? FREQUENCY_WORD[f[3]]! : Number(f[1])) : 1;
    const max = f && f[2] ? Number(f[2]) : min;

    const amount = amounts[0]!;
    const unit = /^(?:drop|csepp|tropfen)/.test(amount[2]!) ? "drop" : "ml";
    const volume = volumes[0]!;
    const base = `${amount[1]} ${unit}/${volume[1]} L`;
    const raw =
      min === 1 && max === 1
        ? `${base}/${periods[0]}`
        : `${base}, ${min === max ? min : `${min}-${max}`}/${periods[0]}`;
    const parsed = parseDose(raw);
    if (!parsed.ok) {
      refuse(`adagolás: nem gépi alak (${parsed.reason}): ${where}`);
      continue;
    }
    found.push({ canonical: parsed.canonical, excerpt: where });
  }

  const distinct = [...new Set(found.map((f) => f.canonical))];
  if (distinct.length > 1)
    notes.push(
      `adagolás: több eltérő adag az oldalon: ${distinct.join(" | ")}`,
    );
  if (conditional && distinct.length > 0)
    notes.push(
      `adagolás: feltételhez kötött adagolás (${conditional[0]}): ${at(conditional.index, conditional.index + conditional[0].length)}`,
    );
  if (distinct.length !== 1 || conditional || unreadDose)
    return { raw: null, excerpt: null, notes };
  return { raw: distinct[0]!, excerpt: found[0]!.excerpt, notes };
}
