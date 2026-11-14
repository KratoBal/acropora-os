import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { OS_BRAND_FOR_SHOP_SELECT } from "./medusa-brand-module.policy.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MEDUSA_STORE_CATEGORY_REFERENCE } from "./medusa-category.policy.js";
import { MEDUSA_PRODUCT_REFERENCE } from "./medusa-product-link.repository.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";
import {
  describeRedirectProjection,
  projectUrlRedirects,
  type RedirectSource,
} from "./medusa-redirect-projection.js";
import {
  discontinuedRedirect,
  isProductPageRule,
  shopRedirects,
  type RedirectProductState,
} from "./medusa-redirect-target.policy.js";
import {
  storefrontCategoryPath,
  webshopProductPath,
} from "../../products/redirect/redirect-path.js";

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

/** A termék mezői, amikből a bolti lap és a cél eldől (a publikáció, a márka, a webshop-slug, az elsődleges bolti kategória). */
const REDIRECT_PRODUCT_SELECT = {
  id: true,
  catalogAuthority: true,
  isActive: true,
  webshopSellable: true,
  variants: { where: { isActive: true }, select: { sku: true } },
  channelListings: {
    where: { channel: { in: ["UNAS", "WEBSHOP"] } },
    select: { channel: true, productUrl: true, slug: true },
  },
  brand: { select: OS_BRAND_FOR_SHOP_SELECT },
  storeCategories: {
    where: { isPrimary: true },
    select: {
      storeCategory: { select: { id: true, slug: true, isActive: true } },
    },
  },
  discontinuation: { select: { id: true } },
} satisfies Prisma.ProductSelect;

/**
 * Az aktív `UrlRedirect` sorok (PR 6), a termék-szabályok a termék mai lapja
 * szerint (`medusa-redirect-target.policy.ts`): ugyanazok a mezők, amikből a
 * termékvetítés a publikációt dönti el.
 *
 * A VÉGLEGESEN MEGSZŰNTNEK JELÖLT termékek (V4.2) a szabályoktól FÜGGETLENÜL kerülnek be: egy jelölt termék saját
 * lapja akkor is kap 301-et, ha nincs régi UNAS-címe. A cél a helyettesítő lapja, ha az ma megvehető, különben az
 * elsődleges bolti kategória lapja (`/hu/categories/<slug>`, csak ha a kategória aktív és a Medusában van).
 */
export const prismaRedirectSource: RedirectSource = {
  activeRedirects: async () => {
    const [szabalyok, jeloltek] = await Promise.all([
      prisma.urlRedirect.findMany({
        where: { isActive: true },
        select: {
          sourcePath: true,
          destinationPath: true,
          httpStatus: true,
          reason: true,
          entityType: true,
          entityId: true,
        },
      }),
      prisma.productDiscontinuation.findMany({
        select: { productId: true, replacementProductId: true },
      }),
    ]);
    const ids = [
      ...new Set([
        ...szabalyok.filter(isProductPageRule).map((r) => r.entityId),
        ...jeloltek.flatMap((j) =>
          j.replacementProductId
            ? [j.productId, j.replacementProductId]
            : [j.productId],
        ),
      ]),
    ];
    if (ids.length === 0) return shopRedirects(szabalyok, new Map());
    const [termekek, kotesek] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: ids } },
        select: REDIRECT_PRODUCT_SELECT,
      }),
      prisma.externalReference.findMany({
        where: { ...MEDUSA_PRODUCT_REFERENCE, entityId: { in: ids } },
        select: { entityId: true },
      }),
    ]);
    const kategoriaIds = [
      ...new Set(
        termekek.flatMap((t) =>
          t.storeCategories.map((sc) => sc.storeCategory.id),
        ),
      ),
    ];
    const kategoriaKotesek = kategoriaIds.length
      ? await prisma.externalReference.findMany({
          where: {
            ...MEDUSA_STORE_CATEGORY_REFERENCE,
            entityId: { in: kategoriaIds },
          },
          select: { entityId: true },
        })
      : [];
    const kotott = new Set(kotesek.map((k) => k.entityId));
    const kategoriaKotott = new Set(kategoriaKotesek.map((k) => k.entityId));
    const termekMap = new Map(termekek.map((t) => [t.id, t]));
    const publikacio = (t: (typeof termekek)[number]) => ({
      catalogAuthority: t.catalogAuthority,
      isActive: t.isActive,
      webshopSellable: t.webshopSellable,
      activeVariantCount: t.variants.length,
      variantSkus: t.variants.map((v) => v.sku),
    });
    const lapUt = (t: (typeof termekek)[number]) => {
      const slug = t.channelListings.find((c) => c.channel === "WEBSHOP")?.slug;
      return slug ? webshopProductPath(slug) : null;
    };
    const jelolt = new Map(jeloltek.map((j) => [j.productId, j]));
    const allapot = new Map<string, RedirectProductState>(
      termekek.map((t) => {
        const jeloles = jelolt.get(t.id);
        const csere = jeloles?.replacementProductId
          ? termekMap.get(jeloles.replacementProductId)
          : undefined;
        const kategoria = t.storeCategories[0]?.storeCategory;
        return [
          t.id,
          {
            linked: kotott.has(t.id),
            publication: publikacio(t),
            unasProductUrl:
              t.channelListings.find((c) => c.channel === "UNAS")?.productUrl ??
              null,
            brand: t.brand,
            discontinued: jeloles
              ? discontinuedRedirect({
                  pagePath: kotott.has(t.id) ? lapUt(t) : null,
                  replacement: csere
                    ? {
                        pagePath: lapUt(csere),
                        linked: kotott.has(csere.id),
                        publication: publikacio(csere),
                        marked: csere.discontinuation !== null,
                      }
                    : null,
                  categoryPath:
                    kategoria &&
                    kategoria.isActive &&
                    kategoriaKotott.has(kategoria.id)
                      ? storefrontCategoryPath(kategoria.slug)
                      : null,
                })
              : null,
          },
        ];
      }),
    );
    return shopRedirects(szabalyok, allapot);
  },
};

/**
 * AZ ÁTIRÁNYÍTÁS-LISTA KÉZI VETÍTÉSE (SEO P0 PR 7b), `pnpm medusa:redirects`.
 * Alapból SZÁRAZFUTÁS: kiírja, egyezik-e a bolt listája, és nem ír. `--apply`
 * mellett eltérésnél a teljes listát elküldi. Az ütemező köre ugyanezt futtatja.
 */
export async function runRedirectCli(
  argv: readonly string[],
  out: CliOutput,
  deps: { client(): Promise<MedusaAdminClient>; source: RedirectSource },
): Promise<number> {
  const ismeretlen = argv.filter((a) => a !== "--apply");
  if (ismeretlen.length) {
    out.stderr(`Ismeretlen kapcsolo: ${ismeretlen.join(" ")} (csak --apply)\n`);
    return 1;
  }
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
  const outcome = await projectUrlRedirects(client, deps.source, apply);
  out.stdout(describeRedirectProjection(outcome) + "\n");
  if (outcome.status === "refused") return 1;
  if (outcome.status === "would-send")
    out.stdout("SZARAZFUTAS: semmi nem irodott. Alkalmazas: --apply\n");
  return 0;
}

/* c8 ignore start -- a belépési pont: a mérhető rész a `runRedirectCli`. */
async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  process.exitCode = await runRedirectCli(process.argv.slice(2), out, {
    client: () => medusaClientForProjection(storedCredentialProvider(), out),
    source: prismaRedirectSource,
  });
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
