import { pathToFileURL } from "node:url";

import { prisma, Prisma } from "@acropora/database";

import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../../common/warehouse.util.js";
import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  MedusaInventoryProjectionService,
  type InventoryProjectionReport,
} from "./medusa-inventory-projection.service.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";
import { storefrontSalesChannelId } from "./medusa-sales-channel.config.js";

/**
 * KÉZZEL indított KÉSZLET-vetítés, cikkszámonként vagy termékazonosítónként.
 *
 * KÜLÖN PARANCS a termék-vetítéstől, és ez nem kényelmi kérdés: a brief 4.
 * pontja szerint a publikáció és a készlet KÜLÖN FELELŐSSÉG. Ha egy parancs
 * végezné mindkettőt, a nulla készlet előbb-utóbb hatna a publikációra - nem
 * azért, mert valaki eldönti, hanem mert egy helyen áll a kettő.
 *
 * Szándékosan nincs ütemező és nincs esemény-vezérelt futás: a brief mindkettőt
 * kizárja ebből a körből.
 *
 * Használat:
 *   pnpm --filter @acropora/api medusa:inventory sku:teszt0001 [további...]
 *   pnpm --filter @acropora/api medusa:inventory <termékazonosító> [további...]
 *
 * A `sku:` előtag nélkül a paraméter TERMÉKAZONOSÍTÓ, és a termék minden aktív
 * változatának készletét vetítjük. NEM találgatunk a két alak között.
 */

/**
 * Az OS oldali olvasás, ADATBÁZIS-PARAMÉTERKÉNT.
 *
 * Ugyanaz a minta, ami a repository-kban is áll (`PosProductSearchDatabase`,
 * `WarehouseLookupDatabase`), és ugyanazért: a gazda-ellenőrzés és a
 * készletsor-választás SZABÁLY, nem infrastruktúra, tehát adatbázis nélkül is
 * mérhetőnek kell lennie. A brief 13. tesztje („UNAS-owned mastership nem
 * változik") pontosan ezt a szabályt kéri számon.
 */
export interface InventoryCliDatabase extends WarehouseLookupDatabase {
  productVariant: {
    findMany(
      args: unknown,
    ): Promise<{ id: string; sku: string; productId: string }[]>;
  };
  product: {
    findMany(
      args: unknown,
    ): Promise<{ id: string; catalogAuthority: string | null }[]>;
  };
  stockItem: {
    findMany(args: unknown): Promise<
      {
        variantId: string;
        onHand: Prisma.Decimal;
        reserved: Prisma.Decimal | null;
      }[]
    >;
  };
}

/** Egy változat, amit vetítünk, a hozzá tartozó OS készletsorral. */
export interface VariantStock {
  osProductId: string;
  sku: string;
  onHand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  /**
   * Igaz, ha nincs HELY ÉS TÉTEL NÉLKÜLI készletsor a fő raktárban.
   *
   * Nem hiba: nulla, és a jelentés kimondja. De azt is kimondja, hogy MIT
   * néztünk - lásd `describeMissingStockRow`.
   */
  missingRow: boolean;
}

/**
 * Amit a hiányzó készletsorról MONDHATUNK, és nem több.
 *
 * Az első változatom azt írta ki, hogy „nincs készletsor a fő raktárban".
 * **Nem ezt néztük meg.** A lekérdezés a hely és tétel NÉLKÜLI sort keresi
 * (`locationId: null, lotId: null`), pontosan úgy, ahogy az UNAS-út és a POS
 * kereső - egy változatnak tehát lehet készlete egy polcon vagy egy tételen,
 * és az üzenet mégis azt állítaná, hogy a raktárban nincs semmije.
 *
 * A szűkítés maga SZÁNDÉKOS és marad: a mai gyakorlat sem összegez a változat
 * összes során, és egy másik olvasás itt csendben egy MÁSIK készletfogalmat
 * vezetne be. Amin változtatni kell, az nem a lekérdezés, hanem az, hogy a
 * mondat ne állítson többet nála.
 *
 * Külön, exportált függvény, hogy a mondat MÉRHETŐ legyen: egy jelentés-szöveg
 * a parancs törzsében csak adatbázissal nézhető meg, és pont az ilyen mondatok
 * szoktak túlélni egy lekérdezés-változást.
 */
export function describeMissingStockRow(
  sku: string,
  warehouseName: string,
): string {
  return (
    `${sku}: nincs hely és tétel nélküli készletsor a(z) ${warehouseName} ` +
    `raktárban, tehát az értékesíthető készlet nulla. A hellyel vagy tétellel ` +
    `nyilvántartott sorokat ez a vetítés NEM olvassa és nem összegzi - ` +
    `ugyanúgy, ahogy az UNAS-kiküldés sem.`
  );
}

/**
 * A jelentés törzse, emberi olvasásra.
 *
 * A brief 9. pontja sorolja fel a kötelező sorokat. HÁROM SOR VAN RAJTUK
 * FELÜL, és mind a három mérésből következik:
 *
 * - `backorder`: mert az alapértelmezés a döntés ELLENTÉTE. Ha nem látszik,
 *   hogy beállítottuk, akkor egy elmaradt beállítás ugyanúgy néz ki, mint egy
 *   sikeres futás.
 * - a vágás jelzése: enélkül a nulla úgy olvasódna, mintha üres raktár lenne,
 *   holott a készlet MÍNUSZ kettő.
 * - a törtrész jelzése: a bolt lefelé kerekít, tehát a jelentés különben
 *   többet állítana, mint amennyit a bolt elad.
 */
