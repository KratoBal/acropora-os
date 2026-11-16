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
 * THE FILTER AS MEMBERS OF THE LIST'S ONE `AND` (barracuda on #2386): two conditions, both of which must hold. They are returned as a
 * list, not as an object with its own `AND` key: the list's `where` collects every filter's members in ONE `AND` array, so a second
 * filter that also needs an `AND` can never silently replace this one (two spreads of an `AND` key into one object keep only the last).
 * Both values restrict to live animals; "verified" is a stamped block, "unverified" is everything else (no datasheet row at all, or a row
 * without the stamp).
 */
export function husbandryFilterMembers(
  filter: HusbandryFilterValue | undefined,
): Prisma.ProductWhereInput[] {
  if (!filter) return [];
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
  return [live, stamp];
}

/** What a list row needs to decide its husbandry state: the primary category's chain and the datasheet's husbandry columns. */
export interface HusbandryListRow {
  categories: {
    isPrimary?: boolean;
    category: HusbandryListCategory;
  }[];
  datasheet: Parameters<typeof husbandryFactsOf>[0];
}

/** A category as the list loads it: its own row (with `parentId`) and the parents above it, as far as loaded. */
export interface HusbandryListCategory {
  name: string;
  parentId?: string | null;
  parent?: HusbandryListCategory | null;
}

/**
 * THE ROOT OF A LOADED CHAIN, OR `null` WHEN THE CHAIN IS TOO SHORT TO SHOW IT (barracuda on #2386). The list loads the category and
 * three parents. The topmost loaded node is the root only when it HAS NO PARENT (`parentId` null): on a deeper tree the topmost loaded
 * node is an inner category, and taking its name for the root would read "Halak" in the middle of another tree as a live root. The filter
 * asks for the root with no parent at every depth; the row state asks the same of the chain it has.
 */
function loadedRoot(category: HusbandryListCategory): string | null {
  let node = category;
  for (let depth = 0; depth < 8; depth += 1) {
    if (node.parent) {
      node = node.parent;
      continue;
    }
    return node.parentId === null ? node.name : null;
  }
  return null;
}

/** The row's state, or `null` when the product is not a live animal. */
export function husbandryListState(
  row: HusbandryListRow,
): ProductListHusbandry | null {
  const primary = row.categories.find((item) => item.isPrimary);
  if (!primary) return null;
  const root = loadedRoot(primary.category);
  const kind = root === null ? null : livestockKindFromRootNames([root]);
  if (kind === null) return null;
  const facts = husbandryFactsOf(row.datasheet);
  const verified = row.datasheet?.ellenorizveAt != null;
  return {
    verified,
    missing: missingHusbandryFields(facts, kind, verified).length,
    // only a stored TRUE is a hazard: a "no" and an unknown are not
    hazard: facts.stingOrVenom === true,
  };
}
