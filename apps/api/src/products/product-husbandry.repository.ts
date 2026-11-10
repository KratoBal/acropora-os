import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type {
  ProductHusbandry,
  ProductHusbandryFacts,
  ProductLivestockKind,
} from "@acropora/types";

import {
  husbandryVersionOf,
  missingHusbandryFields,
} from "./product-husbandry.js";
import { livestockKindFromRootNames } from "../integrations/medusa/medusa-livestock.policy.js";
import { categoryPath } from "./product.types.js";

/**
 * THE HUSBANDRY BLOCK'S STORE (V2.2, card d2fc06e7): reads and writes the husbandry facts on the product's datasheet.
 *
 * The write is ONE serializable transaction that reads the stored row, lets the caller DECIDE on it (`decide`), writes, and
 * logs the before and after: a decision made on an earlier read cannot be written over a row someone saved in between. The
 * rules themselves are pure and live in `product-husbandry.ts`; this file only stores.
 */

const husbandryDatasheetSelect = {
  magyarNev: true,
  genus: true,
  species: true,
  careDifficulty: true,
  minLiter: true,
  medenceErettsegHonap: true,
  elhelyezesZona: true,
  reefSafe: true,
  reefSafeIndok: true,
  socialKeeping: true,
  aggression: true,
  korallevo: true,
  gerinctelenevo: true,
  feedingType: true,
  etetesGyakorisag: true,
  eloEleseg: true,
  fenyIgeny: true,
  aramlasIgeny: true,
  meretMax: true,
  meretDimenzio: true,
  szarmazas: true,
  kinekNem: true,
  forrasTipus: true,
  forrasHivatkozas: true,
  ellenorizteUserId: true,
  ellenorizveAt: true,
} as const;

const productSelect = {
  id: true,
  categories: {
    include: {
      category: {
        include: {
          parent: { include: { parent: { include: { parent: true } } } },
        },
      },
    },
  },
  datasheet: { select: husbandryDatasheetSelect },
} as const;

type StoredProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

/** What a decision returns: the refusal's messages, or the columns to write and whether the facts are verified after it. */
export type HusbandryDecision =
  | { refused: string[] }
  /** The facts changed since the caller looked (a verification of unseen content): HTTP 409, nothing is written. */
  | { conflict: string }
  | {
      data: Prisma.ProductDatasheetUncheckedUpdateInput;
      /** The key names the write touches, for the log. */
      changed: string[];
    };

export type HusbandryWriteResult =
  | { kind: "not-found" }
  | { kind: "refused"; errors: string[] }
  | { kind: "conflict"; message: string }
  | { kind: "ok"; husbandry: ProductHusbandry };

const decimalText = (value: Prisma.Decimal | null): string | null =>
  value === null ? null : value.toString();

export function husbandryFactsOf(
  datasheet: StoredProduct["datasheet"],
): ProductHusbandryFacts {
  return {
    magyarNev: datasheet?.magyarNev ?? null,
    genus: datasheet?.genus ?? null,
    species: datasheet?.species ?? null,
    careDifficulty: datasheet?.careDifficulty ?? null,
    minLiter: decimalText(datasheet?.minLiter ?? null),
    medenceErettsegHonap: datasheet?.medenceErettsegHonap ?? null,
    elhelyezesZona: datasheet?.elhelyezesZona ?? null,
    reefSafe: datasheet?.reefSafe ?? null,
    reefSafeIndok: datasheet?.reefSafeIndok ?? null,
    socialKeeping: datasheet?.socialKeeping ?? null,
    aggression: datasheet?.aggression ?? [],
    korallevo: datasheet?.korallevo ?? null,
    gerinctelenevo: datasheet?.gerinctelenevo ?? null,
    feedingType: datasheet?.feedingType ?? [],
    etetesGyakorisag: datasheet?.etetesGyakorisag ?? null,
    eloEleseg: datasheet?.eloEleseg ?? null,
    fenyIgeny: datasheet?.fenyIgeny ?? null,
    aramlasIgeny: datasheet?.aramlasIgeny ?? null,
    meretMax: decimalText(datasheet?.meretMax ?? null),
    meretDimenzio: datasheet?.meretDimenzio ?? null,
    szarmazas: datasheet?.szarmazas ?? null,
    kinekNem: datasheet?.kinekNem ?? null,
    forrasTipus: datasheet?.forrasTipus ?? null,
    forrasHivatkozas: datasheet?.forrasHivatkozas ?? null,
  };
}

