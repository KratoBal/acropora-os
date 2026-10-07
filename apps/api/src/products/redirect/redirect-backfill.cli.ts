import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  describeRedirectBackfill,
  planRedirectBackfill,
} from "./redirect-backfill.js";

/**
 * AZ ÁTIRÁNYÍTÁS-BACKFILL PARANCSA (SEO P0 PR 6). Alapból SZÁRAZFUTÁS: kiírja a
 * jelentést, és nem ír. `--apply` mellett a memóriabeli futás naplója (új
 * szabályok és a lánc-összevonás módosításai) egy tranzakcióban íródik ki. Ha a
 * jelentés láncot vagy elutasítást mutat, az `--apply` nem ír: előbb a jelentés.
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
  const [termekek, meglevo] = await Promise.all([
    db.product.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        channelListings: {
          where: { channel: { in: ["UNAS", "WEBSHOP"] } },
          select: { channel: true, productUrl: true, slug: true },
        },
      },
    }),
    db.urlRedirect.findMany({
      select: {
        id: true,
        sourcePath: true,
        destinationPath: true,
        isActive: true,
      },
    }),
  ]);
  const { store, report } = await planRedirectBackfill(
    termekek.map((t) => ({
      id: t.id,
      unasUrl:
        t.channelListings.find((c) => c.channel === "UNAS")?.productUrl ?? null,
      webshopSlug:
        t.channelListings.find((c) => c.channel === "WEBSHOP")?.slug ?? null,
    })),
    meglevo,
  );
  out.stdout(describeRedirectBackfill(report));
  if (!args.includes("--apply")) {
    out.stdout("SZARAZFUTAS: semmi nem irodott. Alkalmazas: --apply\n");
    return 0;
  }
  if (report.refused.length || report.invariantViolations.length) {
    out.stderr(
      "NEM IRTAM: a jelentes elutasitott szabalyt vagy lancot mutat.\n",
    );
    return 1;
  }
  const ujak = store.created();
  const modositasok = store.updated();
  await db.$transaction([
    ...(ujak.length ? [db.urlRedirect.createMany({ data: ujak })] : []),
    ...modositasok.map((m) =>
      db.urlRedirect.update({ where: { id: m.id }, data: m.data }),
    ),
  ]);
  out.stdout(
    `ALKALMAZVA: ${ujak.length} uj szabaly, ${modositasok.length} modositott\n`,
  );
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
