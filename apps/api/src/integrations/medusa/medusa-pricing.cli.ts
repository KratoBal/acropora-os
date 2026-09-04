import { pathToFileURL } from "node:url";

import { prisma, type Prisma as PrismaTypes } from "@acropora/database";
import { isKnownCatalogAuthority } from "./medusa-publication.policy.js";
import {
  describePriceSource,
  resolvePriceSource,
  type PriceOwner,
} from "./medusa-price-source.js";

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
import {
  describeBatchSize,
  parseBatchArguments,
  selectBatchTargets,
} from "./medusa-projection-batch.js";

/**
 * KÉZZEL indított ÁR-vetítés, cikkszámonként, termékazonosítónként vagy
 * korlátos termékkötegben.
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
 *   pnpm --filter @acropora/api medusa:pricing --limit 50 [--from <termékazonosító>]
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
  /**
   * A TÜKÖR, ÉS AZÉRT ADATBÁZIS-PARAMÉTERKÉNT, mint a másik kettő: a
   * forrás-választás SZABÁLY (`medusa-price-source.ts`), tehát adatbázis nélkül
   * is mérhetőnek kell lennie.
   */
  unasProductSnapshot: {
    findMany(args: unknown): Promise<
      {
        productId: string;
        grossPrice: PrismaTypes.Decimal | null;
        currency: string | null;
        saleGrossPrice: PrismaTypes.Decimal | null;
        saleStartsAt: Date | null;
        saleEndsAt: Date | null;
      }[]
    >;
  };
}

export interface PricingTarget {
  osProductId: string;
  sku: string;
  /** Honnan jött az ár. A jelentés ezt írja ki, és nem a hívó találgatja. */
  source: PriceOwner;
  price: {
    sellingGrossPrice: PrismaTypes.Decimal | null;
    sellingPriceCurrency: string | null;
  };
}

/**
 * A FELOLDÁS EREDMÉNYE: AMI MEHET, ÉS AMI NEM -- EGYSZERRE.
 *
 * Korábban ez egy `PricingTarget[] | { error }` unió volt, tehát EGY változat
 * elakadása az EGÉSZ argumentumot elvitte. A tükör-ág után ez már nem
 * elviselhető: egy terméknek több változata van, és ha az egyiknél aktív akció
 * fut, a többinek attól még mennie kell. A fordított hiba viszont rosszabb
 * lenne: ha csak a mehetőket adnánk vissza, az elakadt változat NÉMÁN esne ki.
 */
export interface PricingTargetResolution {
  targets: PricingTarget[];
  /** Emberi mondatok arról, ami NEM megy. Üres, ha minden mehet. */
  errors: string[];
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
    `forras: ${describePriceSource(report.source)}`,
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
  /** A „most", kívülről: a tükör akciós árának aktivitása időfüggő. */
  now: Date = new Date(),
): Promise<PricingTargetResolution> {
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
      targets: [],
      errors: [
        argument.startsWith("sku:")
          ? `${argument}: nincs ilyen cikkszámú aktív változat`
          : `${argument}: nincs aktív változata (vagy nincs ilyen termék)`,
      ],
    };

  const productIds = [...new Set(variants.map((row) => row.productId))];

  /**
   * A GAZDA DÖNTI EL, HONNAN JÖN AZ ÁR (Balázs döntése, 2026-09-04, a (b) út).
   *
   * UNAS gazdánál a tükörből, ACROPORA gazdánál a sajátunkból. A SZABÁLY a
   * `medusa-price-source.ts`-ben áll, egy helyen: itt csak a két olvasás van.
   */
  const products = await database.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, catalogAuthority: true },
  });
  const authorityByProduct = new Map(
    products.map((row) => [row.id, row.catalogAuthority]),
  );

  const snapshots = await database.unasProductSnapshot.findMany({
    where: { productId: { in: productIds } },
    select: {
      productId: true,
      grossPrice: true,
      currency: true,
      saleGrossPrice: true,
      saleStartsAt: true,
      saleEndsAt: true,
    },
  });
  const mirrorByProduct = new Map(snapshots.map((row) => [row.productId, row]));

  const targets: PricingTarget[] = [];
  const errors: string[] = [];

  for (const variant of variants) {
    const authority = authorityByProduct.get(variant.productId) ?? null;
    const decision = resolvePriceSource({
      /**
       * A GAZDA CSAK AKKOR GAZDA, HA ISMERJÜK A NEVÉT. Egy ismeretlen érték nem
       * „miénk" és nem „övék": a szűrés nélkül a modul `ACROPORA`-ként kapná
       * meg, és a saját üres mezőnkből próbálnánk árat vetíteni.
       */
      authority: isKnownCatalogAuthority(authority)
        ? (authority as "UNAS" | "ACROPORA")
        : null,
      mirror: mirrorByProduct.get(variant.productId) ?? null,
      own: {
        sellingGrossPrice: variant.sellingGrossPrice,
        sellingPriceCurrency: variant.sellingPriceCurrency,
      },
      now,
    });

    if (!decision.ok) {
      errors.push(
        `${variant.sku}: MEGÁLLT (${decision.reason}) ${decision.details}`,
      );
      continue;
    }

    targets.push({
      osProductId: variant.productId,
      sku: variant.sku,
      source: decision.source,
      price: decision.price,
    });
  }

  return { targets, errors };
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
  const parsed = parseBatchArguments(targets);
  if (parsed.kind === "error") {
    out.stderr(`${parsed.message}\n`);
    return 1;
  }

  const selectedTargets = await selectBatchTargets(parsed.selection, database);
  if (parsed.selection.limit !== null)
    out.stdout(describeBatchSize(selectedTargets));

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
  for (const argument of selectedTargets) {
    const resolved = await resolvePricingTargets(argument, database);
    /**
     * A HIBÁK ÉS A MEHETŐK EGYÜTT JÖNNEK VISSZA, és mind a kettőt fel kell
     * dolgozni. Egy `continue` az első hibánál azt jelentené, hogy egy termék
     * ép változatai egy elakadt testvér miatt maradnak ki.
     */
    for (const uzenet of resolved.errors) {
      out.stderr(`${uzenet}\n`);
      failed += 1;
    }

    for (const target of resolved.targets) {
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
