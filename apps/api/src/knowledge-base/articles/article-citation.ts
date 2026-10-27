import { createHash } from "node:crypto";
import {
  normaliseSentence,
  type CitationKind,
  type CitationReport,
} from "@acropora/knowledge-base";
import { richHtmlToText } from "@acropora/rich-text";

import type { Parsed } from "../sources/source-screening.js";

/**
 * AN ARTICLE'S CITATIONS (S5): the input rules and the text the check reads,
 * pure. The text is the title, the lead and the body, in that order: each is
 * public, so each sentence of each stands on a claim, a conclusion or a
 * reasoned "not technical" mark.
 */
export const CITATION_LIMITS = { sentence: 2000, reason: 2000, codes: 20 };

export type CitationInput =
  | { sentence: string; kind: "CLAIM"; targetId: string }
  | { sentence: string; kind: "CONCLUSION"; targetId: string }
  | { sentence: string; kind: "NOT_TECHNICAL"; reason: string };

export interface AnswerInput {
  codes: string[];
  reason: string;
}

const trimmed = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export function parseCitationInput(body: unknown): Parsed<CitationInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = trimmed(b.sentence);
  if (raw === null)
    return { ok: false, problems: ["sentence: a mondat kötelező."] };
  const sentence = normaliseSentence(raw);
  if (sentence.length > CITATION_LIMITS.sentence)
    return {
      ok: false,
      problems: [`sentence: legfeljebb ${CITATION_LIMITS.sentence} karakter.`],
    };
  const kind = b.kind as CitationKind;
  if (kind === "CLAIM" || kind === "CONCLUSION") {
    const field = kind === "CLAIM" ? "claimId" : "conclusionId";
    const other = kind === "CLAIM" ? "conclusionId" : "claimId";
    const targetId = trimmed(b[field]);
    if (targetId === null)
      return { ok: false, problems: [`${field}: kötelező.`] };
    if (b[other] !== undefined && b[other] !== null)
      return {
        ok: false,
        problems: [`${other}: egy hivatkozásnak egy célja van.`],
      };
    if (b.reason !== undefined && b.reason !== null)
      return {
        ok: false,
        problems: ["reason: csak a nem szakmai jelölésnek van oka."],
      };
    return { ok: true, value: { sentence, kind, targetId } };
  }
  if (kind === "NOT_TECHNICAL") {
    const reason = trimmed(b.reason);
    if (reason === null)
      return {
        ok: false,
        problems: ["reason: a nem szakmai jelöléshez az ok kötelező."],
      };
    if (reason.length > CITATION_LIMITS.reason)
      return {
        ok: false,
        problems: [`reason: legfeljebb ${CITATION_LIMITS.reason} karakter.`],
      };
    if (b.claimId != null || b.conclusionId != null)
      return {
        ok: false,
        problems: ["a nem szakmai jelölés nem hivatkozik állításra."],
      };
    return { ok: true, value: { sentence, kind, reason } };
  }
  return {
    ok: false,
    problems: ["kind: CLAIM, CONCLUSION vagy NOT_TECHNICAL."],
  };
}

export function parseAnswerInput(body: unknown): Parsed<AnswerInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const codes = Array.isArray(b.codes) ? b.codes : null;
  if (
    codes === null ||
    codes.length === 0 ||
    codes.length > CITATION_LIMITS.codes ||
    !codes.every((c) => typeof c === "string" && /^[A-Z_]{1,64}$/.test(c))
  )
    problems.push(
      `codes: 1-${CITATION_LIMITS.codes} figyelmeztetés-kód, ahogy az ellenőrzés adta.`,
    );
  const reason = trimmed(b.reason);
  if (reason === null) problems.push("reason: az elfogadás oka kötelező.");
  else if (reason.length > CITATION_LIMITS.reason)
    problems.push(`reason: legfeljebb ${CITATION_LIMITS.reason} karakter.`);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: { codes: [...new Set(codes as string[])], reason: reason! },
  };
}

/** The plain text the check splits: title, lead, body, one block each. */
export function articleText(article: {
  title: string;
  excerpt: string;
  bodyHtml: string;
}): string {
  return [
    article.title,
    article.excerpt,
    richHtmlToText(article.bodyHtml, { profile: "full" }),
  ]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}

/** The key a stored sentence is matched by. */
export function sentenceHash(sentence: string): string {
  return createHash("sha256").update(normaliseSentence(sentence)).digest("hex");
}

/**
 * Why a knowledge article's report blocks its approval, in the editor's
 * words. Every blocker is named: one the message does not know reads as "the
 * vocabulary check cannot run", never as an empty list (barracuda on #1925).
 */
export function approvalBlockMessage(
  report: Pick<CitationReport, "counts" | "blockers">,
): string {
  const { counts } = report;
  const other = report.blockers.filter((b) => b !== "VOCABULARY_NOT_APPROVED");
  const parts = [
    counts.uncited ? `${counts.uncited} hivatkozás nélküli mondat` : null,
    counts.invalid ? `${counts.invalid} hibás hivatkozás` : null,
    counts.unansweredWarnings
      ? `${counts.unansweredWarnings} megválaszolatlan figyelmeztetés`
      : null,
    report.blockers.includes("VOCABULARY_NOT_APPROVED")
      ? "a szótár nincs jóváhagyva"
      : null,
    other.length
      ? `a szótár-ellenőrzés nem futhat (${other.join(", ")})`
      : null,
    counts.sentences === 0 ? "a cikknek nincs mondata" : null,
  ].filter((p): p is string => p !== null);
  return `A cikk hivatkozás-ellenőrzése nem tiszta (${parts.join(", ")}), ezért nem hagyható jóvá. A Hivatkozások panelen rendezd, és küldd újra jóváhagyásra.`;
}
