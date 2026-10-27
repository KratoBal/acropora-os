import type { Parsed } from "../sources/source-screening.js";

/**
 * OWN CONCLUSIONS (S5, plan v4 6. and 7. step 7): the editor's own statement,
 * always built on VERIFIED claims. The input rules live here, pure; the
 * repository checks the claims' status in the same transaction as the write.
 */
export const CONCLUSION_LIMITS = {
  text: 2000,
  reasoning: 8000,
  claims: 50,
  reason: 2000,
} as const;

export interface ConclusionInput {
  text: string;
  reasoning: string;
  claimIds: string[];
}

const trimmed = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export function parseConclusionInput(body: unknown): Parsed<ConclusionInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const text = trimmed(b.text);
  const reasoning = trimmed(b.reasoning);
  if (text === null) problems.push("text: a következtetés szövege kötelező.");
  else if (text.length > CONCLUSION_LIMITS.text)
    problems.push(`text: legfeljebb ${CONCLUSION_LIMITS.text} karakter.`);
  if (reasoning === null) problems.push("reasoning: az indoklás kötelező.");
  else if (reasoning.length > CONCLUSION_LIMITS.reasoning)
    problems.push(
      `reasoning: legfeljebb ${CONCLUSION_LIMITS.reasoning} karakter.`,
    );
  const ids = Array.isArray(b.claimIds) ? b.claimIds : null;
  if (
    ids === null ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === "string" && id.trim() !== "")
  )
    problems.push(
      "claimIds: legalább egy állítás kell; a következtetés mindig állításokra épül.",
    );
  else if (new Set(ids).size > CONCLUSION_LIMITS.claims)
    problems.push(`claimIds: legfeljebb ${CONCLUSION_LIMITS.claims} állítás.`);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      text: text!,
      reasoning: reasoning!,
      claimIds: [...new Set(ids as string[])],
    },
  };
}

/** A withdrawal's or an answer's reason: required, bounded. */
export function parseReason(body: unknown): Parsed<string> {
  const reason = trimmed(((body ?? {}) as Record<string, unknown>).reason);
  if (reason === null)
    return { ok: false, problems: ["reason: az ok kötelező."] };
  if (reason.length > CONCLUSION_LIMITS.reason)
    return {
      ok: false,
      problems: [`reason: legfeljebb ${CONCLUSION_LIMITS.reason} karakter.`],
    };
  return { ok: true, value: reason };
}
