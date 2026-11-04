import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  applyShippingFill,
  describeShippingFill,
  planShippingFill,
} from "./shipping-profile-fill.js";

/**
 * A SZÁLLÍTÁSI JELZŐK EGYSZERI FELTÖLTÉSE A UNAS-BÓL (a82ed229). Minden UNAS-os
 * termék kap egy sort a UNAS mai beállításával, `UNAS` forrással; a kézzel
 * állított jelzőhöz nem nyúl. Alapból SZÁRAZFUTÁS: kiírja, mi változna, és hol
 * tér el a kézi érték a UNAS-étól. `--apply` mellett kötegenként, tranzakcióban.
 * Idempotens: egy második futás nulla változást ad. Ugyanezt a szabályt futtatja
 * a UNAS-szinkron is, minden futásnál (`applyUnasShippingFlags`).
 *
 *     node dist/products/shipping-profile-fill.cli.js [--apply]
 */
export type { ShippingFillReport } from "./shipping-profile-fill.js";
export { describeShippingFill } from "./shipping-profile-fill.js";

type Db = Parameters<typeof planShippingFill>[0];

export async function main(
  args: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  db: Db = prisma,
): Promise<number> {
  const ismeretlen = args.filter((a) => a !== "--apply");
  if (ismeretlen.length) {
    out.stderr(`Ismeretlen kapcsoló: ${ismeretlen.join(" ")} (csak --apply)\n`);
    return 1;
  }
  const apply = args.includes("--apply");
  // the same core as the admin endpoint (acrobot 42998): plan, then write the plan
  const { report, changes } = await planShippingFill(db);
  if (apply) await applyShippingFill(changes, db);
  out.stdout(describeShippingFill(report));
  out.stdout(
    apply
      ? `ALKALMAZVA: ${report.create} új sor, ${report.update} frissített\n`
      : "SZARAZFUTAS: semmi nem irodott. Alkalmazas: --apply\n",
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
