import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type {
  AuthenticatedUser,
  ExecuteQuoteHandoffInput,
  QuoteHandoffPlanDto,
  QuoteHandoffPreviewInput,
  QuoteHandoffResultDto,
} from "@acropora/types";

import { lockVariantWarehouse } from "../common/inventory-movement-writer.js";
import { retryOnSerializationConflict } from "../common/transaction-retry.util.js";
import { createProjectMaterialRequest } from "../material-requests/material-requests.repository.js";
import { queueShopStock } from "../purchasing/project-reservation.service.js";
import { createProject } from "../purchasing/project.repository.js";
import { handoffSummary, variantLabel } from "./quote-dto.mapper.js";
import {
  computeHandoffPlan,
  type HandoffPlanBomItem,
} from "./quote-handoff-plan.js";
import { HANDOFF_SUMMARY_SELECT } from "./quotes.repository.js";

type Tx = Prisma.TransactionClient;

/**
 * STARTING A PROJECT FROM AN ACCEPTED QUOTE (#1582 P6, plan 5.4 and C12).
 *
 * The preview computes the plan (`quote-handoff-plan.ts`) without locks. The
 * execution runs in ONE Serializable transaction:
 *   1. the quote's row lock; a quote already handed off gets its project
 *      back (the unique `QuoteProjectHandoff.quoteId` is the idempotency);
 *   2. the stock locks of every (product, active warehouse) pair, in sorted
 *      order, the order the stock writers take them;
 *   3. the plan again, under the locks; a different hash is a 409 with the
 *      new plan, so "3 can be held" never slips to 2 unseen;
 *   4. the project (with the quote's customer and `sourceQuoteId`), a hold
 *      per (BOM line, stock row) and the stock rows' `reserved`, one UNAS
 *      outbox row per touched (product, warehouse) pair, the project's
 *      material request for the shortage, the handoff row, the quote event,
 *      the domain event and the audit row.
 * Anything failing in step 4 rolls all of it back.
 *
 * Only the ACCEPTED version is handed off, never a draft: a hold or a
 * shortage line points at its BOM line with a RESTRICT key, so a draft's
 * editor could not delete that line any more (barracuda's note, 28246).
 *
 * A second concurrent request waits on the quote's row lock, which the first
 * one takes by touching the row. When the first commits, the second fails
 * with a serialization conflict, and its retry (`retryOnSerializationConflict`)
 * finds the handoff and answers it (barracuda's P6 point).
 */
@Injectable()
export class QuoteHandoffService {
  private readonly database = prisma;

  async preview(
    quoteId: string,
    input: QuoteHandoffPreviewInput,
  ): Promise<QuoteHandoffPlanDto> {
    const excluded = warehouseIds(input.excludedWarehouseIds);
    return this.database.$transaction(async (tx) => {
      const subject = await loadSubject(tx, quoteId);
      if (subject.handedOff)
        throw new ConflictException(
          "Ebből az ajánlatból a projekt már elindult.",
        );
      return planFor(tx, subject, excluded);
    });
  }

