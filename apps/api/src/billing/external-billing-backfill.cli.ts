import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { SzamlazzFeedsRepository } from "../missing-invoices/szamlazz-feeds.repository.js";
import { SzamlazzFeedsService } from "../missing-invoices/szamlazz-feeds.service.js";

/**
 * A SZÁMLÁZZ.HU-BÓL KAPOTT KIMENŐ SZÁMLÁK VISSZATÖLTÉSE A SZÁMLÁZÁS LISTÁJÁBA
 * (acrobot 25812). A fogadó a kiadás UTÁN érkezett üzeneteket magától vetíti; ez
 * a parancs a már tárolt üzeneteket (2026-10-01-én 56 darab) veszi végig.
 *
 *   pnpm --filter @acropora/api billing:external-backfill
 *   éles konténerben: node /app/dist/billing/external-billing-backfill.cli.js
 *
 * IDEMPOTENS: ugyanazt a sort írja újra, ugyanabból az üzenetből; egy számla
 * sorát mindig a legkésőbb érkezett változata adja, bármilyen sorrendben fut.
 * Csak a vetítés-táblát írja, a nyers üzenethez nem nyúl.
 */
async function main(): Promise<number> {
  const repository = new SzamlazzFeedsRepository();
  const service = new SzamlazzFeedsService(repository, {});
  const counts: Record<string, number> = {};
  const messages = await repository.outgoingMessages();
  for (const message of messages) {
    const outcome = await service.intoBilling(
      message.externalId,
      message.sha256,
      message.body,
    );
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  process.stdout.write(
    `kimenő számla-üzenet: ${messages.length}; ${Object.entries(counts)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ")}\n`,
  );
  return counts.UNREADABLE ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause) => {
      process.stderr.write(`${String(cause)}\n`);
      process.exitCode = 2;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
