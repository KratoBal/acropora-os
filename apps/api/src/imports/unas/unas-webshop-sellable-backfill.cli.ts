import { pathToFileURL } from "node:url";
import { prisma } from "@acropora/database";
import {
  decideSellableBackfill,
  summarizeSellableBackfill,
  type SellableBackfillRow,
} from "./unas-webshop-sellable-backfill.js";

/** Csak a már UNAS-pillanatképpel rendelkező, leképezett termékeket olvassa. */
export async function runWebshopSellableBackfill(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { unasSnapshot: { isNot: null } },
    select: {
      id: true,
      webshopSellable: true,
      unasSnapshot: { select: { rawPayload: true } },
      channelListings: {
        where: { channel: "UNAS" },
        select: { externalStatus: true },
        take: 1,
      },
    },
  });
  const rows: SellableBackfillRow[] = products.map((product) => ({
    id: product.id,
    webshopSellable: product.webshopSellable,
    externalStatus: product.channelListings[0]?.externalStatus ?? null,
    rawPayload: product.unasSnapshot?.rawPayload as Record<string, unknown>,
  }));
  const decisions = decideSellableBackfill(rows);
  await prisma.$transaction(
    decisions
      .filter(
        (decision, index) =>
          decision.webshopSellable !== rows[index]!.webshopSellable,
      )
      .map((decision) =>
        prisma.product.update({
          where: { id: decision.id },
          data: { webshopSellable: decision.webshopSellable },
        }),
      ),
  );
  console.log(JSON.stringify(summarizeSellableBackfill(rows)));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runWebshopSellableBackfill();
  await prisma.$disconnect();
}
