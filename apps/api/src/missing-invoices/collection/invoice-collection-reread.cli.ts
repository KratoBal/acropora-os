import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { SupplierInvoiceImportService } from "../../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";
import { INVOICE_COLLECTION_RULES_VERSION } from "./invoice-collection.config.js";
import { InvoiceCollectionRepository } from "./invoice-collection.repository.js";
import { InvoiceCollectionService } from "./invoice-collection.service.js";

/**
 * A MÁR LÁTOTT UNMATCHED LEVELEK ÚJRAÉRTÉKELÉSE A MAI SZABÁLYOKKAL (acrobot
 * 25750: a Hetzner- és a Kia-szabály a kiadás után csak az új levelekre hatott).
 *
 *   pnpm --filter @acropora/api invoice-collection:reread            (száraz)
 *   pnpm --filter @acropora/api invoice-collection:reread -- --apply
 *
 * ALAPBÓL SZÁRAZ: végigmegy a forrásokon, az UNMATCHED leveleket is újra
 * elolvassa, és kiírja, melyik fájl ítélete mi lenne; NEM ír semmit (futást,
 * ítéletet, dokumentumot). Az `--apply` egy rendes futás kényszerített
 * újraolvasással. Ugyanezt a következő ütemezett futás magától is megteszi, ha
 * a szabályok változata (INVOICE_COLLECTION_RULES_VERSION) azóta lépett.
 */
async function main(argv: readonly string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const ki = (text: string) => process.stdout.write(text);
  const service = new InvoiceCollectionService(
    new InvoiceCollectionRepository(),
    new SupplierInvoiceImportService(),
  );
  ki(
    `${apply ? "ÉLES" : "SZÁRAZ"} újraértékelés, szabályok: ${INVOICE_COLLECTION_RULES_VERSION}\n`,
  );
  const { counts, changes } = await service.reevaluate(apply);
  if (!apply) {
    // ami változna: más ítélet, mint eddig (az új levél is ide tartozik)
    const changed = changes.filter((c) => c.before !== c.after);
    ki(`változna: ${changed.length} fájl (látott: ${changes.length})\n`);
    for (const c of changed)
      ki(
        `  ${c.source}\t${c.externalId}\t${c.fileName}\t${c.before ?? "(új)"} -> ${c.after}${c.detail ? `\t${c.detail}` : ""}\n`,
      );
  }
  ki(
    `fájl ${counts.filesSeen}: tárolt ${counts.storedCount}, nem számla ${counts.notInvoiceCount}, ismeretlen ${counts.unmatchedCount}, már megvolt ${counts.duplicateCount}, hiba ${counts.failedCount}\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
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
