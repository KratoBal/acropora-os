import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { OS_BRAND_FOR_SHOP_SELECT } from "./medusa-brand-module.policy.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
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
  isProductPageRule,
  shopRedirects,
  type RedirectProductState,
} from "./medusa-redirect-target.policy.js";

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

/**
 * Az aktív `UrlRedirect` sorok (PR 6), a termék-szabályok a termék mai lapja
 * szerint (`medusa-redirect-target.policy.ts`): ugyanazok a mezők, amikből a
 * termékvetítés a publikációt dönti el.
 */
export const prismaRedirectSource: RedirectSource = {
  activeRedirects: async () => {
    const szabalyok = await prisma.urlRedirect.findMany({
      where: { isActive: true },
      select: {
        sourcePath: true,
        destinationPath: true,
        httpStatus: true,
        reason: true,
        entityType: true,
        entityId: true,
      },
    });
    const ids = [
      ...new Set(szabalyok.filter(isProductPageRule).map((r) => r.entityId)),
    ];
    const [termekek, kotesek] = ids.length
      ? await Promise.all([
          prisma.product.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              catalogAuthority: true,
              isActive: true,
              webshopSellable: true,
              variants: { where: { isActive: true }, select: { sku: true } },
              channelListings: {
                where: { channel: "UNAS" },
                select: { productUrl: true },
              },
              brand: { select: OS_BRAND_FOR_SHOP_SELECT },
            },
          }),
          prisma.externalReference.findMany({
            where: { ...MEDUSA_PRODUCT_REFERENCE, entityId: { in: ids } },
            select: { entityId: true },
          }),
        ])
      : [[], []];
    const kotott = new Set(kotesek.map((k) => k.entityId));
    const allapot = new Map<string, RedirectProductState>(
      termekek.map((t) => [
        t.id,
        {
          linked: kotott.has(t.id),
          publication: {
            catalogAuthority: t.catalogAuthority,
            isActive: t.isActive,
            webshopSellable: t.webshopSellable,
            activeVariantCount: t.variants.length,
            variantSkus: t.variants.map((v) => v.sku),
          },
          unasProductUrl: t.channelListings[0]?.productUrl ?? null,
          brand: t.brand,
        },
      ]),
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
