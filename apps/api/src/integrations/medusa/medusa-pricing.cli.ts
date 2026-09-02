import { pathToFileURL } from "node:url";

import { prisma, type Prisma as PrismaTypes } from "@acropora/database";
import { isKnownCatalogAuthority } from "./medusa-publication.policy.js";

import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  MedusaPricingProjectionService,
  type PricingProjectionReport,
} from "./medusa-pricing-projection.service.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";

/**
 * KÉZZEL indított ÁR-vetítés, cikkszámonként vagy termékazonosítónként.
 *
 * KÜLÖN PARANCS a termék- és a készlet-vetítéstől, ugyanazzal az indokkal,
 * amiért azok is külön állnak: a brief 10. pontja kimondja, hogy az
 * ár-vetítés NE nyúljon a publikációhoz, a 17. pont pedig kizárja a
 * készlet-módosítást. Ha egy parancs végezné mindhármat, ez a határ
 * előbb-utóbb elmosódna - nem azért, mert valaki eldönti, hanem mert egy
 * helyen állna a három.
 *
 * Szándékosan nincs ütemező: a brief 17. pontja az automatikus vetítést is
 * kizárja ebből a körből.
 *
 * Használat:
 *   pnpm --filter @acropora/api medusa:pricing sku:STAGEPROOF0002 [további...]
 *   pnpm --filter @acropora/api medusa:pricing <termékazonosító> [további...]
 */

/**
 * Az OS oldali olvasás, ADATBÁZIS-PARAMÉTERKÉNT, ugyanaz a minta, mint a
 * készlet-vetítés parancsánál: a gazda-ellenőrzés SZABÁLY, nem infrastruktúra,
 * tehát adatbázis nélkül is mérhetőnek kell lennie.
 */
export interface PricingCliDatabase {
  productVariant: {
    findMany(args: unknown): Promise<
      {
        id: string;
        sku: string;
        productId: string;
        sellingGrossPrice: PrismaTypes.Decimal | null;
        sellingPriceCurrency: string | null;
      }[]
    >;
  };
  product: {
    findMany(
      args: unknown,
    ): Promise<{ id: string; catalogAuthority: string | null }[]>;
  };
}

export interface PricingTarget {
  osProductId: string;
  sku: string;
  price: {
    sellingGrossPrice: PrismaTypes.Decimal | null;
    sellingPriceCurrency: string | null;
  };
}

/**
 * A jelentés sorai, EMBERNEK.
 *
 * Az ÁR AZONOSÍTÓJA nem díszítés, hanem a kör mércéje: ez az egyetlen mező,
 * amiből a futtató látja, hogy a második futás UGYANAZT a sort módosította, és
 * nem törölte-újraépítette. A darabszám erre nem alkalmas, mert a Medusa
 * ár-frissítése teljes csere: az azonosító nélküli küldés is egyetlen sort hagy
 * maga után, csak minden futáson másikat.
 */
export function describePricing(report: PricingProjectionReport): string {
  return [
    `forras: Acropora OS (sellingGrossPrice)`,
    `ar: ${report.sourceAmount} ${report.sourceCurrency} brutto`,
    `medusa amount: ${report.medusaAmount} ${report.medusaCurrencyCode}`,
    `ar-azonosito: ${report.priceId}`,
    `valtozat: ${report.variantId}`,
    `eredmeny: ${report.result}`,
  ].join("\n      ");
}

/** A vetítendő változatok egy paraméterből. */
export async function resolvePricingTargets(
  argument: string,
  database: PricingCliDatabase,
): Promise<PricingTarget[] | { error: string }> {
  const select = {
    id: true,
    sku: true,
    productId: true,
    sellingGrossPrice: true,
    sellingPriceCurrency: true,
  };

  const variants = argument.startsWith("sku:")
    ? await database.productVariant.findMany({
        where: { sku: argument.slice(4), isActive: true },
        select,
      })
    : await database.productVariant.findMany({
        where: { productId: argument, isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select,
      });

  if (!variants.length)
    return {
      error: argument.startsWith("sku:")
        ? `${argument}: nincs ilyen cikkszámú aktív változat`
        : `${argument}: nincs aktív változata (vagy nincs ilyen termék)`,
    };

  /**
   * A GAZDA-ELLENŐRZÉS ITT IS MEGVAN, és itt a legfontosabb: egy UNAS-gazdájú
   * termék ára a UNAS pillanatképben él, nem nálunk. Ha erre a parancsra
   * ráfutna, a saját üres mezőnkből próbálnánk árat vetíteni egy olyan
   * termékre, aminek van ára - csak nem a miénk.
   */
  const products = await database.product.findMany({
    where: { id: { in: [...new Set(variants.map((row) => row.productId))] } },
    select: { id: true, catalogAuthority: true },
  });
  const foreign = products.filter(
    (row) => !isKnownCatalogAuthority(row.catalogAuthority),
  );
  if (foreign.length)
    return {
      error:
        `${argument}: a törzsadat gazdája ismeretlen ` +
        `(${foreign
          .map((row) => `${row.id}=${row.catalogAuthority ?? "ismeretlen"}`)
          .join(", ")}), kihagyva. Az ára sem a miénk.`,
    };

  return variants.map((variant) => ({
    osProductId: variant.productId,
    sku: variant.sku,
    price: {
      sellingGrossPrice: variant.sellingGrossPrice,
      sellingPriceCurrency: variant.sellingPriceCurrency,
    },
  }));
}

export async function runPricingCli(
  targets: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  credentials = storedCredentialProvider(),
  database: PricingCliDatabase = prisma,
): Promise<number> {
  if (!targets.length) {
    out.stderr("Adj meg legalább egy termékazonosítót vagy sku: alakot.\n");
    return 1;
  }

  let service: MedusaPricingProjectionService;
  try {
    service = new MedusaPricingProjectionService(
      new MedusaProductLinkRepository(),
      await medusaClientForProjection(credentials, out),
    );
  } catch (error) {
    if (error instanceof MedusaConnectionError) {
      out.stderr(`${describeCredentialFailure(error)}\n`);
      return 1;
    }
    if (error instanceof MedusaConfigurationError) {
      out.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  let failed = 0;
  for (const argument of targets) {
    const resolved = await resolvePricingTargets(argument, database);
    if ("error" in resolved) {
      out.stderr(`${resolved.error}\n`);
      failed += 1;
      continue;
    }

    for (const target of resolved) {
      const outcome = await service.project(target);
      if (outcome.action === "stopped") {
        out.stderr(
          `${target.sku}: MEGÁLLT (${outcome.reason}) ${outcome.details}\n`,
        );
        failed += 1;
        continue;
      }

      out.stdout(
        `${target.sku}: ${outcome.report.result}\n` +
          `      ${describePricing(outcome.report)}\n`,
      );
    }
  }

  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runPricingCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
