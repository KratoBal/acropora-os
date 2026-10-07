import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  hasPermission,
  PERMISSIONS,
  type AuthenticatedUser,
  type QuoteBlockInput,
  type QuoteBlockKindValue,
  type QuoteBlockPatch,
  type QuoteBomItemInput,
  type QuoteBomItemPatch,
  type QuoteItemInput,
  type QuoteItemPatch,
  type QuoteMilestoneInput,
  type QuoteVersionHeaderInput,
} from "@acropora/types";

import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { nextLocalProductSku } from "../products/local-product-sku.js";
import {
  NO_COST,
  snapshotCost,
  type CostSnapshot,
} from "./quote-cost-snapshot.js";
import {
  blockContent,
  dayInput,
  milestonesInput,
  moneyInput,
  quantityInput,
  richTextInput,
  textInput,
  vatInput,
} from "./quote-editor-input.js";

/**
 * THE DRAFT VERSION EDITOR (#1582 P1, plan 5.1 `QuoteVersionEditor`).
 *
 * EVERY CHILD WRITE IS LOCKED THE P0 WAY (P1 decision 6): one transaction,
 * `SELECT ... FOR UPDATE` on the quote, then on the version, and only a DRAFT
 * version is written. Two parallel requests therefore cannot write into a
 * version that is being published meanwhile; a published version answers 409.
 * The lock order is always quote, then version (no deadlock between writers).
 *
 * The responses are not built here: the controller re-reads the quote through
 * the permission-aware mapper (P1 decision 4), so a cost never leaves without
 * `quotes.costs.view`.
 */

type Tx = Prisma.TransactionClient;

const LOCAL_SKU_ATTEMPTS = 3;

/** A quote in these states can still get a new draft version or draft edits. */
const EDITABLE_QUOTE_STATUSES = new Set(["DRAFT", "SENT", "POSTPONED"]);

/** Kinds that may hold customer items. */
const ITEM_KINDS = new Set<QuoteBlockKindValue>(["SECTION", "OPTIONS"]);

const SNIPPET_BLOCK_KIND: Record<string, QuoteBlockKindValue> = {
  INTRO: "TEXT",
  TEXT: "TEXT",
  DELIVERY: "TERMS",
  WARRANTY: "TERMS",
  PAYMENT: "TERMS",
};

async function lockDraft(tx: Tx, quoteId: string, versionId: string) {
  const quote = await tx.$queryRaw<Array<{ status: string }>>(
    Prisma.sql`SELECT "status" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`,
  );
  if (!quote.length) throw new NotFoundException("Az ajánlat nem található.");
  if (!EDITABLE_QUOTE_STATUSES.has(quote[0]!.status))
    throw new ConflictException("Lezárt ajánlat nem szerkeszthető.");
  const version = await tx.$queryRaw<Array<{ status: string }>>(
    Prisma.sql`SELECT "status" FROM "QuoteVersion" WHERE "id" = ${versionId} AND "quoteId" = ${quoteId} FOR UPDATE`,
  );
  if (!version.length)
    throw new NotFoundException("A verzió nem található ennél az ajánlatnál.");
  if (version[0]!.status !== "DRAFT")
    throw new ConflictException(
      "Publikált verzió nem módosítható; új verziót kell nyitni.",
    );
}

/**
 * Renumbers rows to 0..n-1 in the given order, in two passes, because the
 * position columns are unique within their parent: first to negatives, then
 * to the final values.
 */
async function renumber(
  ids: string[],
  update: (id: string, position: number) => Promise<unknown>,
) {
  for (const [i, id] of ids.entries()) await update(id, -(i + 1));
  for (const [i, id] of ids.entries()) await update(id, i);
}

function insertAt<T>(list: T[], value: T, position?: number): T[] {
  const at =
    position === undefined || position < 0 || position > list.length
      ? list.length
      : position;
  return [...list.slice(0, at), value, ...list.slice(at)];
}

function samePermutation(current: string[], wanted: string[]) {
  return (
    current.length === wanted.length &&
    new Set(wanted).size === wanted.length &&
    wanted.every((id) => current.includes(id))
  );
}

/** Cost, supplier and internal note are written only with `quotes.costs.view`. */
function assertCostWrite(user: AuthenticatedUser, input: object) {
  const touches = [
    "unitCost",
    "supplierId",
    "supplierSku",
    "internalNote",
    "refreshCost",
  ].some((key) => (input as Record<string, unknown>)[key] !== undefined);
  if (touches && !hasPermission(user, PERMISSIONS.QUOTES_COSTS_VIEW))
    throw new ForbiddenException(
      "A költség és a beszállító adatai csak költségjoggal írhatók.",
    );
}

