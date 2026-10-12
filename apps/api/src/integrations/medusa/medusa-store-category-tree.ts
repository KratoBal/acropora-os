import {
  categoryRowsFromOurTree,
  type CategoryMapping,
  type CategoryMappingConflict,
} from "./medusa-category-tree.js";

/**
 * THE ACROPORA TREE TO MEDUSA (SEO P0 PR 10b, part B). Pure: state in, plan
 * out. The UNAS tree keeps its own planner (`medusa-category-tree.ts`); this
 * one differs where the plan says so:
 *
 *   handle       = the slug, as stored (ASCII, one segment, unique in our
 *                  table), not derived from the name
 *   name         = the name, no parent suffix: the slug already tells the
 *                  same-named categories apart
 *   description  = the intro ("" when unset: Medusa takes no null here)
 *   metadata     = seo_title and seo_description ("" when unset)
 *
 * Source of the field shapes: @medusajs/medusa 2.20.1,
 * dist/api/admin/product-categories/validators.js, CreateProductCategory and
 * UpdateProductCategory (`description: z.string().optional()`,
 * `metadata: z.record(z.string(), z.unknown()).nullish()`).
 */

/** One row of `StoreCategory`, as the loader reads it. */
export interface StoreCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  seoTitle: string | null;
  metaDescription: string | null;
  intro: string | null;
  isActive: boolean;
}

export const STORE_CATEGORY_METADATA_KEYS = [
  "seo_title",
  "seo_description",
] as const;

export type StoreCategoryMetadata = Record<
  (typeof STORE_CATEGORY_METADATA_KEYS)[number],
  string
>;

/** What one of our categories should look like in Medusa. */
export interface StoreCategoryTarget {
  ourId: string;
  parentOurId: string | null;
  name: string;
  handle: string;
  isActive: boolean;
  description: string;
  metadata: StoreCategoryMetadata;
}

/** A Medusa category as the plan needs it. */
export interface ExistingStoreCategory {
  id: string;
  externalId: string | null;
  handle: string;
  name: string;
  isActive: boolean;
  description: string | null;
  metadata: Record<string, unknown> | null;
}

export interface StoreCategoryUpdate {
  ourId: string;
  medusaId: string;
  /** The fields that differ, for the report: name, handle, is_active, description, metadata. */
  changed: string[];
  patch: {
    name: string;
    handle: string;
    is_active: boolean;
    description: string;
    metadata: StoreCategoryMetadata;
  };
}

/** A handle we need is held by a Medusa category that is not ours. */
export interface StoreCategoryHandleTaken {
  ourId: string;
  handle: string;
  heldBy: string;
}

export interface StoreCategoryImportPlan {
  create: StoreCategoryTarget[];
  skip: string[];
  mapOnly: CategoryMapping[];
  staleMapping: string[];
  conflict: CategoryMappingConflict[];
  handleTaken: StoreCategoryHandleTaken[];
  update: StoreCategoryUpdate[];
}

/**
 * THE WHOLE TREE GOES OUT, INACTIVE ONES TOO, AS INACTIVE. A product may sit
 * in an inactive category; if that category had no Medusa twin, the product's
 * list would be incomplete on every run and its categories would never go out
 * (barracuda, #1675 review). So Medusa mirrors the tree, and `is_active` is the
 * EFFECTIVE state: a category under an inactive ancestor is inactive too, as a
 * shop page under a hidden parent should be.
 */
export function storeCategoryTargets(
  nodes: readonly StoreCategoryNode[],
): StoreCategoryTarget[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const effectivelyActive = (node: StoreCategoryNode): boolean => {
    const seen = new Set<string>();
    let current: StoreCategoryNode | undefined = node;
    while (current) {
      if (!current.isActive) return false;
      if (seen.has(current.id)) return true; // a cycle: the tree walk names it
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  };

  // parent-first order, and the same cycle and orphan checks as the UNAS tree
  const ordered = categoryRowsFromOurTree(
    nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      name: node.name,
    })),
  );
  return ordered.map((row) => {
    const node = byId.get(row.ourId)!;
    return {
      ourId: node.id,
      parentOurId: node.parentId,
      name: node.name,
      handle: node.slug,
      isActive: effectivelyActive(node),
      description: node.intro ?? "",
      metadata: {
        seo_title: node.seoTitle ?? "",
        seo_description: node.metaDescription ?? "",
      },
    };
  });
}

