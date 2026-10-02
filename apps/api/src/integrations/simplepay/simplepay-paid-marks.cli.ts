import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  simplePayMarkPaidMode,
  simplePayPaidMarksDryRun,
} from "./simplepay-paid-marks.dry-run.js";

/**
 * A KÁRTYÁS SZÁMLÁK KIFIZETETT-JELÖLÉSÉNEK SZÁRAZ FUTÁSA A SIMPLEPAY
 * ELSZÁMOLÁSBÓL (Balázs, 2026-10-01; acrobot 25994). Kiírja, melyik saját
 * számlánkat jelölné kifizetettre a Számlázz.hu-ban (számla, összeg, dátum,
 * jogcím, megjegyzés), és melyik rendelést miért nem. SEMMIT NEM ÍR, a
 * Számlázz.hu-hoz nem fordul.
 *
 *   pnpm --filter @acropora/api simplepay:paid-marks -- --from 2026-09-01
 *   éles konténerben: node /app/dist/integrations/simplepay/simplepay-paid-marks.cli.js --from 2026-09-01
 *
 * Csak `SIMPLEPAY_MARK_PAID=dry` (vagy `live`) mellett fut; alapból KI.
 */
async function main(argv: readonly string[]): Promise<number> {
  const mode = simplePayMarkPaidMode(process.env.SIMPLEPAY_MARK_PAID);
  if (mode === "off") {
    process.stderr.write(
      "A SimplePay kifizetett-jelölés ki van kapcsolva (SIMPLEPAY_MARK_PAID=off); a száraz futáshoz: dry.\n",
    );
    return 1;
  }
  const at = argv.indexOf("--from");
  const from = at >= 0 ? argv[at + 1] : "2026-09-01";
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    process.stderr.write("A --from egy nap: YYYY-MM-DD.\n");
    return 2;
  }
  process.stdout.write(
    `SZÁRAZ futás (semmit nem ír), SimplePay-fizetések ${from} óta:\n`,
  );
  process.stdout.write(await simplePayPaidMarksDryRun(from));
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
