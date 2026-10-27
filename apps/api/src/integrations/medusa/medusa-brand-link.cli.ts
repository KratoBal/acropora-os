import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { MedusaConfigurationError } from "./medusa-admin.client.js";
import type { MedusaAdminClient } from "./medusa-admin.client.js";
import {
  brandIsShown,
  OS_BRAND_FOR_SHOP_SELECT,
  type OsBrandForShop,
} from "./medusa-brand-module.policy.js";
import {
  describeBrandLink,
  MedusaBrandModuleService,
} from "./medusa-brand-module.service.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.credentials.js";
import {
  skuParositas,
  type CliOutput,
  type ShippingAttributesCliDatabase,
} from "./medusa-shipping-attributes.cli.js";

/**
 * A MARKA-MODUL ES A TERMEK-MARKA KAPCSOLAT KITOLTESE A BOLTBAN, A TERMEK
 * TORZSENEK IRASA NELKUL (kezdolap-marka-sav, 2026-10-27).
 *
 * Hasznalat:
 *   pnpm --filter @acropora/api medusa:brand-links            # TERV, iras nelkul
 *   pnpm --filter @acropora/api medusa:brand-links --apply    # a tenyleges iras
 *
 * === MIERT KULON PARANCS ===
 *
 * A marka-rekord es a kapcsolat eddig CSAK termekvetiteskor irodott ki
 * (SEO P0 PR 11). A teszt boltban a PR 11 ota nem futott olyan vetites, ami a
 * termekeket erinti, ezert a marka-modul ures (merve 2026-10-27: a
 * `/store/brands` 0 sort ad, mikozben 46 markagyujtemenyben van termek), es
 * minden markaoldal 404. Egy teljes termekvetites ezt megoldana, de az a termek
 * torzset is ujrairna; ez a parancs csak a ket marka-irast vegzi.
 *
 * === A HALMAZ ===
 *
 * Minden OS termek, aminek van markaja. A bolti termeket a kotes-sor adja, ha
 * van, kulonben az egyertelmu SKU-par (ugyanaz a szabaly, mint a szallitasi
 * jellemzoknel: a teszt bolt termekeinek nincs kotes-soruk). Ami a boltban nincs
 * meg, kimarad, okkal. Egy kikapcsolt vagy archivalt marka termekenek a
 * kapcsolata torlodik (a vetites szabalya: annak a markanak nincs boltoldala).
 *
 * === AZ ALAPERTELMEZES A TERV ===
 *
 * `--apply` nelkul olvas, es megmondja, mit irna. A vegen egy osszesito sor all
 * okonkent, hogy a szaraz futas szamai a valodi futas elott ellenorizhetok
 * legyenek.
 */
export interface BrandLinkCliDatabase extends Pick<
  ShippingAttributesCliDatabase,
  "productVariant" | "unasProductSnapshot"
> {
  product: {
    findMany(
      args: unknown,
    ): Promise<{ id: string; brand: OsBrandForShop | null }[]>;
  };
}

export interface BrandLinkSummary {
  products: number;
  noShopProduct: number;
  hiddenBrand: number;
  linkApplied: number;
  linkPlanned: number;
  linkUnchanged: number;
  recordApplied: number;
  recordPlanned: number;
  recordUnchanged: number;
  failed: number;
}

export function describeBrandLinkSummary(
  s: BrandLinkSummary,
  apply: boolean,
): string {
  return [
    `Összesítés (${apply ? "írás" : "terv, írás nélkül"}):`,
    `  márkás OS termék: ${s.products}`,
    `  kimaradt, a boltban nincs meg (se kötés, se egyértelmű SKU-pár): ${s.noShopProduct}`,
    `  kikapcsolt vagy archivált márka (a kapcsolat üres marad vagy törlődik): ${s.hiddenBrand}`,
    `  termék-márka kapcsolat: ${apply ? `most beállítva ${s.linkApplied}` : `kiküldenénk ${s.linkPlanned}`}, már így állt ${s.linkUnchanged}`,
    `  márka-rekord: ${apply ? `most kiírva ${s.recordApplied}` : `kiküldenénk ${s.recordPlanned}`}, már így állt ${s.recordUnchanged}`,
    `  hiba: ${s.failed}`,
    "",
  ].join("\n");
}