function kindOf(product: StoredProduct): ProductLivestockKind | null {
  return livestockKindFromRootNames(
    product.categories.flatMap((item) =>
      categoryPath(item.category).slice(0, 1),
    ),
  );
}

/** The whole answer for a stored product: the facts, the verification, and what is still missing. */
export function toHusbandry(product: StoredProduct): ProductHusbandry {
  const facts = husbandryFactsOf(product.datasheet);
  const kind = kindOf(product);
  const verified = product.datasheet?.ellenorizveAt != null;
  return {
    productId: product.id,
    version: husbandryVersionOf(facts),
    livestockKind: kind,
    facts,
    verification: {
      verified,
      byUserId: product.datasheet?.ellenorizteUserId ?? null,
      at: product.datasheet?.ellenorizveAt?.toISOString() ?? null,
    },
    missing: missingHusbandryFields(facts, kind, verified),
  };
}

const jsonOf = (value: unknown): Prisma.JsonValue =>
  value === undefined
    ? null
    : (JSON.parse(JSON.stringify(value)) as Prisma.JsonValue);

@Injectable()
export class ProductHusbandryRepository {
  async read(productId: string): Promise<ProductHusbandry | null> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: productSelect,
    });
    return product ? toHusbandry(product) : null;
  }

  /**
   * THE WRITE. `decide` gets the stored facts and says what to write (or refuses); it runs inside the transaction. A
   * refusal writes nothing and logs nothing. The log carries the before and after of the facts that changed, and who and
   * when (the audit row and the domain event), as the spec asks ("a módosítás naplózódik: ki, mikor, mi volt").
   */
  async write(
    productId: string,
    actorUserId: string,
    decide: (current: ProductHusbandryFacts) => HusbandryDecision,
  ): Promise<HusbandryWriteResult> {
    return prisma.$transaction(
      async (transaction) => {
        const stored = await transaction.product.findUnique({
          where: { id: productId },
          select: productSelect,
        });
        if (!stored) return { kind: "not-found" } as const;
        const before = husbandryFactsOf(stored.datasheet);
        const decision = decide(before);
        if ("refused" in decision)
          return { kind: "refused", errors: decision.refused } as const;
        if ("conflict" in decision)
          return { kind: "conflict", message: decision.conflict } as const;

        const wasVerifiedAt = stored.datasheet?.ellenorizveAt ?? null;
        const datasheet = await transaction.productDatasheet.upsert({
          where: { productId },
          create: {
            ...(decision.data as Omit<
              Prisma.ProductDatasheetUncheckedCreateInput,
              "productId"
            >),
            productId,
          },
          update: decision.data,
          select: husbandryDatasheetSelect,
        });
        // THE PRODUCT'S `updatedAt` MOVES WITH ITS HUSBANDRY BLOCK (V2.2 S3), as it does with an arrival: the shop's `husbandry`
        // key is projected from the datasheet, and the projection's due signal is the product's own timestamps (the datasheet
        // is not one of them), so a verified (or withdrawn) block on a product nobody else touched would never be picked.
        await transaction.product.update({
          where: { id: productId },
          data: { updatedAt: new Date() },
          select: { id: true },
        });
        const afterStored: StoredProduct = { ...stored, datasheet };
        const after = husbandryFactsOf(datasheet);
        const changedFacts = decision.changed.filter(
          (key) => key in before && key !== "magyarNev",
        ) as (keyof ProductHusbandryFacts)[];
        const metadata = {
          productId,
          before: Object.fromEntries(
            changedFacts.map((key) => [key, jsonOf(before[key])]),
          ),
          after: Object.fromEntries(
            changedFacts.map((key) => [key, jsonOf(after[key])]),
          ),
          verification: {
            before: wasVerifiedAt?.toISOString() ?? null,
            after: datasheet.ellenorizveAt?.toISOString() ?? null,
            byUserId: datasheet.ellenorizteUserId ?? null,
          },
        } satisfies Prisma.JsonObject;
        await transaction.auditLog.create({
          data: {
            userId: actorUserId,
            action: "product_husbandry.updated",
            entityType: "ProductDatasheet",
            entityId: productId,
            metadata,
          },
        });
        await transaction.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: "product.husbandry.updated",
            aggregateType: "Product",
            aggregateId: productId,
            actorUserId,
            payload: metadata,
            occurredAt: new Date(),
          },
        });
        return { kind: "ok", husbandry: toHusbandry(afterStored) } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
