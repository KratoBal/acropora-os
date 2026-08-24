import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  HttpMedusaAdminClient,
  MedusaConfigurationError,
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
 *   pnpm --filter @acropora/api medusa:project sku:TESZT0001 [további...]
 *
 * A `sku:` előtag azért van, mert ember cikkszámot ismer, nem belső
 * azonosítót. Előtag nélkül a paraméter termékazonosító. NEM találgatunk a két
 * alak között: egy „melyik lehet ez" heurisztika pont akkor tévedne, amikor egy
 * cikkszám véletlenül azonosítónak látszik.
 */
/** Cikkszámból termékazonosító. `null`, ha nincs ilyen aktív változat. */
async function resolveBySku(sku: string): Promise<string | null> {
  const variant = await prisma.productVariant.findUnique({
    where: { sku },
    select: { productId: true, isActive: true },
  });
  return variant?.isActive ? variant.productId : null;
}

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

  /**
   * A `--forget-link` CSAK a leképezés sorát törli, a terméket sem itt, sem
   * odaát nem érinti. A harmadik bizonyításhoz kell (az elveszett leképezés
   * helyreállítása), és azért van a parancsban, hogy ne kelljen kézzel írt
   * DELETE utasítást adni valakinek egy éles adatbázisra. A vetítés
   * újrafuttatása vissza is állítja.
   */
  const forgetOnly = productIds.includes("--forget-link");
  const targets = productIds.filter((value) => value !== "--forget-link");

  if (!targets.length) {
    out.stderr("Adj meg legalább egy termékazonosítót vagy sku: alakot.\n");
    return 1;
  }

  let service: MedusaProductProjectionService | null = null;
  if (!forgetOnly) {
    try {
      service = new MedusaProductProjectionService(
        new MedusaProductLinkRepository(),
        new HttpMedusaAdminClient(medusaAdminConfigFromEnv(process.env)),
      );
    } catch (error) {
      // Egy sor, ember számára. A hiányzó beállítás nem programhiba, hanem a
      // futtatás első lépése, amit el lehet felejteni.
      if (error instanceof MedusaConfigurationError) {
        out.stderr(`${error.message}\n`);
        return 1;
      }
      throw error;
    }
  }

  let failed = 0;
  for (const argument of targets) {
    const productId = argument.startsWith("sku:")
      ? await resolveBySku(argument.slice(4))
      : argument;

    if (!productId) {
      out.stderr(`${argument}: nincs ilyen cikkszámú aktív változat\n`);
      failed += 1;
      continue;
    }

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
      out.stderr(`${argument}: nincs ilyen termék (${productId})\n`);
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

    if (forgetOnly) {
      const removed = await prisma.externalReference.deleteMany({
        where: {
          system: "MEDUSA",
          entityType: "Product",
          entityId: product.id,
        },
      });
      out.stdout(
        `${product.id}: leképezés törölve (${removed.count} sor). A termék érintetlen.\n`,
      );
      continue;
    }

    const outcome = await service!.project(
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
