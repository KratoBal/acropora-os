import { Injectable } from "@nestjs/common";

import type {
  MedusaAdminClient,
  MedusaCategoryRow,
} from "./medusa-admin.client.js";
import { MedusaCategoryImportRefusedError } from "./medusa-category-import.service.js";
import type { ImportVerification } from "./medusa-category-import.service.js";
import {
  MedusaStoreCategoryLinkRepository,
  type MedusaCategoryLink,
} from "./medusa-category-link.repository.js";
import type { CategoryMapping } from "./medusa-category-tree.js";
import {
  planStoreCategoryImport,
  storeCategoryTargets,
  type ExistingStoreCategory,
  type StoreCategoryImportPlan,
  type StoreCategoryNode,
  type StoreCategoryUpdate,
} from "./medusa-store-category-tree.js";

function existingShape(row: MedusaCategoryRow): ExistingStoreCategory {
  return {
    id: row.id,
    externalId: row.external_id,
    handle: row.handle,
    name: row.name,
    isActive: row.is_active,
    description: row.description ?? null,
    metadata: row.metadata ?? null,
  };
}

function mappingShape(link: MedusaCategoryLink): CategoryMapping {
  return { ourId: link.categoryId, medusaId: link.medusaCategoryId };
}

export interface StoreCategoryImportReport {
  created: number;
  linkedOnly: number;
  relinked: number;
  skipped: number;
  conflicts: string[];
  handleTaken: string[];
  blockedByConflict: string[];
  updates: StoreCategoryUpdate[];
  verification: ImportVerification;
}

/**
 * THE ACROPORA TREE TO MEDUSA (SEO P0 PR 10b). The same run shape as the UNAS
 * tree's service (`medusa-category-import.service.ts`): refuse on a truncated
 * list, link what already carries our id, create parent-first, a child of a
 * blocked parent is blocked too, then read back and count.
 */
@Injectable()
export class MedusaStoreCategoryImportService {
  constructor(private readonly links: MedusaStoreCategoryLinkRepository) {}

  private async current(client: MedusaAdminClient) {
    const list = await client.listProductCategories();
    if (list.truncated)
      throw new MedusaCategoryImportRefusedError(
        "a Medusa kategória-listája kimerítette a limitet, a terv csonkolt halmazon döntene",
      );
    return list.rows;
  }

  async plan(
    client: MedusaAdminClient,
    nodes: readonly StoreCategoryNode[],
  ): Promise<StoreCategoryImportPlan> {
    const targets = storeCategoryTargets(nodes);
    const rows = await this.current(client);
    return planStoreCategoryImport(
      targets,
      rows.map(existingShape),
      (await this.links.all()).map(mappingShape),
    );
  }

  async run(
    client: MedusaAdminClient,
    nodes: readonly StoreCategoryNode[],
    now: Date,
  ): Promise<StoreCategoryImportReport> {
    const targets = storeCategoryTargets(nodes);
    const rows = await this.current(client);
    const plan = planStoreCategoryImport(
      targets,
      rows.map(existingShape),
      (await this.links.all()).map(mappingShape),
    );

    const medusaId = new Map<string, string>();
    for (const cat of rows)
      if (cat.external_id) medusaId.set(cat.external_id, cat.id);

    const report: StoreCategoryImportReport = {
      created: 0,
      linkedOnly: 0,
      relinked: 0,
      skipped: plan.skip.length,
      conflicts: plan.conflict.map((c) => c.ourId),
      handleTaken: plan.handleTaken.map((h) => h.ourId),
      blockedByConflict: [],
      updates: [],
      verification: {
        carryingOurId: 0,
        activeAmongThem: 0,
        mappingRowsHere: 0,
        expected: targets.length,
        expectedActive: targets.filter((t) => t.isActive).length,
      },
    };

    for (const pair of plan.mapOnly) {
      await this.links.link(pair.ourId, pair.medusaId, now);
      medusaId.set(pair.ourId, pair.medusaId);
      report.linkedOnly += 1;
    }

    const stale = new Set(plan.staleMapping);
    // A category whose handle is taken on creation is not created, so its
    // children find no parent below and are blocked by that. One whose handle
    // is taken only on an update still stands, and its children hang on it.
    const blocked = new Set(plan.conflict.map((c) => c.ourId));
    for (const target of plan.create) {
      const parent = target.parentOurId
        ? (medusaId.get(target.parentOurId) ?? null)
        : null;
      if (target.parentOurId && (blocked.has(target.parentOurId) || !parent)) {
        blocked.add(target.ourId);
        report.blockedByConflict.push(target.ourId);
        continue;
      }
      const created = await client.createProductCategory({
        name: target.name,
        external_id: target.ourId,
        parent_category_id: parent,
        handle: target.handle,
        is_active: target.isActive,
        description: target.description,
        metadata: target.metadata,
      });
      medusaId.set(target.ourId, created.id);
      if (stale.has(target.ourId)) {
        await this.links.relink(target.ourId, created.id, now);
        report.relinked += 1;
      } else {
        await this.links.link(target.ourId, created.id, now);
        report.created += 1;
      }
    }

    for (const update of plan.update) {
      await client.updateProductCategory(update.medusaId, update.patch);
      report.updates.push(update);
    }

    const ourIds = new Set(targets.map((t) => t.ourId));
    const after = (await client.listProductCategories()).rows.filter(
      (cat) => cat.external_id && ourIds.has(cat.external_id),
    );
    report.verification = {
      carryingOurId: after.length,
      activeAmongThem: after.filter((cat) => cat.is_active).length,
      mappingRowsHere: (await this.links.all()).length,
      expected: targets.length,
      expectedActive: targets.filter((t) => t.isActive).length,
    };
    return report;
  }
}
