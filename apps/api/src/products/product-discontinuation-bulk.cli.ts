import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { retryOnSerializationConflict } from "../common/transaction-retry.util.js";
import {
  BULK_USAGE,
  runBulkDiscontinuation,
} from "./product-discontinuation-bulk.mag.js";
import { ProductDiscontinuationRepository } from "./product-discontinuation.repository.js";

/**
 * The command line form only: it exports nothing, and the body (`.mag.ts`) never imports it back. The writes go
 * through the same repository `set` as the API (the checks, the Serializable transaction, the audit row and the
 * event), so this command has no write path of its own.
 */
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(BULK_USAGE);
    process.exit(0);
  }
  const repository = new ProductDiscontinuationRepository();
  const code = await runBulkDiscontinuation(
    argv,
    { readFile: (path) => readFileSync(path, "utf8"), env: process.env },
    {
      actorExists: async (userId) =>
        Boolean(
          await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true },
          }),
        ),
      resolveSkus: async (skus) => {
        const rows = skus.length
          ? await prisma.productVariant.findMany({
              where: { sku: { in: [...skus] } },
              select: { sku: true, productId: true },
            })
          : [];
        const bySku = new Map<string, string[]>();
        for (const row of rows) {
          const ids = bySku.get(row.sku) ?? [];
          if (!ids.includes(row.productId)) ids.push(row.productId);
          bySku.set(row.sku, ids);
        }
        return bySku;
      },
      currentMark: async (productId) => {
        const mark = await repository.find(productId);
        return mark
          ? { replacementProductId: mark.replacement?.id ?? null }
          : null;
      },
      check: (productId, replacementProductId, ignoreMarksOf) =>
        repository.check(productId, replacementProductId, ignoreMarksOf),
      write: async (productId, replacementProductId, actorUserId) => {
        await retryOnSerializationConflict(() =>
          repository.set(
            productId,
            replacementProductId,
            actorUserId,
            "bulk-cli",
          ),
        );
      },
    },
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
  );
  await prisma.$disconnect();
  process.exit(code);
}