  async execute(
    quoteId: string,
    input: ExecuteQuoteHandoffInput,
    user: AuthenticatedUser,
  ): Promise<QuoteHandoffResultDto> {
    if (
      typeof input.planHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(input.planHash)
    )
      throw new BadRequestException("Hiányzik az előnézet lenyomata.");
    const excluded = warehouseIds(input.excludedWarehouseIds);
    try {
      return await retryOnSerializationConflict(() =>
        this.database.$transaction(
          (tx) => run(tx, quoteId, input.planHash, excluded, user),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (error) {
      // the database's own guard (one project per quote) caught a race the
      // lock did not: the project exists, so answer it
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.database.quoteProjectHandoff.findUnique({
          where: { quoteId },
          select: HANDOFF_SUMMARY_SELECT,
        });
        if (existing) return { ...handoffSummary(existing), replayed: true };
      }
      throw error;
    }
  }
}

async function run(
  tx: Tx,
  quoteId: string,
  expectedHash: string,
  excluded: string[],
  user: AuthenticatedUser,
): Promise<QuoteHandoffResultDto> {
  const existing = await tx.quoteProjectHandoff.findUnique({
    where: { quoteId },
    select: HANDOFF_SUMMARY_SELECT,
  });
  if (existing) return { ...handoffSummary(existing), replayed: true };
  // THE QUOTE'S ROW LOCK, TAKEN BY A WRITE, NOT BY A RAW `FOR UPDATE`.
  // Measured in CI on a5da426d: with a raw lock, the second of two
  // concurrent requests got a 500 (the data stayed right). The reading, from
  // Prisma's codes, not measured apart: Postgres refuses the second with
  // 40001 when the first commits; through a raw query Prisma calls that
  // P2010, which the retry does not know, and through a model write P2034,
  // which it retries, and the retry finds the handoff above.
  const touched = await tx.quote.updateMany({
    where: { id: quoteId },
    data: { updatedAt: new Date() },
  });
  if (!touched.count) throw new NotFoundException("Az ajánlat nem található.");

  const subject = await loadSubject(tx, quoteId);
  const pairs = await lockPairs(tx, subject.productVariantIds);
  const plan = await planFor(tx, subject, excluded);
  if (plan.planHash !== expectedHash)
    throw new ConflictException({
      message:
        "A készlet az előnézet óta változott. Nézd át az új tervet, és indítsd újra.",
      plan,
    });

  const project = await createProject(
    tx,
    {
      name: subject.title,
      customerId: subject.customerId,
      sourceQuoteId: quoteId,
    },
    user.id,
  );

  const now = new Date();
  const after = new Map<
    string,
    { onHand: Prisma.Decimal; reserved: Prisma.Decimal }
  >();
  for (const r of plan.reservations) {
    const quantity = new Prisma.Decimal(r.quantity);
    const reservation = await tx.projectInventoryReservation.create({
      data: {
        projectId: project.id,
        quoteBomItemId: r.quoteBomItemId,
        origin: "QUOTE_HANDOFF",
        stockItemId: r.stockItemId,
        variantId: r.variantId,
        warehouseId: r.warehouseId,
        quantity,
        createdById: user.id,
      },
      select: { id: true },
    });
    const stock = await tx.stockItem.update({
      where: { id: r.stockItemId },
      data: { reserved: { increment: quantity } },
      select: { onHand: true, reserved: true },
    });
    after.set(`${r.variantId}:${r.warehouseId}`, stock);
    await tx.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType: "project_inventory.reserved",
        aggregateType: "ProjectInventoryReservation",
        aggregateId: reservation.id,
        actorUserId: user.id,
        payload: {
          projectId: project.id,
          quoteId,
          quoteBomItemId: r.quoteBomItemId,
          variantId: r.variantId,
          warehouseId: r.warehouseId,
          quantity: r.quantity,
          reason: "QUOTE_HANDOFF",
        },
        occurredAt: now,
        schemaVersion: 1,
      },
    });
  }

  // one outbox row per touched pair, not per hold (plan 5.4)
  for (const pair of pairs) {
    const stock = after.get(`${pair.variantId}:${pair.warehouseId}`);
    if (!stock) continue;
    const variant = subject.variants.get(pair.variantId)!;
    await queueShopStock(tx, {
      variantId: pair.variantId,
      warehouseId: pair.warehouseId,
      sku: variant.sku,
      catalogAuthority: variant.catalogAuthority,
      stock,
      idempotencyKey: `PROJECT_RESERVATION_HANDOFF:${project.id}:${pair.variantId}:${pair.warehouseId}`,
      sourceRecordId: project.id,
    });
  }

  const shortages = plan.lines.filter(
    (l) =>
      l.kind !== "SERVICE" && new Prisma.Decimal(l.shortage).greaterThan(0),
  );
  const request = shortages.length
    ? await createProjectMaterialRequest(tx, {
        projectId: project.id,
        requestedById: user.id,
        note: `A(z) ${subject.quoteNumber} ajánlatból indított projekt hiánya.`,
        items: shortages.map((l) => ({
          name: l.name,
          quantity: l.shortage,
          unit: l.unit,
          variantId: l.variantId,
          quoteBomItemId: l.quoteBomItemId,
        })),
      })
    : null;

  const handoff = await tx.quoteProjectHandoff.create({
    data: {
      quoteId,
      quoteVersionId: subject.versionId,
      acceptanceId: subject.acceptanceId,
      projectId: project.id,
      planHash: plan.planHash,
      plan: {
        lines: plan.lines,
        reservations: plan.reservations,
        excludedWarehouseIds: excluded,
        materialRequestId: request?.id ?? null,
      } as unknown as Prisma.InputJsonValue,
      executedById: user.id,
    },
    select: HANDOFF_SUMMARY_SELECT,
  });
  await tx.quoteEvent.create({
    data: {
      quoteId,
      kind: "HANDOFF_EXECUTED",
      actorUserId: user.id,
      payload: {
        projectNumber: project.projectNumber,
        reservations: plan.reservations.length,
        shortageLines: shortages.length,
      },
    },
  });
  await tx.domainEvent.create({
    data: {
      id: randomUUID(),
      eventType: "quote.handoff.executed",
      aggregateType: "Quote",
      aggregateId: quoteId,
      actorUserId: user.id,
      payload: {
        projectId: project.id,
        versionId: subject.versionId,
        materialRequestId: request?.id ?? null,
      },
      occurredAt: now,
      schemaVersion: 1,
    },
  });
  await tx.auditLog.create({
    data: {
      action: "quote.handoff_executed",
      entityType: "Quote",
      entityId: quoteId,
      userId: user.id,
      metadata: {
        projectId: project.id,
        planHash: plan.planHash,
        materialRequestId: request?.id ?? null,
      },
    },
  });
  return { ...handoffSummary(handoff), replayed: false };
}

