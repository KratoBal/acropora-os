import type { Prisma } from "@acropora/database";
import type {
  HusbandryFilterValue,
  ProductListHusbandry,
} from "@acropora/types";

import {
  LIVE_ANIMAL_ROOT_NAMES,
  livestockKindFromRootNames,
} from "../integrations/medusa/medusa-livestock.policy.js";
import { missingHusbandryFields } from "./product-husbandry.js";
import { husbandryFactsOf } from "./product-husbandry.repository.js";
import { categoryPath } from "./product.types.js";

/**
 * THE HUSBANDRY STATE IN THE PRODUCT LIST (V2.2 S6, card d2fc06e7): which live animals still have no verified husbandry block and
 * how much is missing, so whoever fills in the data and whoever verifies it can work the list instead of opening the products one by
 * one. Pure functions (the where-clause and the row's state), no database.
 *
 * LIVE ANIMAL = the primary category sits under one of the three live-animal roots (Korallok, Halak, Gerinctelenek), the same
 * roots the shop's pickup rule and the detail screen's `livestockKind` use. The list reads the PRIMARY category only (one row per
 * product, as the list's other columns do); a product under several roots is exact on the detail screen, and may read differently here.
 */

/** The ancestor chain the list loads: the category and up to three parents, as the detail screen does. */
const MAX_DEPTH = 4;

/**
 * A category that is, or sits under, a live-animal ROOT: the root is the ancestor with no parent whose name is one of the three.
 * Built for the depth the list loads (the category itself, then up to three parents).
 */
export function underLiveAnimalRoot(): Prisma.CategoryWhereInput {
  const roots = [...LIVE_ANIMAL_ROOT_NAMES];
  const level = (depth: number): Prisma.CategoryWhereInput =>
    depth === 0
      ? { name: { in: roots }, parentId: null }
      : { parent: { is: level(depth - 1) } };
  return {
    OR: Array.from({ length: MAX_DEPTH }, (_, depth) => level(depth)),
  };
}

/**
 * THE WHERE-CLAUSE OF THE FILTER. Both values restrict to live animals; "verified" is a stamped block, "unverified" is everything
 * else (no datasheet row, or a row without the stamp). Returned as an `AND` member so it never collides with the search's `OR`.
 */
export function husbandryFilterWhere(
  filter: HusbandryFilterValue | undefined,
): Prisma.ProductWhereInput {
  if (!filter) return {};
  const live: Prisma.ProductWhereInput = {
    categories: {
      some: { isPrimary: true, category: underLiveAnimalRoot() },
    },
  };
  const stamp: Prisma.ProductWhereInput =
    filter === "verified"
      ? { datasheet: { is: { ellenorizveAt: { not: null } } } }
      : {
          OR: [
            { datasheet: { is: null } },
            { datasheet: { is: { ellenorizveAt: null } } },
          ],
        };
  return { AND: [live, stamp] };
}

/** What a list row needs to decide its husbandry state: the primary category's chain and the datasheet's husbandry columns. */
export interface HusbandryListRow {
  categories: {
    isPrimary?: boolean;
    category: { name: string; parent?: unknown };
  }[];
  datasheet: Parameters<typeof husbandryFactsOf>[0];
}

/** The row's state, or `null` when the product is not a live animal. */
export function husbandryListState(
  row: HusbandryListRow,
): ProductListHusbandry | null {
  const primary = row.categories.find((item) => item.isPrimary);
  if (!primary) return null;
  const kind = livestockKindFromRootNames(
    categoryPath(primary.category as Parameters<typeof categoryPath>[0]).slice(
      0,
      1,
    ),
  );
  if (kind === null) return null;
  const facts = husbandryFactsOf(row.datasheet);
  const verified = row.datasheet?.ellenorizveAt != null;
  return {
    verified,
    missing: missingHusbandryFields(facts, kind, verified).length,
  };
}
