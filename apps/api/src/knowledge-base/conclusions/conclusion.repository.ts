import { Prisma, prisma } from "@acropora/database";

import type { ConclusionInput } from "./conclusion.js";

type Tx = Prisma.TransactionClient;

export interface ConclusionView {
  id: string;
  text: string;
  reasoning: string;
  status: "DRAFT" | "APPROVED" | "WITHDRAWN";
  revision: number;
  claims: { id: string; status: string }[];
  createdById: string;
  approvedById: string | null;
  approvedAt: string | null;
  withdrawnReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ConclusionNotFound extends Error {
  constructor(id: string) {
    super(`no conclusion ${id}`);
    this.name = "ConclusionNotFound";
  }
}

/** The write cannot happen in this state; the service answers 409 with the message. */
export class ConclusionConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConclusionConflict";
  }
}

const SELECT = {
  id: true,
  text: true,
  reasoning: true,
  status: true,
  revision: true,
  createdById: true,
  approvedById: true,
  approvedAt: true,
  withdrawnReason: true,
  createdAt: true,
  updatedAt: true,
  claims: {
    orderBy: { claimId: "asc" },
    select: { claim: { select: { id: true, status: true } } },
  },
} satisfies Prisma.KnowledgeConclusionSelect;

type Row = Prisma.KnowledgeConclusionGetPayload<{ select: typeof SELECT }>;

function view(c: Row): ConclusionView {
  return {
    id: c.id,
    text: c.text,
    reasoning: c.reasoning,
    status: c.status,
    revision: c.revision,
    claims: c.claims.map((k) => k.claim),
    createdById: c.createdById,
    approvedById: c.approvedById,
    approvedAt: c.approvedAt?.toISOString() ?? null,
    withdrawnReason: c.withdrawnReason,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Every named claim exists and is VERIFIED, read inside the write's transaction. */
async function requireVerified(tx: Tx, claimIds: readonly string[]) {
  const claims = await tx.knowledgeClaim.findMany({
    where: { id: { in: [...claimIds] } },
    select: { id: true, status: true },
  });
  const found = new Map(claims.map((c) => [c.id, c.status]));
  const bad = claimIds.filter((id) => found.get(id) !== "VERIFIED");
  if (bad.length > 0)
    throw new ConclusionConflict(
      `Csak VERIFIED állításra épülhet következtetés; nem az: ${bad.join(", ")}.`,
    );
}

/**
 * OWN CONCLUSIONS (S5). A draft may change (each change one revision up); an
 * approved one never does, a correction is a new conclusion and the old one
 * is withdrawn. The approval reads every claim under it again in the same
 * transaction. Every write leaves an AuditLog row with the before and after.
 */
export class ConclusionRepository {
  async list(): Promise<ConclusionView[]> {
    const rows = await prisma.knowledgeConclusion.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: SELECT,
      take: 500,
    });
    return rows.map(view);
  }

  async detail(id: string): Promise<ConclusionView> {
    const row = await prisma.knowledgeConclusion.findUnique({
      where: { id },
      select: SELECT,
    });
    if (!row) throw new ConclusionNotFound(id);
    return view(row);
  }

  async create(
    input: ConclusionInput,
    userId: string,
  ): Promise<ConclusionView> {
    const id = await prisma.$transaction(async (tx) => {
      await requireVerified(tx, input.claimIds);
      const created = await tx.knowledgeConclusion.create({
        data: {
          text: input.text,
          reasoning: input.reasoning,
          createdById: userId,
          claims: { create: input.claimIds.map((claimId) => ({ claimId })) },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "KNOWLEDGE_CONCLUSION_CREATED",
          entityType: "KnowledgeConclusion",
          entityId: created.id,
          metadata: { after: { status: "DRAFT", ...input } },
        },
      });
      return created.id;
    });
    return this.detail(id);
  }

  async update(
    id: string,
    input: ConclusionInput,
    userId: string,
  ): Promise<ConclusionView> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.knowledgeConclusion.findUnique({
        where: { id },
        select: SELECT,
      });
      if (!before) throw new ConclusionNotFound(id);
      if (before.status !== "DRAFT")
        throw new ConclusionConflict(
          "Csak tervezet módosítható; a jóváhagyott következtetés javítása új következtetés.",
        );
      await requireVerified(tx, input.claimIds);
      const { count } = await tx.knowledgeConclusion.updateMany({
        where: { id, status: "DRAFT", revision: before.revision },
        data: {
          text: input.text,
          reasoning: input.reasoning,
          revision: before.revision + 1,
        },
      });
      if (count !== 1)
        throw new ConclusionConflict(
          "A következtetés közben megváltozott. Töltsd újra.",
        );
      await tx.knowledgeConclusionClaim.deleteMany({
        where: { conclusionId: id },
      });
      await tx.knowledgeConclusionClaim.createMany({
        data: input.claimIds.map((claimId) => ({ conclusionId: id, claimId })),
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "KNOWLEDGE_CONCLUSION_UPDATED",
          entityType: "KnowledgeConclusion",
          entityId: id,
          metadata: {
            before: {
              text: before.text,
              reasoning: before.reasoning,
              claimIds: before.claims.map((k) => k.claim.id),
              revision: before.revision,
            },
            after: { ...input, revision: before.revision + 1 },
          },
        },
      });
    });
    return this.detail(id);
  }

  /**
   * The approval. The creator may approve their own draft: in the pilot the
   * editor and the approver are the same person, Balázs (plan v4, 13., 2.;
   * barracuda on #1919, note 2). A four-eyes rule belongs here when the
   * editor's role is delegated.
   */
  async approve(id: string, userId: string): Promise<ConclusionView> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.knowledgeConclusion.findUnique({
        where: { id },
        select: SELECT,
      });
      if (!before) throw new ConclusionNotFound(id);
      if (before.status !== "DRAFT")
        throw new ConclusionConflict("Csak tervezet hagyható jóvá.");
      await requireVerified(
        tx,
        before.claims.map((k) => k.claim.id),
      );
      const { count } = await tx.knowledgeConclusion.updateMany({
        where: { id, status: "DRAFT", revision: before.revision },
        data: {
          status: "APPROVED",
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      if (count !== 1)
        throw new ConclusionConflict(
          "A következtetés közben megváltozott. Töltsd újra.",
        );
      await tx.auditLog.create({
        data: {
          userId,
          action: "KNOWLEDGE_CONCLUSION_APPROVED",
          entityType: "KnowledgeConclusion",
          entityId: id,
          metadata: {
            before: { status: "DRAFT" },
            after: { status: "APPROVED", revision: before.revision },
          },
        },
      });
    });
    return this.detail(id);
  }

  async withdraw(
    id: string,
    reason: string,
    userId: string,
  ): Promise<ConclusionView> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.knowledgeConclusion.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!before) throw new ConclusionNotFound(id);
      if (before.status === "WITHDRAWN")
        throw new ConclusionConflict("A következtetés már vissza van vonva.");
      const { count } = await tx.knowledgeConclusion.updateMany({
        where: { id, status: before.status },
        data: { status: "WITHDRAWN", withdrawnReason: reason },
      });
      if (count !== 1)
        throw new ConclusionConflict(
          "A következtetés közben megváltozott. Töltsd újra.",
        );
      await tx.auditLog.create({
        data: {
          userId,
          action: "KNOWLEDGE_CONCLUSION_WITHDRAWN",
          entityType: "KnowledgeConclusion",
          entityId: id,
          metadata: {
            before: { status: before.status },
            after: { status: "WITHDRAWN" },
            reason,
          },
        },
      });
    });
    return this.detail(id);
  }
}
