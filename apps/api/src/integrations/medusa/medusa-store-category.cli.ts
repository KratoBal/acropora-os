import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { MedusaCategoryImportRefusedError } from "./medusa-category-import.service.js";
import { MedusaStoreCategoryLinkRepository } from "./medusa-category-link.repository.js";
import { describeVerification, type CliOutput } from "./medusa-category.cli.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";
import { MedusaStoreCategoryImportService } from "./medusa-store-category-import.service.js";
import type {
  StoreCategoryImportPlan,
  StoreCategoryNode,
} from "./medusa-store-category-tree.js";

/**
 * THE ACROPORA TREE TO MEDUSA, started by hand (SEO P0 PR 10b).
 *
 *   pnpm --filter @acropora/api medusa:store-categories            # PLAN, no write
 *   pnpm --filter @acropora/api medusa:store-categories --apply    # the load
 *
 * The plan is the default for the same reason as `medusa:categories`: after a
 * run without `--apply` only knowledge is left; after one with it, categories
 * stand in another system.
 */

/** Our tree, from the `StoreCategory` table. */
export async function ourStoreCategoryTree(): Promise<StoreCategoryNode[]> {
  return prisma.storeCategory.findMany({
    select: {
      id: true,
      parentId: true,
      name: true,
      slug: true,
      seoTitle: true,
      metaDescription: true,
      intro: true,
      isActive: true,
    },
  });
}

export function describeStorePlan(plan: StoreCategoryImportPlan): string {
  const lines = [
    `Létrehozandó: ${plan.create.length}`,
    `Már áll, leképezéssel: ${plan.skip.length}`,
    `Már áll, de a leképezés hiányzik: ${plan.mapOnly.length}`,
    `Elavult leképezés (újra létrehozandó): ${plan.staleMapping.length}`,
    `Ütközés (érintetlen marad): ${plan.conflict.length}`,
    `Foglalt webcím (érintetlen marad): ${plan.handleTaken.length}`,
    `Frissítendő: ${plan.update.length}`,
  ];
  for (const u of plan.update)
    lines.push(`  ${u.ourId}: ${u.changed.join(", ")}`);
  for (const h of plan.handleTaken)
    lines.push(
      `  ${h.ourId}: a(z) „${h.handle}” webcímet a(z) ${h.heldBy} Medusa-kategória viseli`,
    );
  if (plan.conflict.length)
    lines.push(
      `Az ütköző kategóriák: ${plan.conflict.map((c) => c.ourId).join(", ")}`,
    );
  return lines.join("\n") + "\n";
}

export async function runStoreCategoryCli(
  argv: readonly string[],
  out: CliOutput,
  deps: {
    client(): Promise<MedusaAdminClient>;
    tree(): Promise<StoreCategoryNode[]>;
    service(): MedusaStoreCategoryImportService;
    now(): Date;
  },
): Promise<number> {
  const apply = argv.includes("--apply");
  let client: MedusaAdminClient;
  try {
    client = await deps.client();
  } catch (error) {
    if (error instanceof MedusaConnectionError) {
      out.stderr(describeCredentialFailure(error) + "\n");
      return 1;
    }
    throw error;
  }

  const nodes = await deps.tree();
  const service = deps.service();

  try {
    if (!apply) {
      const plan = await service.plan(client, nodes);
      out.stdout("TERV, írás nélkül (Acropora-kategóriafa):\n");
      out.stdout(describeStorePlan(plan));
      out.stdout("Ez a futás semmit nem írt. A betöltéshez: --apply\n");
      return 0;
    }

    const report = await service.run(client, nodes, deps.now());
    out.stdout(
      [
        `Létrehozva: ${report.created}`,
        `Csak leképezés írva: ${report.linkedOnly}`,
        `Elavult leképezés átírva: ${report.relinked}`,
        `Frissítve: ${report.updates.length}`,
        `Változatlan: ${report.skipped - report.updates.length}`,
        `Ütközés, érintetlen: ${report.conflicts.length}`,
        `Foglalt webcím, érintetlen: ${report.handleTaken.length}`,
        `A szülőjük miatt kimaradt: ${report.blockedByConflict.length}`,
      ].join("\n") + "\n",
    );
    out.stdout(describeVerification(report.verification));
    // anything left for a person is exit 2, as in `medusa:categories`
    return report.conflicts.length ||
      report.handleTaken.length ||
      report.blockedByConflict.length
      ? 2
      : 0;
  } catch (error) {
    if (error instanceof MedusaCategoryImportRefusedError) {
      out.stderr(`A betöltés megállt: ${error.reason}\n`);
      return 1;
    }
    throw error;
  }
}

/* c8 ignore start -- the entry point: the measurable part is `runStoreCategoryCli`. */
async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  const code = await runStoreCategoryCli(process.argv.slice(2), out, {
    client: () => medusaClientForProjection(storedCredentialProvider(), out),
    tree: ourStoreCategoryTree,
    service: () =>
      new MedusaStoreCategoryImportService(
        new MedusaStoreCategoryLinkRepository(),
      ),
    now: () => new Date(),
  });
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