export function describeInventory(report: InventoryProjectionReport): string {
  const lines = [
    "inventory:",
    `  on hand: ${report.onHand}`,
    `  reserved: ${report.reserved}`,
    `  available to sell: ${report.availableToSell}`,
    `  medusa quantity: ${report.medusaQuantity}`,
    `  location: ${report.locationName} (${report.locationId})`,
    `  inventory item: ${report.inventoryItemId}`,
  ];

  if (report.medusaReserved !== null)
    lines.push(
      `  medusa reserved: ${report.medusaReserved} ` +
        `(a Medusa SAJÁT foglalása, az OS foglalásán FELÜL vonódik le)`,
    );

  if (report.clamped)
    lines.push(
      `  negatívról vágva: ${report.availableToSell} -> ${report.medusaQuantity} ` +
        `(a cél oldal validátora min(0), tehát a vágás kényszer)`,
    );
  if (report.fractionDropped)
    lines.push(
      `  törtrész elhagyva: ${report.availableToSell} -> ${report.medusaQuantity} ` +
        `(a bolt lefelé kerekít a saját elérhetőség-számításában)`,
    );

  lines.push(
    `  backorder: ${report.backorder ? "engedélyezve" : "tiltva"} ` +
      `(${report.backorderResult === "set" ? "most állítottuk be" : "már így állt"})`,
    `  result: ${report.levelResult}`,
  );

  return lines.join("\n      ");
}

/** A vetítendő változatok egy paraméterből. Üres tömb, ha nincs találat. */
export async function resolveTargets(
  argument: string,
  warehouseId: string,
  database: InventoryCliDatabase,
): Promise<VariantStock[] | { error: string }> {
  const variants = argument.startsWith("sku:")
    ? await database.productVariant.findMany({
        where: { sku: argument.slice(4), isActive: true },
        select: { id: true, sku: true, productId: true },
      })
    : await database.productVariant.findMany({
        where: { productId: argument, isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, sku: true, productId: true },
      });

  if (!variants.length)
    return {
      error: argument.startsWith("sku:")
        ? `${argument}: nincs ilyen cikkszámú aktív változat`
        : `${argument}: nincs aktív változata (vagy nincs ilyen termék)`,
    };

  /**
   * A gazda-ellenőrzés ITT is megvan, ugyanazzal az indokkal, mint a
   * termék-vetítésnél: egy UNAS-gazdájú termék készletét átvinni annyi lenne,
   * mint a webshop adatát egy harmadik helyre másolni, ahol senki nem gondozza.
   */
  const products = await database.product.findMany({
    where: { id: { in: [...new Set(variants.map((row) => row.productId))] } },
    select: { id: true, catalogAuthority: true },
  });
  const foreign = products.filter((row) => row.catalogAuthority !== "ACROPORA");
  if (foreign.length)
    return {
      error:
        `${argument}: a törzsadat gazdája nem az Acropora OS ` +
        `(${foreign.map((row) => `${row.id}=${row.catalogAuthority ?? "ismeretlen"}`).join(", ")}), kihagyva`,
    };

  /**
   * UGYANAZ A KÉSZLETSOR, amit ma az UNAS-út és a POS olvas: a fő raktár,
   * hely és tétel NÉLKÜLI sora. Nem összegzünk a változat összes során, mert
   * a mai gyakorlat sem összegez - egy másik olvasás itt csendben egy MÁSIK
   * készletfogalmat vezetne be, és a brief 13. pontja pontosan ezt tiltja.
   */
  const rows = await database.stockItem.findMany({
    where: {
      warehouseId,
      locationId: null,
      lotId: null,
      variantId: { in: variants.map((row) => row.id) },
    },
    select: { variantId: true, onHand: true, reserved: true },
  });
  const byVariant = new Map(rows.map((row) => [row.variantId, row]));

  return variants.map((variant) => {
    const row = byVariant.get(variant.id);
    return {
      osProductId: variant.productId,
      sku: variant.sku,
      onHand: row?.onHand ?? new Prisma.Decimal(0),
      reserved: row?.reserved ?? new Prisma.Decimal(0),
      missingRow: !row,
    };
  });
}

export async function runInventoryCli(
  targets: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  credentials = storedCredentialProvider(),
  env: Record<string, string | undefined> = process.env,
  database: InventoryCliDatabase = prisma,
): Promise<number> {
  if (!targets.length) {
    out.stderr("Adj meg legalább egy termékazonosítót vagy sku: alakot.\n");
    return 1;
  }

  let service: MedusaInventoryProjectionService;
  try {
    service = new MedusaInventoryProjectionService(
      new MedusaProductLinkRepository(),
      await medusaClientForProjection(credentials, out),
      storefrontSalesChannelId(env),
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

  const warehouse = await ensureMainWarehouse(database);

  let failed = 0;
  for (const argument of targets) {
    const resolved = await resolveTargets(argument, warehouse.id, database);
    if ("error" in resolved) {
      out.stderr(`${resolved.error}\n`);
      failed += 1;
      continue;
    }

    for (const stock of resolved) {
      if (stock.missingRow)
        out.stdout(`${describeMissingStockRow(stock.sku, warehouse.name)}\n`);

      const outcome = await service.project(stock);
      if (outcome.action === "stopped") {
        out.stderr(
          `${stock.sku}: MEGÁLLT (${outcome.reason}) ${outcome.details}\n`,
        );
        failed += 1;
        continue;
      }

      out.stdout(
        `${stock.sku}: ${outcome.action} -> ${outcome.report.variantId}\n` +
          `      ${describeInventory(outcome.report)}\n`,
      );
    }
  }

  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runInventoryCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
