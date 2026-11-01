import { createHash } from "node:crypto";

import {
  claimStatement,
  type OriginalQuantity,
  type PackageClaim,
  type StatementFailure,
  type Vocabulary,
} from "@acropora/knowledge-base";

import type { Parsed } from "../sources/source-screening.js";

/**
 * THE SECOND MODEL'S FLAGS (plan v4, 7a 3.; S4): what the fleet's independent
 * model reads, and how its answer comes back. The fleet pulls the items waiting
 * for a flag, runs the model on its own runner and writes the flags back; the
 * OS calls nothing outward (acrobot 39518, path B).
 *
 * The asymmetry is the point: a flag sends the item to the editor, silence
 * ("nem jelzett") accepts nothing, and neither changes any status. The item's
 * `targetHash` is the digest of exactly the input the model saw, so a flag on
 * an item edited since is shown as stale, and a write against an input that
 * is no longer the item's is refused.
 *
 * The items waiting for a flag (the plan left the set to this PR):
 * - a claim in CANDIDATE: the editor has not accepted it yet, and the check
 *   ("the excerpt speaks of the same effect as the claim") is meant to reach
 *   the editor before the acceptance; a VERIFIED claim was already read;
 * - a conclusion in DRAFT: the approval is the editor's, and the flag is for
 *   before it; an approved conclusion's text never changes, a correction is a
 *   new draft and comes round again.
 * An item that cannot be given to the model is not hidden: it is listed with
 * its reason (`notOffered`).
 *
 * Pure: no database, no clock.
 */

export const FLAG_TARGETS = ["CLAIM", "CONCLUSION"] as const;
export type FlagTarget = (typeof FLAG_TARGETS)[number];

/** A claim and the verbatim excerpts that support it. */
export interface ClaimFlagItem {
  targetType: "CLAIM";
  targetId: string;
  targetHash: string;
  /** The supporting passages, verbatim-verified, as the source wrote them. */
  passages: string[];
  claim: {
    effect: string;
    /** The vocabulary's first form of the effect. */
    effectLabel: string;
    direction: string;
    taxa: string[];
  };
}

/** A conclusion and the sentences the system states for its claims. */
export interface ConclusionFlagItem {
  targetType: "CONCLUSION";
  targetId: string;
  targetHash: string;
  conclusion: string;
  basis: string[];
}

export type FlagItem = ClaimFlagItem | ConclusionFlagItem;

export type NotOfferedReason =
  | "NO_EFFECT"
  | "EFFECT_NOT_IN_VOCABULARY"
  | "NO_DIRECTION"
  | "NO_TAXON"
  | "NO_VERBATIM_PASSAGE"
  | "NO_BASIS"
  | "BASIS_NOT_STATED";

export interface NotOffered {
  targetId: string;
  reason: NotOfferedReason;
  /** For BASIS_NOT_STATED: the claim and why its statement failed. */
  detail?: { claimId: string; failure: StatementFailure };
}

export type Built<T> =
  { ok: true; item: T } | { ok: false; notOffered: NotOffered };

