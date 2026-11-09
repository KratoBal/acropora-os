import type { PrismaClient } from "@acropora/database";

import type { PaymentMarkSource } from "../../integrations/szamlazz/outgoing-payment-marks.js";
import type { PaidMarkAttentionItem } from "./paid-marks-auto.js";

/**
 * „KÉZZEL RENDEZVE” (6fd8c574; Balázs, Eldöntendő szál, 2026-11-05 16:07 UTC; acrobot 43661, 43677). A napi jelölés
 * egy figyelmet kérő sora, amit egy ember lezár, mert a dolgot máshol, kézzel elintézte: a cmfx-ben kiállított számla,
 * amit a Számlázz.hu nem ismer (a futás NOT_FOUND-ot vagy a banki ágon UNRESOLVED-et mond rá), és a kifizetettet a
 * cmfx-ben jelölték. Lezárva a sor nem kér figyelmet minden reggel; a lap a „kézzel rendezve” részben mutatja, ki és
 * mikor zárta le, és onnan visszavonható.
 *
 * CSAK A MI LISTÁNKAT ZÁRJA: a Számlázz.hu-ba és a cmfx-be nem ír semmit.
 *
 * MIT LEHET LEZÁRNI: csak a NOT_FOUND és az UNRESOLVED sort, és csak akkor, ha a forrás legutóbbi futásában ott áll. A
 * többi ok (eltérő összeg, bizonytalan írás, visszatérítés) pénzről szól, és nem egy gombnyomás dönti el.
 *
 * A KULCS TARTÓS: a tétel `key`-e (banki átutalásnál a jóváírás, mert a hivatkozás csak a napja), egyébként a
 * hivatkozás (számlaszám). Ugyanaz a kulcs és ok a következő futásban is lezárt marad.
 *
 * NAPLÓ: a lezárás és a visszavonás AuditLog-sort ír ugyanabban a tranzakcióban (ki, mikor, melyik tétel). Ugyanazt az
 * állapotot újra kérni nem ír semmit.
 */
export const CLOSABLE_REASONS: ReadonlySet<string> = new Set([
  "NOT_FOUND",
  "UNRESOLVED",
]);

export const attentionKey = (item: PaidMarkAttentionItem) =>
  item.key ?? item.reference;

export interface PaidMarkClosureRow {
  source: string;
  key: string;
  reason: string;
  closedAt: Date;
  closedById: string;
}

export interface SettledAttentionItem extends PaidMarkAttentionItem {
  closedAt: string;
  closedBy: string;
}

/** A run's attention split: what still asks for a person, and what a person closed by hand. */
export function splitAttention(
  source: string,
  attention: readonly PaidMarkAttentionItem[],
  closures: readonly PaidMarkClosureRow[],
  userName: (userId: string) => string,
): { open: PaidMarkAttentionItem[]; settled: SettledAttentionItem[] } {
  const closed = new Map(
    closures
      .filter((c) => c.source === source)
      .map((c) => [`${c.reason}\u0000${c.key}`, c]),
  );
  const open: PaidMarkAttentionItem[] = [];
  const settled: SettledAttentionItem[] = [];
  for (const item of attention) {
    const closure = closed.get(`${item.reason}\u0000${attentionKey(item)}`);
    if (!closure) open.push(item);
    else
      settled.push({
        ...item,
        closedAt: closure.closedAt.toISOString(),
        closedBy: userName(closure.closedById),
      });
  }
  return { open, settled };
}

export class AttentionNotClosableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttentionNotClosableError";
  }
}

export const CLOSURE_AUDIT = {
  closed: "billing.paid-mark-attention.closed",
  reopened: "billing.paid-mark-attention.reopened",
} as const;

export async function setAttentionClosure(
  database: Pick<
    PrismaClient,
    "paidMarkRun" | "paidMarkAttentionClosure" | "auditLog" | "$transaction"
  >,
  input: {
    source: PaymentMarkSource;
    key: string;
    reason: string;
    closed: boolean;
    userId: string;
  },
): Promise<{ changed: boolean }> {
  if (!CLOSABLE_REASONS.has(input.reason))
    throw new AttentionNotClosableError(
      `Csak a ${[...CLOSABLE_REASONS].join(" és ")} sor rendezhető kézzel.`,
    );
  return database.$transaction(async (tx) => {
    const where = {
      source_key_reason: {
        source: input.source,
        key: input.key,
        reason: input.reason,
      },
    };
    const existing = await tx.paidMarkAttentionClosure.findUnique({ where });
    if (Boolean(existing) === input.closed) return { changed: false };
    let reference: string;
    if (input.closed) {
      const run = await tx.paidMarkRun.findFirst({
        where: { source: input.source },
        orderBy: { startedAt: "desc" },
        select: { attention: true },
      });
      const item = (
        (run?.attention ?? []) as unknown as PaidMarkAttentionItem[]
      ).find(
        (candidate) =>
          candidate.reason === input.reason &&
          attentionKey(candidate) === input.key,
      );
      if (!item)
        throw new AttentionNotClosableError(
          "Ez a tétel nincs a forrás legutóbbi futásának figyelmet kérő sorai között.",
        );
      reference = item.reference;
      await tx.paidMarkAttentionClosure.create({
        data: {
          source: input.source,
          key: input.key,
          reason: input.reason,
          reference,
          closedById: input.userId,
        },
      });
    } else {
      reference = existing!.reference;
      await tx.paidMarkAttentionClosure.delete({ where });
    }
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: input.closed ? CLOSURE_AUDIT.closed : CLOSURE_AUDIT.reopened,
        entityType: "PaidMarkAttentionClosure",
        entityId: `${input.source}:${input.reason}:${input.key}`,
        metadata: {
          source: input.source,
          reason: input.reason,
          key: input.key,
          reference,
        },
      },
    });
    return { changed: true };
  });
}
