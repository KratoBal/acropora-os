/**
 * THE ARTICLE'S CITATION CHECK (plan v4, 9.2 S5 and 7a): every sentence of a
 * knowledge article stands on a VERIFIED claim, an APPROVED conclusion, or the
 * editor's reasoned "not technical" mark, and every claim citation goes
 * through the per-field sentence check (`checkSentence`).
 *
 * In an article the check WARNS, it does not delete (plan 7a, "Ahol
 * szakmailag mást javaslok"): the text is the editor's, and each warning is
 * answered, accepted with a reason or fixed. An answer covers the codes it
 * named: a new code (after the claim or the vocabulary changed) is open again.
 *
 * A citation holds its sentence VERBATIM (whitespace normalised). A sentence
 * that was rewritten no longer matches, so its old citation is ORPHANED and
 * the new wording is UNCITED: a changed sentence never keeps the support of
 * the one it replaced.
 *
 * Pure: no database, no clock. The caller assembles each claim's scope.
 */

import {
  checkSentence,
  type CheckFailure,
  type ClaimScope,
} from "./compare.js";
import { recogniseSentence } from "./sentence-parts.js";
import type { Vocabulary } from "./vocabulary.js";

/** NFC, every whitespace run one space, trimmed: the form a citation is stored and matched in. */
export function normaliseSentence(sentence: string): string {
  return sentence.normalize("NFC").replace(/\s+/gu, " ").trim();
}

// A period after one of these does not end a sentence ("pl. az Acropora",
// "kb. 0,03 mg/l", "Acropora spp. esetén"). Compared lowercased.
const ABBREVIATIONS = new Set([
  "pl",
  "kb",
  "stb",
  "ill",
  "ún",
  "vö",
  "ld",
  "lásd",
  "dr",
  "sp",
  "spp",
  "ssp",
  "cf",
  "ca",
  "al",
  "max",
  "min",
  "fig",
  "ábr",
  "tbl",
]);

// A list marker as `richHtmlToText` writes it: "- ", "  - ", "3. ".
const LIST_MARKER = /^\s*(?:-|\d+\.)\s+/u;
const RULE = /^-{3,}$/u;

/**
 * The sentences of an article's plain text (`richHtmlToText` output): blocks
 * and lines first, then a sentence end (. ! ? …) followed by a space and a
 * capital, a digit or an opening quote. A period after a listed abbreviation,
 * after a single letter ("A. millepora") or inside a number does not split.
 * Normalised, in reading order, without empty items.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\n/u)) {
    const line = normaliseSentence(rawLine.replace(LIST_MARKER, ""));
    if (!line || RULE.test(line)) continue;
    let start = 0;
    const end = /[.!?…]+["”»)]?(?=\s+["„«(]?[\p{Lu}\d])/gu;
    for (const m of line.matchAll(end)) {
      const at = m.index ?? 0;
      if (m[0].startsWith(".")) {
        const before = /([\p{L}]+)$/u.exec(line.slice(start, at))?.[1] ?? "";
        if ([...before].length === 1 || ABBREVIATIONS.has(before.toLowerCase()))
          continue;
      }
      const sentence = line.slice(start, at + m[0].length).trim();
      if (sentence) out.push(sentence);
      start = at + m[0].length;
    }
    const rest = line.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out;
}

export type CitationKind = "CLAIM" | "CONCLUSION" | "NOT_TECHNICAL";

export interface CitationRow {
  id: string;
  /** As stored: normalised. */
  sentence: string;
  kind: CitationKind;
  claimId: string | null;
  conclusionId: string | null;
  answeredCodes: readonly string[];
}

/** A cited claim as the caller loaded it. `scope` is read only for a VERIFIED claim. */
export interface CitedClaim {
  status: string;
  scope: ClaimScope;
}

export interface CitedConclusion {
  status: string;
  /** The statuses of the claims it is based on. */
  claimStatuses: readonly string[];
}

export type CitationProblem =
  | "CLAIM_MISSING"
  | "CLAIM_NOT_VERIFIED"
  | "CONCLUSION_MISSING"
  | "CONCLUSION_NOT_APPROVED"
  | "CONCLUSION_CLAIM_NOT_VERIFIED"
  | "NOT_TECHNICAL_WITH_CITATION";

/** The warning a NOT_TECHNICAL mark gets when the sentence has recognised claim parts. */
export const NOT_TECHNICAL_HAS_CLAIM_PARTS = "NOT_TECHNICAL_HAS_CLAIM_PARTS";

export interface CitationCheck {
  id: string;
  kind: CitationKind;
  /** Hard problems: the citation does not support the sentence, no answer helps. */
  problems: CitationProblem[];
  /** The sentence check's findings (and the not-technical mark's), answerable. */
  warnings: CheckFailure[];
  /** Warning codes not yet answered. */
  unanswered: string[];
}

export type SentenceStatus = "OK" | "UNCITED" | "INVALID" | "WARNING";

export interface SentenceReport {
  sentence: string;
  status: SentenceStatus;
  citations: CitationCheck[];
}