export async function runBrandLinkCli(
  argumentumok: string[],
  out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  credentials = storedCredentialProvider(),
  database: BrandLinkCliDatabase = prisma as unknown as BrandLinkCliDatabase,
  client?: MedusaAdminClient,
  links: Pick<
    MedusaProductLinkRepository,
    "findManyByProductIds"
  > = new MedusaProductLinkRepository(),
): Promise<number> {
  const apply = argumentumok.includes("--apply");

  const termekek = await database.product.findMany({
    where: { brandId: { not: null } },
    select: { id: true, brand: { select: OS_BRAND_FOR_SHOP_SELECT } },
    orderBy: { id: "asc" },
  });
  if (termekek.length === 0) {
    out.stdout("Egyetlen OS terméknek sincs márkája: nincs mit átvinni.\n");
    return 0;
  }

  let bolt = client;
  if (!bolt) {
    try {
      bolt = await medusaClientForProjection(credentials, out);
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
  }

  const kotesek = await links.findManyByProductIds(termekek.map((t) => t.id));
  const shopClient = bolt;
  const parositas = await skuParositas(
    {
      listShopSkus: (offset, limit) =>
        shopClient.listProductSkus(offset, limit),
    },
    database,
  );
  out.stdout(
    `${termekek.length} márkás termék; kötés-sor ${kotesek.size}, SKU-párosítás: ${parositas.osToShop.size} egyértelmű, ${parositas.ketertelmu} kétértelmű, ${parositas.nincs} pár nélkül (a bolt ${parositas.boltiTermek} termékéből)\n`,
  );

  const service = new MedusaBrandModuleService(bolt);
  const s: BrandLinkSummary = {
    products: termekek.length,
    noShopProduct: 0,
    hiddenBrand: 0,
    linkApplied: 0,
    linkPlanned: 0,
    linkUnchanged: 0,
    recordApplied: 0,
    recordPlanned: 0,
    recordUnchanged: 0,
    failed: 0,
  };
  for (const termek of termekek) {
    // a kotes-sor az erosebb: az a vetites sajat, megfigyelt parja
    const medusaId =
      kotesek.get(termek.id) ?? parositas.osToShop.get(termek.id) ?? null;
    if (!medusaId) {
      s.noShopProduct++;
      out.stdout(`${termek.id}: kihagyva (a boltban nincs meg)\n`);
      continue;
    }
    if (!brandIsShown(termek.brand)) s.hiddenBrand++;
    try {
      const kimenet = await service.project(medusaId, termek.brand, apply);
      if (kimenet.action === "applied") s.linkApplied++;
      else if (kimenet.action === "planned") s.linkPlanned++;
      else s.linkUnchanged++;
      if (kimenet.brandRecord === "applied") s.recordApplied++;
      else if (kimenet.brandRecord === "planned") s.recordPlanned++;
      else if (kimenet.brandRecord === "unchanged") s.recordUnchanged++;
      out.stdout(`${termek.id} -> ${medusaId}\n${describeBrandLink(kimenet)}`);
    } catch (error) {
      s.failed++;
      out.stderr(
        `${termek.id} -> ${medusaId}: a márka-kapcsolat nem sikerült (${
          error instanceof Error ? error.message : String(error)
        })\n`,
      );
    }
  }

  out.stdout(`\n${describeBrandLinkSummary(s, apply)}`);
  if (!apply)
    out.stdout(
      "Ez a futás semmit nem írt. Az átvitelhez add meg a --apply kapcsolót.\n",
    );
  return s.failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runBrandLinkCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