function costColumns(snapshot: CostSnapshot) {
  return {
    unitCost: snapshot.unitCost,
    costCurrency: snapshot.costCurrency,
    costOriginal: snapshot.costOriginal,
    exchangeRate: snapshot.exchangeRate,
    costSource: snapshot.costSource,
    costSourceDate: snapshot.costSourceDate,
    sourcePurchaseInvoiceLineId: snapshot.sourcePurchaseInvoiceLineId,
  };
}

async function audit(
  tx: Tx,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, string | number | boolean | null>,
) {
  // never a cost, a price or a text: only what changed and where
  await tx.auditLog.create({
    data: { action, entityType, entityId, userId: actorUserId, metadata },
  });
}

@Injectable()
export class QuoteVersionEditor {
  private readonly database = prisma;

  private write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.database.$transaction(fn);
  }

  // ---- version -----------------------------------------------------------

  /**
   * A NEW DRAFT FROM THE LATEST PUBLISHED VERSION (plan 5.4): a deep copy of
   * blocks, items, BOM lines and milestones. The one-draft index stops a
   * second draft; the copy keeps every cost snapshot as it was.
   */
  async newDraftVersion(quoteId: string, user: AuthenticatedUser) {
    return this.write(async (tx) => {
      const quote = await tx.$queryRaw<Array<{ status: string }>>(
        Prisma.sql`SELECT "status" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`,
      );
      if (!quote.length)
        throw new NotFoundException("Az ajánlat nem található.");
      if (!EDITABLE_QUOTE_STATUSES.has(quote[0]!.status))
        throw new ConflictException(
          "Lezárt ajánlathoz nem nyitható új verzió.",
        );
      const versions = await tx.quoteVersion.findMany({
        where: { quoteId },
        orderBy: { versionNumber: "desc" },
        select: { id: true, status: true, versionNumber: true },
      });
      if (versions.some((v) => v.status === "DRAFT"))
        throw new ConflictException("Már van szerkesztés alatti verzió.");
      const source = versions.find((v) => v.status === "PUBLISHED");
      if (!source)
        throw new ConflictException(
          "Nincs publikált verzió, amiből új nyitható.",
        );
      const full = await tx.quoteVersion.findUniqueOrThrow({
        where: { id: source.id },
        include: {
          blocks: {
            orderBy: { position: "asc" },
            include: { items: { orderBy: { position: "asc" } } },
          },
          bomItems: { orderBy: [{ quoteItemId: "asc" }, { position: "asc" }] },
          milestones: { orderBy: { position: "asc" } },
        },
      });
      const versionNumber = versions[0]!.versionNumber + 1;
      const created = await tx.quoteVersion.create({
        data: {
          quoteId,
          versionNumber,
          validUntil: full.validUntil,
          currency: full.currency,
          priceDisplay: full.priceDisplay,
          customerSnapshot: full.customerSnapshot ?? Prisma.DbNull,
          templateId: full.templateId,
          createdFromVersionId: full.id,
          milestones: {
            create: full.milestones.map((m) => ({
              position: m.position,
              label: m.label,
              percent: m.percent,
            })),
          },
        },
        select: { id: true },
      });
      const itemIds = new Map<string, string>();
      for (const block of full.blocks) {
        const newBlock = await tx.quoteBlock.create({
          data: {
            versionId: created.id,
            position: block.position,
            kind: block.kind,
            title: block.title,
            content: block.content ?? Prisma.DbNull,
            keepWithNext: block.keepWithNext,
            startOnNewPage: block.startOnNewPage,
            sourceSnippetId: block.sourceSnippetId,
          },
          select: { id: true },
        });
        for (const item of block.items) {
          const newItem = await tx.quoteItem.create({
            data: {
              versionId: created.id,
              blockId: newBlock.id,
              position: item.position,
              source: item.source,
              variantId: item.variantId,
              name: item.name,
              description: item.description ?? Prisma.DbNull,
              quantity: item.quantity,
              unit: item.unit,
              unitNetPrice: item.unitNetPrice,
              vatRatePercent: item.vatRatePercent,
              isOptional: item.isOptional,
            },
            select: { id: true },
          });
          itemIds.set(item.id, newItem.id);
        }
      }
      for (const bom of full.bomItems)
        await tx.quoteBomItem.create({
          data: {
            versionId: created.id,
            quoteItemId: itemIds.get(bom.quoteItemId)!,
            position: bom.position,
            kind: bom.kind,
            variantId: bom.variantId,
            customName: bom.customName,
            quantity: bom.quantity,
            unit: bom.unit,
            unitCost: bom.unitCost,
            costCurrency: bom.costCurrency,
            costOriginal: bom.costOriginal,
            exchangeRate: bom.exchangeRate,
            costSource: bom.costSource,
            costSourceDate: bom.costSourceDate,
            sourcePurchaseInvoiceLineId: bom.sourcePurchaseInvoiceLineId,
            supplierId: bom.supplierId,
            supplierSku: bom.supplierSku,
            internalNote: bom.internalNote,
            createdProductVariantId: bom.createdProductVariantId,
          },
        });
      await tx.quoteEvent.create({
        data: {
          quoteId,
          versionId: created.id,
          kind: "VERSION_CREATED",
          actorUserId: user.id,
          payload: {
            versionNumber,
            previousVersionNumber: source.versionNumber,
          },
        },
      });
      await audit(
        tx,
        user.id,
        "quote.version_created",
        "QuoteVersion",
        created.id,
        {
          quoteId,
          versionNumber,
        },
      );
      return created.id;
    });
  }

  async updateVersion(
    quoteId: string,
    versionId: string,
    input: QuoteVersionHeaderInput,
    user: AuthenticatedUser,
  ) {
    const data: Prisma.QuoteVersionUpdateInput = {};
    if (input.validUntil !== undefined)
      data.validUntil = dayInput(input.validUntil, "Érvényesség");
    if (input.priceDisplay !== undefined) {
      if (!["NET", "GROSS", "BOTH"].includes(input.priceDisplay))
        throw new BadRequestException("Érvénytelen árkijelzés.");
      data.priceDisplay = input.priceDisplay;
    }
    if (!Object.keys(data).length)
      throw new BadRequestException("Nincs módosítandó adat.");
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      await tx.quoteVersion.update({ where: { id: versionId }, data });
      await audit(
        tx,
        user.id,
        "quote.version_updated",
        "QuoteVersion",
        versionId,
        {
          fields: Object.keys(data).join(","),
        },
      );
    });
  }

  // ---- blocks ------------------------------------------------------------

  async addBlock(
    quoteId: string,
    versionId: string,
    input: QuoteBlockInput,
    user: AuthenticatedUser,
  ) {
    const content = blockContent(input.kind, input.content);
    const title = textInput(input.title ?? null, "Cím", 200, true);
    return this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const order = (
        await tx.quoteBlock.findMany({
          where: { versionId },
          orderBy: { position: "asc" },
          select: { id: true },
        })
      ).map((b) => b.id);
      const created = await tx.quoteBlock.create({
        data: {
          versionId,
          position: -(order.length + 1000),
          kind: input.kind,
          title,
          content,
          keepWithNext: input.keepWithNext ?? false,
          startOnNewPage: input.startOnNewPage ?? false,
        },
        select: { id: true },
      });
      await renumber(
        insertAt(order, created.id, input.position),
        (id, position) =>
          tx.quoteBlock.update({ where: { id }, data: { position } }),
      );
      await audit(tx, user.id, "quote.block_added", "QuoteBlock", created.id, {
        versionId,
        kind: input.kind,
      });
      return created.id;
    });
  }

  async updateBlock(
    quoteId: string,
    versionId: string,
    blockId: string,
    patch: QuoteBlockPatch,
    user: AuthenticatedUser,
  ) {
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const block = await tx.quoteBlock.findFirst({
        where: { id: blockId, versionId },
        select: { kind: true },
      });
      if (!block) throw new NotFoundException("A blokk nem található.");
      const data: Prisma.QuoteBlockUpdateInput = {};
      if (patch.title !== undefined)
        data.title = textInput(patch.title, "Cím", 200, true);
      if (patch.content !== undefined)
        data.content = blockContent(block.kind, patch.content);
      if (patch.keepWithNext !== undefined)
        data.keepWithNext = !!patch.keepWithNext;
      if (patch.startOnNewPage !== undefined)
        data.startOnNewPage = !!patch.startOnNewPage;
      if (!Object.keys(data).length)
        throw new BadRequestException("Nincs módosítandó adat.");
      await tx.quoteBlock.update({ where: { id: blockId }, data });
      await audit(tx, user.id, "quote.block_updated", "QuoteBlock", blockId, {
        versionId,
        fields: Object.keys(data).join(","),
      });
    });
  }

  /** Deletes the block with its items and their BOM lines (the FKs are Restrict). */
  async deleteBlock(
    quoteId: string,
    versionId: string,
    blockId: string,
    user: AuthenticatedUser,
  ) {
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const block = await tx.quoteBlock.findFirst({
        where: { id: blockId, versionId },
        select: { id: true, items: { select: { id: true } } },
      });
      if (!block) throw new NotFoundException("A blokk nem található.");
      const itemIds = block.items.map((i) => i.id);
      await tx.quoteBomItem.deleteMany({
        where: { quoteItemId: { in: itemIds } },
      });
      await tx.quoteItem.deleteMany({ where: { id: { in: itemIds } } });
      await tx.quoteBlock.delete({ where: { id: blockId } });
      const rest = await tx.quoteBlock.findMany({
        where: { versionId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      await renumber(
        rest.map((b) => b.id),
        (id, position) =>
          tx.quoteBlock.update({ where: { id }, data: { position } }),
      );
      await audit(tx, user.id, "quote.block_deleted", "QuoteBlock", blockId, {
        versionId,
        itemCount: itemIds.length,
      });
    });
  }

  async reorderBlocks(
    quoteId: string,
    versionId: string,
    ids: string[],
    user: AuthenticatedUser,
  ) {
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const current = await tx.quoteBlock.findMany({
        where: { versionId },
        select: { id: true },
      });
      if (
        !samePermutation(
          current.map((b) => b.id),
          ids,
        )
      )
        throw new BadRequestException(
          "A sorrend nem pontosan a verzió blokkjait sorolja.",
        );
      await renumber(ids, (id, position) =>
        tx.quoteBlock.update({ where: { id }, data: { position } }),
      );
      await audit(
        tx,
        user.id,
        "quote.blocks_reordered",
        "QuoteVersion",
        versionId,
        {
          count: ids.length,
        },
      );
    });
  }

  // ---- items -------------------------------------------------------------

  private itemColumns(input: QuoteItemInput) {
    if (!["STANDALONE", "PRODUCT", "BOM"].includes(input.source))
      throw new BadRequestException("Érvénytelen tétel-forrás.");
    const variantId = input.variantId?.trim() || null;
    // the P0 identity CHECK: PRODUCT <=> variant
    if (input.source === "PRODUCT" && !variantId)
      throw new BadRequestException("Termékes tételhez változat kell.");
    if (input.source !== "PRODUCT" && variantId)
      throw new BadRequestException("Csak termékes tételnek lehet változata.");
    return {
      source: input.source,
      variantId,
      name: textInput(input.name, "Megnevezés", 300)!,
      description:
        input.description === undefined || input.description === null
          ? Prisma.DbNull
          : (richTextInput(
              input.description,
            ) as unknown as Prisma.InputJsonValue),
      quantity: quantityInput(input.quantity),
      unit: textInput(input.unit, "Mértékegység", 20)!,
      unitNetPrice: moneyInput(input.unitNetPrice),
      vatRatePercent: vatInput(input.vatRatePercent),
      isOptional: input.isOptional ?? false,
    };
  }

  private async activeVariant(tx: Tx, variantId: string) {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, isActive: true, unit: true },
    });
    if (!variant || !variant.isActive)
      throw new BadRequestException(
        "A termékváltozat nem létezik vagy inaktív.",
      );
    return variant;
  }

  /**
   * A PRODUCT ITEM GETS ITS OWN BOM LINE (P1): the same variant and quantity,
   * with the cost snapshot. Without it the costing would not see the item's
   * cost, and the later project handoff (P6) would not reserve it.
   */
  async addItem(
    quoteId: string,
    versionId: string,
    blockId: string,
    input: QuoteItemInput,
    user: AuthenticatedUser,
  ) {
    const columns = this.itemColumns(input);
    return this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const block = await tx.quoteBlock.findFirst({
        where: { id: blockId, versionId },
        select: {
          kind: true,
          items: { orderBy: { position: "asc" }, select: { id: true } },
        },
      });
      if (!block) throw new NotFoundException("A blokk nem található.");
      if (!ITEM_KINDS.has(block.kind))
        throw new BadRequestException("Ebbe a blokkba nem kerülhet tétel.");
      if (columns.variantId) await this.activeVariant(tx, columns.variantId);
      const created = await tx.quoteItem.create({
        data: {
          versionId,
          blockId,
          position: -(block.items.length + 1000),
          ...columns,
        },
        select: { id: true },
      });
      await renumber(
        insertAt(
          block.items.map((i) => i.id),
          created.id,
          input.position,
        ),
        (id, position) =>
          tx.quoteItem.update({ where: { id }, data: { position } }),
      );
      if (columns.source === "PRODUCT")
        await tx.quoteBomItem.create({
          data: {
            versionId,
            quoteItemId: created.id,
            position: 0,
            kind: "PRODUCT",
            variantId: columns.variantId,
            quantity: columns.quantity,
            unit: columns.unit,
            ...costColumns(await snapshotCost(tx as never, columns.variantId!)),
          },
        });
      await audit(tx, user.id, "quote.item_added", "QuoteItem", created.id, {
        versionId,
        source: columns.source,
      });
      return created.id;
    });
  }

  async updateItem(
    quoteId: string,
    versionId: string,
    itemId: string,
    patch: QuoteItemPatch,
    user: AuthenticatedUser,
  ) {
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const item = await tx.quoteItem.findFirst({
        where: { id: itemId, versionId },
        include: { bomItems: { select: { id: true } } },
      });
      if (!item) throw new NotFoundException("A tétel nem található.");
      const merged = this.itemColumns({
        source: patch.source ?? item.source,
        variantId:
          patch.variantId !== undefined ? patch.variantId : item.variantId,
        name: patch.name ?? item.name,
        description:
          patch.description !== undefined
            ? patch.description
            : item.description,
        quantity: patch.quantity ?? item.quantity.toString(),
        unit: patch.unit ?? item.unit,
        unitNetPrice: patch.unitNetPrice ?? item.unitNetPrice.toString(),
        vatRatePercent: patch.vatRatePercent ?? item.vatRatePercent.toString(),
        isOptional: patch.isOptional ?? item.isOptional,
      });
      if (merged.source === "STANDALONE" && item.bomItems.length)
        throw new ConflictException(
          "Önálló tételnek nincs BOM-ja: előbb töröld a BOM-sorait.",
        );
      if (merged.variantId && merged.variantId !== item.variantId)
        await this.activeVariant(tx, merged.variantId);
      // source and variant in ONE write: the identity CHECK sees them together
      await tx.quoteItem.update({ where: { id: itemId }, data: merged });
      await this.followProductBom(tx, item, merged);
      await audit(tx, user.id, "quote.item_updated", "QuoteItem", itemId, {
        versionId,
        fields: Object.keys(patch).join(","),
      });
    });
  }

  /**
   * THE PRODUCT ITEM'S OWN BOM ROW FOLLOWS THE ITEM (barracuda's #1594 review).
   * A PRODUCT item gets one PRODUCT BOM row on creation (same variant and
   * quantity); without this a quantity change left the cost at the old amount
   * and the margin too high, silently. In the same transaction:
   *
   *   quantity or unit changed   the row gets them
   *   variant changed            the row gets the new variant and a FRESH
   *                              cost snapshot (the old one is the old part's)
   *   became PRODUCT, no BOM     the automatic row is created, as on add
   *
   * When the row is not exactly one (edited by hand, a second PRODUCT row),
   * nothing is guessed: the costing names the item instead.
   */
  private async followProductBom(
    tx: Tx,
    before: {
      id: string;
      versionId: string;
      source: string;
      variantId: string | null;
      bomItems: Array<{ id: string }>;
    },
    after: ReturnType<QuoteVersionEditor["itemColumns"]>,
  ) {
    if (after.source !== "PRODUCT" || !after.variantId) return;
    if (before.source !== "PRODUCT") {
      if (before.bomItems.length) return;
      await tx.quoteBomItem.create({
        data: {
          versionId: before.versionId,
          quoteItemId: before.id,
          position: 0,
          kind: "PRODUCT",
          variantId: after.variantId,
          quantity: after.quantity,
          unit: after.unit,
          ...costColumns(await snapshotCost(tx as never, after.variantId)),
        },
      });
      return;
    }
    const own = await tx.quoteBomItem.findMany({
      where: {
        quoteItemId: before.id,
        kind: "PRODUCT",
        variantId: before.variantId,
      },
      select: { id: true },
    });
    if (own.length !== 1) return;
    const variantChanged = after.variantId !== before.variantId;
    await tx.quoteBomItem.update({
      where: { id: own[0]!.id },
      data: {
        quantity: after.quantity,
        unit: after.unit,
        ...(variantChanged
          ? {
              variantId: after.variantId,
              ...costColumns(await snapshotCost(tx as never, after.variantId)),
            }
          : {}),
      },
    });
  }

  async deleteItem(
    quoteId: string,
    versionId: string,
    itemId: string,
    user: AuthenticatedUser,
  ) {
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const item = await tx.quoteItem.findFirst({
        where: { id: itemId, versionId },
        select: { blockId: true },
      });
      if (!item) throw new NotFoundException("A tétel nem található.");
      await tx.quoteBomItem.deleteMany({ where: { quoteItemId: itemId } });
      await tx.quoteItem.delete({ where: { id: itemId } });
      const rest = await tx.quoteItem.findMany({
        where: { blockId: item.blockId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      await renumber(
        rest.map((i) => i.id),
        (id, position) =>
          tx.quoteItem.update({ where: { id }, data: { position } }),
      );
      await audit(tx, user.id, "quote.item_deleted", "QuoteItem", itemId, {
        versionId,
      });
    });
  }

  async reorderItems(
    quoteId: string,
    versionId: string,
    blockId: string,
    ids: string[],
    user: AuthenticatedUser,
  ) {
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const current = await tx.quoteItem.findMany({
        where: { blockId, versionId },
        select: { id: true },
      });
      if (
        !samePermutation(
          current.map((i) => i.id),
          ids,
        )
      )
        throw new BadRequestException(
          "A sorrend nem pontosan a blokk tételeit sorolja.",
        );
      await renumber(ids, (id, position) =>
        tx.quoteItem.update({ where: { id }, data: { position } }),
      );
      await audit(tx, user.id, "quote.items_reordered", "QuoteBlock", blockId, {
        versionId,
        count: ids.length,
      });
    });
  }

  // ---- BOM ---------------------------------------------------------------

  private bomIdentity(input: {
    kind: string;
    variantId?: string | null;
    customName?: string | null;
  }) {
    if (!["PRODUCT", "CUSTOM", "SERVICE"].includes(input.kind))
      throw new BadRequestException("Érvénytelen BOM-fajta.");
    const variantId = input.variantId?.trim() || null;
    const customName = textInput(
      input.customName ?? null,
      "Megnevezés",
      300,
      true,
    );
    // the P0 identity CHECK, said in words before the database says it
    if (input.kind === "PRODUCT" && (!variantId || customName))
      throw new BadRequestException(
        "Termékes BOM-sor: változat kell, egyedi név nem.",
      );
    if (input.kind !== "PRODUCT" && (variantId || !customName))
      throw new BadRequestException(
        "Egyedi és szolgáltatás BOM-sor: név kell, változat nem.",
      );
    return {
      kind: input.kind as "PRODUCT" | "CUSTOM" | "SERVICE",
      variantId,
      customName,
    };
  }

  private manualCost(unitCost: string | null | undefined): CostSnapshot | null {
    if (unitCost === undefined) return null;
    if (unitCost === null) return NO_COST;
    return {
      ...NO_COST,
      unitCost: moneyInput(unitCost, "Költség"),
      costCurrency: "HUF",
      costSource: "MANUAL",
      costSourceDate: new Date(),
    };
  }

  async addBomItem(
    quoteId: string,
    versionId: string,
    itemId: string,
    input: QuoteBomItemInput,
    user: AuthenticatedUser,
  ) {
    assertCostWrite(user, input);
    const identity = this.bomIdentity(input);
    const quantity = quantityInput(input.quantity);
    const unit = textInput(input.unit, "Mértékegység", 20)!;
    return this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const item = await tx.quoteItem.findFirst({
        where: { id: itemId, versionId },
        select: {
          source: true,
          bomItems: { orderBy: { position: "asc" }, select: { id: true } },
        },
      });
      if (!item) throw new NotFoundException("A tétel nem található.");
      if (item.source === "STANDALONE")
        throw new ConflictException("Önálló tételnek nincs BOM-ja.");
      if (identity.variantId) await this.activeVariant(tx, identity.variantId);
      const cost =
        this.manualCost(input.unitCost) ??
        (identity.variantId
          ? await snapshotCost(tx as never, identity.variantId)
          : NO_COST);
      const created = await tx.quoteBomItem.create({
        data: {
          versionId,
          quoteItemId: itemId,
          position: -(item.bomItems.length + 1000),
          ...identity,
          quantity,
          unit,
          ...costColumns(cost),
          supplierId: input.supplierId?.trim() || cost.supplierId,
          supplierSku: textInput(
            input.supplierSku ?? null,
            "Beszállítói kód",
            100,
            true,
          ),
          internalNote: textInput(
            input.internalNote ?? null,
            "Belső megjegyzés",
            2000,
            true,
          ),
        },
        select: { id: true },
      });
      await renumber(
        insertAt(
          item.bomItems.map((b) => b.id),
          created.id,
          input.position,
        ),
        (id, position) =>
          tx.quoteBomItem.update({ where: { id }, data: { position } }),
      );
      await audit(tx, user.id, "quote.bom_added", "QuoteBomItem", created.id, {
        versionId,
        kind: identity.kind,
      });
      return created.id;
    });
  }

  async updateBomItem(
    quoteId: string,
    versionId: string,
    bomId: string,
    patch: QuoteBomItemPatch,
    user: AuthenticatedUser,
  ) {
    assertCostWrite(user, patch);
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const row = await tx.quoteBomItem.findFirst({
        where: { id: bomId, versionId },
      });
      if (!row) throw new NotFoundException("A BOM-sor nem található.");
      const identity = this.bomIdentity({
        kind: patch.kind ?? row.kind,
        variantId:
          patch.variantId !== undefined ? patch.variantId : row.variantId,
        customName:
          patch.customName !== undefined ? patch.customName : row.customName,
      });
      const data: Prisma.QuoteBomItemUncheckedUpdateInput = { ...identity };
      if (patch.quantity !== undefined)
        data.quantity = quantityInput(patch.quantity);
      if (patch.unit !== undefined)
        data.unit = textInput(patch.unit, "Mértékegység", 20)!;
      const variantChanged = identity.variantId !== row.variantId;
      if (variantChanged && identity.variantId)
        await this.activeVariant(tx, identity.variantId);
      const cost =
        this.manualCost(patch.unitCost) ??
        (identity.variantId && (variantChanged || patch.refreshCost)
          ? await snapshotCost(tx as never, identity.variantId)
          : variantChanged
            ? NO_COST
            : null);
      if (cost) Object.assign(data, costColumns(cost));
      if (patch.supplierId !== undefined)
        data.supplierId = patch.supplierId?.trim() || null;
      if (patch.supplierSku !== undefined)
        data.supplierSku = textInput(
          patch.supplierSku,
          "Beszállítói kód",
          100,
          true,
        );
      if (patch.internalNote !== undefined)
        data.internalNote = textInput(
          patch.internalNote,
          "Belső megjegyzés",
          2000,
          true,
        );
      // kind, variant and name in ONE write: the identity CHECK sees them together
      await tx.quoteBomItem.update({ where: { id: bomId }, data });
      await audit(tx, user.id, "quote.bom_updated", "QuoteBomItem", bomId, {
        versionId,
        fields: Object.keys(patch).join(","),
      });
    });
  }

  async deleteBomItem(
    quoteId: string,
    versionId: string,
    bomId: string,
    user: AuthenticatedUser,
  ) {
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const row = await tx.quoteBomItem.findFirst({
        where: { id: bomId, versionId },
        select: { quoteItemId: true },
      });
      if (!row) throw new NotFoundException("A BOM-sor nem található.");
      await tx.quoteBomItem.delete({ where: { id: bomId } });
      const rest = await tx.quoteBomItem.findMany({
        where: { quoteItemId: row.quoteItemId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      await renumber(
        rest.map((b) => b.id),
        (id, position) =>
          tx.quoteBomItem.update({ where: { id }, data: { position } }),
      );
      await audit(tx, user.id, "quote.bom_deleted", "QuoteBomItem", bomId, {
        versionId,
      });
    });
  }

  /**
   * "LOCAL PRODUCT FROM A CUSTOM LINE" (plan P1, decision 2): an OS-owned
   * product with one variant, named after the line, kept out of the webshop.
   * The line switches to PRODUCT in the SAME write (`variantId` set,
   * `customName` cleared), and `createdProductVariantId` remembers where the
   * product came from. The cost snapshot is kept: the new product has no
   * purchase yet.
   */
  /**
   * A local SKU taken between `nextval` and the insert (a hand-made product
   * with the same code) is retried with the next number, as the purchase
   * invoice path does; anything else is not retried.
   */
  async createProductFromBomItem(bomId: string, user: AuthenticatedUser) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.createProductOnce(bomId, user);
      } catch (error) {
        if (
          attempt < LOCAL_SKU_ATTEMPTS &&
          isPrismaUniqueConstraintViolation(error, "sku")
        )
          continue;
        throw error;
      }
    }
  }

  private async createProductOnce(bomId: string, user: AuthenticatedUser) {
    return this.write(async (tx) => {
      const owner = await tx.quoteBomItem.findUnique({
        where: { id: bomId },
        select: { versionId: true, version: { select: { quoteId: true } } },
      });
      if (!owner) throw new NotFoundException("A BOM-sor nem található.");
      await lockDraft(tx, owner.version.quoteId, owner.versionId);
      // read the row again UNDER the lock: a parallel edit may have changed it
      const row = await tx.quoteBomItem.findUnique({
        where: { id: bomId },
        select: {
          kind: true,
          customName: true,
          unit: true,
          versionId: true,
          version: { select: { quoteId: true } },
        },
      });
      if (!row || row.versionId !== owner.versionId)
        throw new NotFoundException("A BOM-sor nem található.");
      if (row.kind !== "CUSTOM" || !row.customName)
        throw new ConflictException(
          "Csak egyedi BOM-sorból hozható létre termék.",
        );
      const sku = await nextLocalProductSku(tx);
      const product = await tx.product.create({
        data: {
          name: row.customName,
          type: "PHYSICAL",
          origin: "LOCAL",
          catalogAuthority: "ACROPORA",
          webshopExcluded: true,
          createdById: user.id,
          variants: { create: { sku, unit: row.unit } },
        },
        select: { id: true, variants: { select: { id: true } } },
      });
      const variantId = product.variants[0]!.id;
      await tx.quoteBomItem.update({
        where: { id: bomId },
        data: {
          kind: "PRODUCT",
          variantId,
          customName: null,
          createdProductVariantId: variantId,
        },
      });
      await audit(
        tx,
        user.id,
        "quote.bom_product_created",
        "QuoteBomItem",
        bomId,
        {
          versionId: row.versionId,
          productId: product.id,
          sku,
        },
      );
      return {
        quoteId: row.version.quoteId,
        productId: product.id,
        variantId,
        sku,
      };
    });
  }

  // ---- milestones and snippets ---------------------------------------------

  async setMilestones(
    quoteId: string,
    versionId: string,
    list: QuoteMilestoneInput[],
    user: AuthenticatedUser,
  ) {
    const rows = milestonesInput(list);
    await this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      await this.replaceMilestones(tx, versionId, rows);
      await audit(
        tx,
        user.id,
        "quote.milestones_set",
        "QuoteVersion",
        versionId,
        {
          count: rows.length,
        },
      );
    });
  }

  private async replaceMilestones(
    tx: Tx,
    versionId: string,
    rows: Array<{ label: string; percent: Prisma.Decimal }>,
  ) {
    await tx.quotePaymentMilestone.deleteMany({ where: { versionId } });
    if (rows.length)
      await tx.quotePaymentMilestone.createMany({
        data: rows.map((r, position) => ({ versionId, position, ...r })),
      });
  }

  /**
   * SNIPPET INSERT (plan 5.4): a deep COPY of the snippet's text into a new
   * block; `sourceSnippetId` only marks the origin. A PAYMENT snippet also
   * replaces the version's milestones, so the percentages live in one place.
   * An archived snippet cannot be inserted.
   */
  async insertSnippet(
    quoteId: string,
    versionId: string,
    snippetId: string,
    position: number | undefined,
    user: AuthenticatedUser,
  ) {
    return this.write(async (tx) => {
      await lockDraft(tx, quoteId, versionId);
      const snippet = await tx.quoteSnippet.findUnique({
        where: { id: snippetId },
      });
      if (!snippet)
        throw new NotFoundException("A szövegrészlet nem található.");
      if (snippet.archivedAt)
        throw new ConflictException("Archivált szövegrészlet nem szúrható be.");
      const content = richTextInput(snippet.content);
      const milestones =
        snippet.kind === "PAYMENT"
          ? milestonesInput(
              snippet.milestones as unknown as QuoteMilestoneInput[],
            )
          : null;
      const order = (
        await tx.quoteBlock.findMany({
          where: { versionId },
          orderBy: { position: "asc" },
          select: { id: true },
        })
      ).map((b) => b.id);
      const created = await tx.quoteBlock.create({
        data: {
          versionId,
          position: -(order.length + 1000),
          kind: SNIPPET_BLOCK_KIND[snippet.kind]!,
          title: snippet.name,
          // a fresh copy: a later snippet edit must not reach this block
          content: JSON.parse(JSON.stringify(content)) as Prisma.InputJsonValue,
          sourceSnippetId: snippet.id,
        },
        select: { id: true },
      });
      await renumber(insertAt(order, created.id, position), (id, p) =>
        tx.quoteBlock.update({ where: { id }, data: { position: p } }),
      );
      if (milestones) await this.replaceMilestones(tx, versionId, milestones);
      await audit(
        tx,
        user.id,
        "quote.snippet_inserted",
        "QuoteBlock",
        created.id,
        {
          versionId,
          snippetId: snippet.id,
          milestones: milestones !== null,
        },
      );
      return created.id;
    });
  }
}