interface Subject {
  quoteId: string;
  quoteNumber: string;
  title: string;
  customerId: string | null;
  versionId: string;
  acceptanceId: string;
  handedOff: boolean;
  bomItems: HandoffPlanBomItem[];
  productVariantIds: string[];
  variants: Map<string, { sku: string; catalogAuthority: string | null }>;
}

/** The accepted version's accepted items and their BOM lines. */
async function loadSubject(tx: Tx, quoteId: string): Promise<Subject> {
  const quote = await tx.quote.findUnique({
    where: { id: quoteId },
    select: {
      quoteNumber: true,
      title: true,
      status: true,
      customerId: true,
      acceptedVersionId: true,
      handoff: { select: { id: true } },
    },
  });
  if (!quote) throw new NotFoundException("Az ajánlat nem található.");
  const notAccepted = () =>
    new ConflictException("Projekt csak elfogadott ajánlatból indítható.");
  if (quote.status !== "ACCEPTED" || !quote.acceptedVersionId)
    throw notAccepted();
  const versionId = quote.acceptedVersionId;
  const [acceptance, version] = await Promise.all([
    tx.quoteAcceptance.findFirst({
      where: { quoteId, quoteVersionId: versionId, revokedAt: null },
      select: { id: true, selectedOptionalItemIds: true },
    }),
    tx.quoteVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { status: true },
    }),
  ]);
  if (!acceptance) throw notAccepted();
  if (version.status === "DRAFT") throw notAccepted();

  const selected = new Set(acceptance.selectedOptionalItemIds);
  const items = await tx.quoteItem.findMany({
    where: { versionId },
    select: {
      id: true,
      position: true,
      isOptional: true,
      block: { select: { position: true } },
      bomItems: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          kind: true,
          variantId: true,
          customName: true,
          quantity: true,
          unit: true,
          variant: {
            select: {
              sku: true,
              name: true,
              product: { select: { name: true, catalogAuthority: true } },
            },
          },
        },
      },
    },
  });
  items.sort(
    (a, b) => a.block.position - b.block.position || a.position - b.position,
  );
  const bomItems: HandoffPlanBomItem[] = [];
  const variants = new Map<
    string,
    { sku: string; catalogAuthority: string | null }
  >();
  for (const item of items) {
    if (item.isOptional && !selected.has(item.id)) continue;
    for (const bom of item.bomItems) {
      if (bom.variantId && bom.variant)
        variants.set(bom.variantId, {
          sku: bom.variant.sku,
          catalogAuthority: bom.variant.product.catalogAuthority,
        });
      bomItems.push({
        id: bom.id,
        kind: bom.kind,
        variantId: bom.variantId,
        name:
          variantLabel(bom.variant) ??
          bom.customName ??
          (bom.kind === "SERVICE" ? "Szolgáltatás" : "Egyedi tétel"),
        quantity: bom.quantity,
        unit: bom.unit,
      });
    }
  }
  return {
    quoteId,
    quoteNumber: quote.quoteNumber,
    title: quote.title,
    customerId: quote.customerId,
    versionId,
    acceptanceId: acceptance.id,
    handedOff: quote.handoff !== null,
    bomItems,
    productVariantIds: [
      ...new Set(
        bomItems
          .filter((b) => b.kind === "PRODUCT" && b.variantId)
          .map((b) => b.variantId!),
      ),
    ].sort(),
    variants,
  };
}