function storedMetadata(
  metadata: Record<string, unknown> | null,
): StoreCategoryMetadata {
  const read = (key: string) => {
    const value = metadata?.[key];
    return typeof value === "string" ? value : "";
  };
  return {
    seo_title: read("seo_title"),
    seo_description: read("seo_description"),
  };
}

/**
 * THE SAME FOUR-WAY SPLIT AS THE UNAS TREE (skip, link only, stale link,
 * conflict, create), plus two things that tree does not need:
 *
 * 1. A TAKEN HANDLE. The stage shop holds 219 imported categories with their
 *    own handles, and Medusa's handle is unique. Creating ours on a taken
 *    handle would fail mid-run; moving ours onto one would fail the same way.
 *    Both are planned as `handleTaken` and left for a person: whose page that
 *    address should be is not a rule this code can make.
 * 2. THE CONTENT FIELDS. The active flag, the description and the two SEO keys
 *    are compared too, and an update carries every field, so one patch shape
 *    covers every case.
 */
export function planStoreCategoryImport(
  targets: readonly StoreCategoryTarget[],
  existing: readonly ExistingStoreCategory[],
  mappings: readonly CategoryMapping[] = [],
): StoreCategoryImportPlan {
  const carrying = new Map<string, ExistingStoreCategory>();
  for (const cat of existing)
    if (cat.externalId) carrying.set(cat.externalId, cat);
  const byId = new Map(existing.map((cat) => [cat.id, cat]));
  const handleHolder = new Map(existing.map((cat) => [cat.handle, cat.id]));
  const ours = new Map(mappings.map((m) => [m.ourId, m.medusaId]));

  const plan: StoreCategoryImportPlan = {
    create: [],
    skip: [],
    mapOnly: [],
    staleMapping: [],
    conflict: [],
    handleTaken: [],
    update: [],
  };

  const takenFrom = (target: StoreCategoryTarget, self: string | null) => {
    const holder = handleHolder.get(target.handle);
    return holder && holder !== self ? holder : null;
  };

  const compare = (target: StoreCategoryTarget, medusaId: string) => {
    const stored = byId.get(medusaId);
    if (!stored) return;
    const metadata = storedMetadata(stored.metadata);
    const changed = [
      stored.name !== target.name ? "name" : null,
      stored.handle !== target.handle ? "handle" : null,
      stored.isActive !== target.isActive ? "is_active" : null,
      (stored.description ?? "") !== target.description ? "description" : null,
      STORE_CATEGORY_METADATA_KEYS.some(
        (key) => metadata[key] !== target.metadata[key],
      )
        ? "metadata"
        : null,
    ].filter((field): field is string => field !== null);
    if (changed.length === 0) return;
    if (changed.includes("handle")) {
      const holder = takenFrom(target, medusaId);
      if (holder) {
        plan.handleTaken.push({
          ourId: target.ourId,
          handle: target.handle,
          heldBy: holder,
        });
        return;
      }
    }
    plan.update.push({
      ourId: target.ourId,
      medusaId,
      changed,
      patch: {
        name: target.name,
        handle: target.handle,
        is_active: target.isActive,
        description: target.description,
        metadata: target.metadata,
      },
    });
  };

  for (const target of targets) {
    const inMedusa = carrying.get(target.ourId)?.id ?? null;
    const ourLink = ours.get(target.ourId) ?? null;

    if (inMedusa && ourLink) {
      if (ourLink === inMedusa) {
        plan.skip.push(target.ourId);
        compare(target, inMedusa);
      } else
        plan.conflict.push({
          ourId: target.ourId,
          mappedMedusaId: ourLink,
          medusaIdCarryingOurId: inMedusa,
        });
      continue;
    }

    if (inMedusa) {
      plan.mapOnly.push({ ourId: target.ourId, medusaId: inMedusa });
      compare(target, inMedusa);
      continue;
    }

    const holder = takenFrom(target, null);
    if (holder) {
      plan.handleTaken.push({
        ourId: target.ourId,
        handle: target.handle,
        heldBy: holder,
      });
      continue;
    }
    if (ourLink) plan.staleMapping.push(target.ourId);
    plan.create.push(target);
  }
  return plan;
}
