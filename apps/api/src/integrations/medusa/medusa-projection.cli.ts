import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  HttpMedusaAdminClient,
  medusaAdminConfigFromEnv,
} from "./medusa-admin.client.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import { MedusaProductProjectionService } from "./medusa-product-projection.service.js";

/**
 * KÉZZEL indított vetítés, termékazonosítónként.
 *
 * Szándékosan nincs ütemező és nincs kötegelés: ez a kör az első, ellenőrzött
 * átvitel, és az első éles betöltésnek ember által indított, egyszeri
 * műveletnek kell lennie. Ha ütemezőbe kötnénk, az első futás egy naplósorrá
 * válna, amit senki nem néz meg akkor, amikor a legfontosabb lenne.
 *
 * Használat:
 *   pnpm --filter @acropora/api medusa:project <termékazonosító> [további...]
 */
export async function runProjectionCli(
  productIds: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  if (!productIds.length) {
    out.stderr("Adj meg legalább egy termékazonosítót.\n");
    return 1;
  }

  const service = new MedusaProductProjectionService(
    new MedusaProductLinkRepository(),
    new HttpMedusaAdminClient(medusaAdminConfigFromEnv(process.env)),
  );

  let failed = 0;
  for (const productId of productIds) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        description: true,
        catalogAuthority: true,
        variants: {
          where: { isActive: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
          select: { sku: true },
        },
      },
    });

    if (!product) {
      out.stderr(`${productId}: nincs ilyen termék\n`);
      failed += 1;
      continue;
    }

    /**
     * Csak azt vetítjük ki, aminek a törzsadata a MIÉNK. Egy UNAS-gazdájú
     * terméket átvinni annyi lenne, mint a webshop adatát egy harmadik helyre
     * másolni, ahol senki nem gondozza.
     */
    if (product.catalogAuthority !== "ACROPORA") {
      out.stderr(
        `${productId}: a törzsadat gazdája nem az Acropora OS (${product.catalogAuthority ?? "ismeretlen"}), kihagyva\n`,
      );
      failed += 1;
      continue;
    }

    const outcome = await service.project(
      {
        id: product.id,
        name: product.name,
        description: product.description,
        primarySku: product.variants[0]?.sku ?? null,
      },
      new Date(),
    );

    if (outcome.action === "stopped") {
      out.stderr(
        `${productId}: MEGÁLLT (${outcome.reason}) ${outcome.details}\n`,
      );
      failed += 1;
      continue;
    }
    out.stdout(
      `${productId}: ${outcome.action} -> ${outcome.medusaProductId}\n`,
    );
  }

  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runProjectionCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
