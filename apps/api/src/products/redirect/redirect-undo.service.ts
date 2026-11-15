import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma, PrismaClient } from "@acropora/database";

import { TRANSACTION_OPTIONS } from "./category-redirect-backfill.service.js";
import { lockRedirectWrites } from "./redirect.repository.js";
import { redirectPathLower } from "./redirect-path.js";
import {
  parseBatchChanges,
  planRedirectUndo,
  undoPlanHash,
  type CurrentRule,
  type UndoPlan,
} from "./redirect-undo.js";

export const REDIRECT_UNDO_DB = Symbol("REDIRECT_UNDO_DB");

/** A két betöltő AuditLog-művelete: csak ezeknek a kötegei vonhatók vissza. */
export const UNDOABLE_ACTIONS = [
  "seo.redirects.category-backfill",
  "seo.redirects.product-backfill",
] as const;
export const UNDO_ACTION = "seo.redirects.undo";

type Db = Pick<PrismaClient, "$transaction" | "auditLog" | "urlRedirect">;

const RULE_SELECT = {
  id: true,
  sourcePath: true,
  destinationPath: true,
  destinationPathLower: true,
  isActive: true,
  reason: true,
  entityType: true,
  entityId: true,
  createdById: true,
} as const;

export interface RedirectUndoResult {
  applied: boolean;
  batchId: string;
  planHash: string;
  report: Pick<
    UndoPlan,
    "restores" | "deactivations" | "skipped" | "invariantViolations"
  >;
}

/**
 * AZ ÁTIRÁNYÍTÁS-KÖTEG VISSZAVONÁSA (`POST /seo/redirects/undo`, `seo.redirects.manage`; card f6cb0a51). A kategória- és a
 * termék-betöltő írása a `batchId`-t adja vissza (az AuditLog sora), és abban őrzi a változásait a régi állapottal. A visszavonás
 * ugyanazt a két lépést követi, mint a betöltők: a szárazfutás (`apply` nélkül) semmit nem ír, és a tervet meg a `planHash`-t
 * adja; az írás csak ezzel a `planHash`-sel megy, és ha az adatbázis közben változott, 409.
 *
 * EGY KÖTEG EGYSZER VONHATÓ VISSZA (409, ha már visszavonták), és csak ha rögzítette a változásait (a rögzítés előtti köteg: 422).
 * Elutasítás: a visszavonás utáni állapotban lánc lenne (422), vagy nincs mit visszavonni (422). Az írás ugyanazzal a zárral megy,
 * mint a többi átirányítás-írás, és AuditLogot hagy. A VETÍTÉST a Medusába ez NEM végzi: az külön lépés, mint a betöltés után.
 */
@Injectable()
export class RedirectUndoService {
  constructor(@Inject(REDIRECT_UNDO_DB) private readonly db: Db) {}

  async run(
    input: { batchId: string; apply?: boolean; planHash?: string },
    userId: string,
  ): Promise<RedirectUndoResult> {
    if (!input.apply) {
      const plan = await this.plan(this.db, input.batchId);
      return this.result(false, plan);
    }
    if (!input.planHash)
      throw new BadRequestException(
        "apply needs the planHash of the dry run (send the same batchId)",
      );
    const planHash = input.planHash;
    return this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockRedirectWrites(tx);
      const plan = await this.plan(tx, input.batchId);
      if (undoPlanHash(plan) !== planHash)
        throw new ConflictException(
          "the plan is not the one the dry run returned (the rules changed): run the dry run again",
        );
      if (plan.invariantViolations.length)
        throw new UnprocessableEntityException(
          "the undo would leave a redirect chain: nothing was written",
        );
      if (!plan.restores.length && !plan.deactivations.length)
        throw new UnprocessableEntityException(
          "there is nothing to undo (every rule of the batch was skipped): nothing was written",
        );
      for (const restore of plan.restores)
        await tx.urlRedirect.update({
          where: { id: restore.id },
          data: restore.from as Prisma.UrlRedirectUncheckedUpdateInput,
        });
      for (const off of plan.deactivations)
        await tx.urlRedirect.update({
          where: { id: off.id },
          data: { isActive: false },
        });
      await tx.auditLog.create({
        data: {
          userId,
          action: UNDO_ACTION,
          entityType: "UrlRedirect",
          metadata: {
            batchId: input.batchId,
            restored: plan.restores.length,
            deactivated: plan.deactivations.length,
            skipped: plan.skipped.length,
            planHash,
          } as Prisma.InputJsonValue,
        },
      });
      return this.result(true, plan);
    }, TRANSACTION_OPTIONS);
  }

  private result(applied: boolean, plan: UndoPlan): RedirectUndoResult {
    return {
      applied,
      batchId: plan.batchId,
      planHash: undoPlanHash(plan),
      report: {
        restores: plan.restores,
        deactivations: plan.deactivations,
        skipped: plan.skipped,
        invariantViolations: plan.invariantViolations,
      },
    };
  }

  /** A köteg betöltése, az ellenőrzések és a terv; a szárazfutás és az írás ugyanezt futtatja. */
  private async plan(
    db: Pick<
      PrismaClient | Prisma.TransactionClient,
      "auditLog" | "urlRedirect"
    >,
    batchId: string,
  ): Promise<UndoPlan> {
    const batch = await db.auditLog.findUnique({
      where: { id: batchId },
      select: { id: true, action: true, metadata: true },
    });
    if (!batch) throw new NotFoundException("no such batch");
    if (!(UNDOABLE_ACTIONS as readonly string[]).includes(batch.action))
      throw new BadRequestException(
        `this is not a redirect backfill batch (${batch.action})`,
      );
    const changes = parseBatchChanges(batch.metadata);
    if (!changes)
      throw new UnprocessableEntityException(
        "this batch has no recorded changes (it ran before the undo record existed): it cannot be undone",
      );
    const already = await db.auditLog.findFirst({
      where: {
        action: UNDO_ACTION,
        metadata: { path: ["batchId"], equals: batchId },
      },
      select: { id: true },
    });
    if (already) throw new ConflictException("this batch was already undone");
    const sourceLowers = changes.created.map((c) =>
      redirectPathLower(c.source),
    );
    const [rows, active] = await Promise.all([
      db.urlRedirect.findMany({
        where: {
          OR: [
            { id: { in: changes.updated.map((u) => u.id) } },
            { sourcePathLower: { in: sourceLowers } },
          ],
        },
        select: RULE_SELECT,
      }),
      db.urlRedirect.findMany({
        where: { isActive: true },
        select: {
          id: true,
          sourcePath: true,
          destinationPath: true,
          isActive: true,
        },
      }),
    ]);
    const byId = new Map<string, CurrentRule>(rows.map((r) => [r.id, r]));
    const bySource = new Map<string, CurrentRule>(
      rows.map((r) => [redirectPathLower(r.sourcePath), r]),
    );
    return planRedirectUndo(batchId, changes, byId, bySource, active);
  }
}