/**
 * Every (product, active warehouse) pair, locked in the stock writers' order.
 * All active warehouses, not only those with a stock row today: a row
 * created meanwhile would otherwise join the plan without its lock.
 */
async function lockPairs(tx: Tx, variantIds: string[]) {
  if (!variantIds.length) return [];
  const warehouses = await tx.warehouse.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const pairs = variantIds
    .flatMap((variantId) =>
      warehouses.map((w) => ({ variantId, warehouseId: w.id })),
    )
    .sort(
      (a, b) =>
        a.variantId.localeCompare(b.variantId) ||
        a.warehouseId.localeCompare(b.warehouseId),
    );
  for (const pair of pairs)
    await lockVariantWarehouse(tx, pair.variantId, pair.warehouseId);
  return pairs;
}

async function planFor(
  tx: Tx,
  subject: Subject,
  excluded: string[],
): Promise<QuoteHandoffPlanDto> {
  const [rows, extensions] = subject.productVariantIds.length
    ? await Promise.all([
        // the row the stock writers keep (no location, no lot)
        tx.stockItem.findMany({
          where: {
            variantId: { in: subject.productVariantIds },
            locationId: null,
            lotId: null,
            warehouse: { isActive: true },
          },
          select: {
            id: true,
            variantId: true,
            warehouseId: true,
            onHand: true,
            reserved: true,
            warehouse: { select: { code: true, name: true } },
          },
        }),
        tx.productExtension.findMany({
          where: { variantId: { in: subject.productVariantIds } },
          select: { variantId: true, defaultWarehouseId: true },
        }),
      ])
    : [[], []];
  return computeHandoffPlan({
    quoteId: subject.quoteId,
    versionId: subject.versionId,
    acceptanceId: subject.acceptanceId,
    projectName: subject.title,
    bomItems: subject.bomItems,
    stockRows: rows.map((r) => ({
      stockItemId: r.id,
      variantId: r.variantId,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouse.code,
      warehouseName: r.warehouse.name,
      onHand: r.onHand,
      reserved: r.reserved,
    })),
    defaultWarehouse: new Map(
      extensions.map((e) => [e.variantId, e.defaultWarehouseId]),
    ),
    excludedWarehouseIds: excluded,
  });
}

function warehouseIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some((v) => typeof v !== "string" || !v)
  )
    throw new BadRequestException("Érvénytelen raktárlista.");
  return [...new Set(value as string[])].sort();
}