/** SHA-256 of the model-visible parts, in a fixed order. */
export function targetHash(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function claimFlagItem(input: {
  id: string;
  effect: string | null;
  direction: string | null;
  taxa: readonly string[];
  passages: readonly string[];
  vocabulary: Vocabulary;
}): Built<ClaimFlagItem> {
  const no = (reason: NotOfferedReason): Built<ClaimFlagItem> => ({
    ok: false,
    notOffered: { targetId: input.id, reason },
  });
  if (input.effect === null) return no("NO_EFFECT");
  const term = input.vocabulary.effects.find((t) => t.key === input.effect);
  const effectLabel = term?.forms[0]?.join(" ");
  if (!effectLabel) return no("EFFECT_NOT_IN_VOCABULARY");
  if (input.direction === null) return no("NO_DIRECTION");
  if (input.taxa.length === 0) return no("NO_TAXON");
  const passages = [...new Set(input.passages)];
  if (passages.length === 0) return no("NO_VERBATIM_PASSAGE");
  const claim = {
    effect: input.effect,
    effectLabel,
    direction: input.direction,
    taxa: [...input.taxa],
  };
  return {
    ok: true,
    item: {
      targetType: "CLAIM",
      targetId: input.id,
      targetHash: targetHash([
        "CLAIM",
        passages,
        claim.effect,
        claim.effectLabel,
        claim.direction,
        claim.taxa,
      ]),
      passages,
      claim,
    },
  };
}

export function conclusionFlagItem(input: {
  id: string;
  text: string;
  basis: readonly { claim: PackageClaim; quantity: OriginalQuantity | null }[];
  vocabulary: Vocabulary;
}): Built<ConclusionFlagItem> {
  if (input.basis.length === 0)
    return {
      ok: false,
      notOffered: { targetId: input.id, reason: "NO_BASIS" },
    };
  const basis: string[] = [];
  for (const b of input.basis) {
    const r = claimStatement({
      claim: b.claim,
      quantity: b.quantity,
      vocabulary: input.vocabulary,
    });
    if (!r.ok)
      return {
        ok: false,
        notOffered: {
          targetId: input.id,
          reason: "BASIS_NOT_STATED",
          detail: { claimId: b.claim.id, failure: r.failure },
        },
      };
    basis.push(r.statement);
  }
  return {
    ok: true,
    item: {
      targetType: "CONCLUSION",
      targetId: input.id,
      targetHash: targetHash(["CONCLUSION", input.text, basis]),
      conclusion: input.text,
      basis,
    },
  };
}

/** The items whose current input has no flag yet, in id order, at most `limit`. */
export function pendingItems<T extends FlagItem>(
  items: readonly T[],
  flaggedHashes: ReadonlyMap<string, ReadonlySet<string>>,
  limit: number,
): { items: T[]; total: number } {
  const waiting = items
    .filter((i) => !flaggedHashes.get(i.targetId)?.has(i.targetHash))
    .sort((a, b) =>
      a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0,
    );
  return { items: waiting.slice(0, limit), total: waiting.length };
}

export const FLAG_LIMITS = {
  /** The runner's own maximum per run (acroveliq MAX_ITEMS). */
  perRequest: 50,
  /** The daily budget of the manual rounds (acrobot 39518). */
  defaultPending: 40,
} as const;

export function parseTarget(v: unknown): FlagTarget | null {
  return (FLAG_TARGETS as readonly unknown[]).includes(v)
    ? (v as FlagTarget)
    : null;
}

export function parseLimit(v: unknown): number | null {
  if (v === undefined || v === "") return FLAG_LIMITS.defaultPending;
  const n = typeof v === "string" && /^\d{1,3}$/.test(v) ? Number(v) : NaN;
  return n >= 1 && n <= FLAG_LIMITS.perRequest ? n : null;
}

export interface FlagWrite {
  source: string;
  runId: string;
  model: string;
  promptSha256: string;
  flags: {
    targetType: FlagTarget;
    targetId: string;
    targetHash: string;
    flagged: boolean;
  }[];
}

const SOURCE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The write's shape. Whether each item is known and current is the repository's check. */
export function parseFlagWrite(body: unknown): Parsed<FlagWrite> {
  const b = (body ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  if (!SOURCE.test(str("source")))
    problems.push("source: kisbetűs kulcs, pl. gpt-runner.");
  if (!LABEL.test(str("runId")))
    problems.push("runId: a futás azonosítója, legfeljebb 64 karakter.");
  if (!LABEL.test(str("model")))
    problems.push("model: a modell címkéje, legfeljebb 64 karakter.");
  if (!SHA256.test(str("promptSha256")))
    problems.push("promptSha256: 64 kisbetűs hexa jegy.");
  const flags = Array.isArray(b.flags) ? b.flags : null;
  if (
    flags === null ||
    flags.length === 0 ||
    flags.length > FLAG_LIMITS.perRequest
  ) {
    problems.push(`flags: 1-${FLAG_LIMITS.perRequest} jelzés.`);
  } else {
    const seen = new Set<string>();
    flags.forEach((f: unknown, i) => {
      const x = (f ?? {}) as Record<string, unknown>;
      const at = `flags[${i}]`;
      if (parseTarget(x.targetType) === null)
        problems.push(`${at}.targetType: ${FLAG_TARGETS.join(" vagy ")}.`);
      if (typeof x.targetId !== "string" || !ID.test(x.targetId))
        problems.push(`${at}.targetId: a tétel azonosítója.`);
      if (typeof x.targetHash !== "string" || !SHA256.test(x.targetHash))
        problems.push(`${at}.targetHash: 64 kisbetűs hexa jegy.`);
      if (typeof x.flagged !== "boolean")
        problems.push(`${at}.flagged: true vagy false.`);
      const key = `${String(x.targetType)}:${String(x.targetId)}`;
      if (seen.has(key))
        problems.push(`${at}: a tétel kétszer szerepel egy futásban.`);
      seen.add(key);
    });
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      source: str("source"),
      runId: str("runId"),
      model: str("model"),
      promptSha256: str("promptSha256"),
      flags: (flags as Record<string, unknown>[]).map((f) => ({
        targetType: f.targetType as FlagTarget,
        targetId: f.targetId as string,
        targetHash: f.targetHash as string,
        flagged: f.flagged as boolean,
      })),
    },
  };
}

export type RejectReason =
  "UNKNOWN_TARGET" | "NOT_PENDING" | "STALE_HASH" | "OTHER_VERDICT_IN_RUN";

export interface FlagWriteResult {
  runId: string;
  written: number;
  /** Already stored for this run with the same verdict: the retry is a no-op. */
  alreadyWritten: number;
  rejected: {
    targetType: FlagTarget;
    targetId: string;
    reason: RejectReason;
  }[];
}

/** An item as it is now: its current input's digest, and whether it waits for a flag. */
export interface CurrentItem {
  hash: string;
  pending: boolean;
}

/**
 * Each requested flag against the item's current input and the run's
 * stored rows: write, skip as already written, or refuse with a reason. Only
 * an item that waits for a flag takes one (a VERIFIED claim or an approved
 * conclusion is past the point the flag is for; barracuda, #1994 review);
 * a retry of a run already stored stays a no-op even if the item moved on.
 */
export function judgeFlags(
  write: FlagWrite,
  current: (t: FlagTarget, id: string) => CurrentItem | null,
  storedInRun: ReadonlyMap<string, boolean>,
): {
  toWrite: FlagWrite["flags"];
  alreadyWritten: number;
  rejected: FlagWriteResult["rejected"];
} {
  const toWrite: FlagWrite["flags"] = [];
  const rejected: FlagWriteResult["rejected"] = [];
  let alreadyWritten = 0;
  for (const f of write.flags) {
    const stored = storedInRun.get(`${f.targetType}:${f.targetId}`);
    const reject = (reason: RejectReason) =>
      rejected.push({ targetType: f.targetType, targetId: f.targetId, reason });
    if (stored !== undefined) {
      if (stored === f.flagged) alreadyWritten++;
      else reject("OTHER_VERDICT_IN_RUN");
      continue;
    }
    const now = current(f.targetType, f.targetId);
    if (now === null) reject("UNKNOWN_TARGET");
    else if (!now.pending) reject("NOT_PENDING");
    else if (now.hash !== f.targetHash) reject("STALE_HASH");
    else toWrite.push(f);
  }
  return { toWrite, alreadyWritten, rejected };
}

/** The latest flag on one item, as the editor's surface shows it. */
export interface FlagView {
  flagged: boolean;
  source: string;
  runId: string;
  model: string;
  createdAt: string;
  /** False: the item changed since the model read it. */
  current: boolean;
}
