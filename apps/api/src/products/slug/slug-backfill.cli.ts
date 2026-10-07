import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { describeSlugBackfill, planSlugBackfill } from "./slug-backfill.js";

/**
 * A SLUG-BACKFILL PARANCSA (SEO P0 PR 5). Alapból SZÁRAZFUTÁS: kiírja a tervet, és
 * nem ír. `--apply` mellett egy tranzakcióban minden sluggal még nem bíró termék
 * WEBSHOP csatorna-sort kap a sluggal. Idempotens: egy második futás 0 sort ír.
 */
export async function main(
  args: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  db = prisma,
): Promise<number> {
  const ismeretlen = args.filter((a) => a !== "--apply");
  if (ismeretlen.length) {
    out.stderr(`Ismeretlen kapcsolo: ${ismeretlen.join(" ")} (csak --apply)\n`);
    return 1;
  }
  const [termekek, regi] = await Promise.all([
    db.product.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        variants: {
          where: { isActive: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 1,
          select: { sku: true },
        },
        channelListings: {
          where: { channel: "WEBSHOP" },
          select: { slug: true },
        },
      },
    }),
    db.slugHistory.findMany({
      where: { entityType: "PRODUCT" },
      select: { slug: true },
    }),
  ]);
  const plan = planSlugBackfill(
    termekek.map((t) => ({
      id: t.id,
      name: t.name,
      primarySku: t.variants[0]?.sku ?? null,
      slug: t.channelListings[0]?.slug ?? null,
    })),
    regi.map((r) => r.slug),
  );
  out.stdout(describeSlugBackfill(plan));
  if (!args.includes("--apply")) {
    out.stdout("SZARAZFUTAS: semmi nem irodott. Alkalmazas: --apply\n");
    return 0;
  }
  await db.$transaction(
    plan.assignments.map((a) =>
      db.channelListing.upsert({
        where: {
          productId_channel: { productId: a.productId, channel: "WEBSHOP" },
        },
        create: { productId: a.productId, channel: "WEBSHOP", slug: a.slug },
        update: { slug: a.slug },
      }),
    ),
  );
  out.stdout(`ALKALMAZVA: ${plan.assignments.length} webshop-slug\n`);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Ismeretlen hiba."}\n`,
      );
      await prisma.$disconnect();
      process.exit(1);
    });
}