export interface CitationReport {
  sentences: SentenceReport[];
  /** Citations whose sentence is no longer in the text. */
  orphaned: { id: string; sentence: string; kind: CitationKind }[];
  /** The sentence check cannot run as a gate (an unapproved vocabulary). */
  blockers: string[];
  counts: {
    sentences: number;
    uncited: number;
    invalid: number;
    unansweredWarnings: number;
    orphaned: number;
  };
  /** At least one sentence, nothing uncited or invalid, every warning answered, no blocker. */
  clean: boolean;
}

/** Rows the report treats as blockers rather than as an answerable warning. */
const BLOCKING_ROWS = new Set(["VOCABULARY"]);

export function citationReport(input: {
  text: string;
  citations: readonly CitationRow[];
  claims: ReadonlyMap<string, CitedClaim>;
  conclusions: ReadonlyMap<string, CitedConclusion>;
  vocabulary: Vocabulary;
}): CitationReport {
  const sentences = splitSentences(input.text);
  const present = new Set(sentences);
  const bySentence = new Map<string, CitationRow[]>();
  for (const row of input.citations) {
    const key = normaliseSentence(row.sentence);
    bySentence.set(key, [...(bySentence.get(key) ?? []), row]);
  }
  const blockers = new Set<string>();
  if (input.vocabulary.status !== "APPROVED")
    blockers.add("VOCABULARY_NOT_APPROVED");

  const checkOne = (
    sentence: string,
    row: CitationRow,
    siblings: readonly CitationRow[],
  ): CitationCheck => {
    const problems: CitationProblem[] = [];
    let warnings: CheckFailure[] = [];
    if (row.kind === "CLAIM") {
      const claim = row.claimId ? input.claims.get(row.claimId) : undefined;
      if (!claim) problems.push("CLAIM_MISSING");
      else if (claim.status !== "VERIFIED") problems.push("CLAIM_NOT_VERIFIED");
      else {
        const result = checkSentence(sentence, claim.scope, input.vocabulary);
        for (const f of result.failures)
          if (BLOCKING_ROWS.has(f.row)) blockers.add(f.code);
        warnings = result.failures.filter((f) => !BLOCKING_ROWS.has(f.row));
      }
    } else if (row.kind === "CONCLUSION") {
      // A conclusion has no structured scope: its own approval is the check,
      // and it stands only while every claim under it is still VERIFIED.
      const conclusion = row.conclusionId
        ? input.conclusions.get(row.conclusionId)
        : undefined;
      if (!conclusion) problems.push("CONCLUSION_MISSING");
      else {
        if (conclusion.status !== "APPROVED")
          problems.push("CONCLUSION_NOT_APPROVED");
        if (
          conclusion.claimStatuses.length === 0 ||
          conclusion.claimStatuses.some((s) => s !== "VERIFIED")
        )
          problems.push("CONCLUSION_CLAIM_NOT_VERIFIED");
      }
    } else {
      if (siblings.some((s) => s.kind !== "NOT_TECHNICAL"))
        problems.push("NOT_TECHNICAL_WITH_CITATION");
      const parts = recogniseSentence(sentence, input.vocabulary);
      const named = [
        ...parts.taxa,
        ...parts.effects,
        ...parts.environments,
        ...parts.quantities.map((q) => q.text),
      ];
      if (named.length > 0)
        warnings = [
          {
            row: "OVERGENERALISATION",
            code: NOT_TECHNICAL_HAS_CLAIM_PARTS,
            detail: `marked not technical, yet it names ${named.join(", ")}`,
          },
        ];
    }
    const answered = new Set(row.answeredCodes);
    return {
      id: row.id,
      kind: row.kind,
      problems,
      warnings,
      unanswered: [
        ...new Set(warnings.map((w) => w.code).filter((c) => !answered.has(c))),
      ],
    };
  };

  const reports: SentenceReport[] = sentences.map((sentence) => {
    const rows = bySentence.get(sentence) ?? [];
    const citations = rows.map((row) => checkOne(sentence, row, rows));
    const status: SentenceStatus =
      citations.length === 0
        ? "UNCITED"
        : citations.some((c) => c.problems.length > 0)
          ? "INVALID"
          : citations.some((c) => c.unanswered.length > 0)
            ? "WARNING"
            : "OK";
    return { sentence, status, citations };
  });

  const orphaned = input.citations
    .filter((row) => !present.has(normaliseSentence(row.sentence)))
    .map((row) => ({ id: row.id, sentence: row.sentence, kind: row.kind }));
  const counts = {
    sentences: reports.length,
    uncited: reports.filter((r) => r.status === "UNCITED").length,
    invalid: reports.filter((r) => r.status === "INVALID").length,
    unansweredWarnings: reports.reduce(
      (n, r) => n + r.citations.reduce((m, c) => m + c.unanswered.length, 0),
      0,
    ),
    orphaned: orphaned.length,
  };
  return {
    sentences: reports,
    orphaned,
    blockers: [...blockers],
    counts,
    // an article without a sentence has nothing cited, not everything
    clean:
      counts.sentences > 0 &&
      blockers.size === 0 &&
      counts.uncited === 0 &&
      counts.invalid === 0 &&
      counts.unansweredWarnings === 0,
  };
}
