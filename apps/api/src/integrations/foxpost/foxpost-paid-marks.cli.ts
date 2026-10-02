import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { runPaidMarksApply } from "../szamlazz/paid-marks-apply.cli.js";
import {
  foxpostMarkPaidMode,
  foxpostPaidMarksDryRun,
  loadFoxpostSettlements,
} from "./foxpost-paid-marks.dry-run.js";
import {
  decideFoxpostSettlement,
  foxpostPaidMarkInputs,
} from "./foxpost-paid-marks.js";

/**
 * A FOXPOST UTÁNVÉT KIFIZETETT-JELÖLÉSÉNEK SZÁRAZ FUTÁSA (Balázs, 2026-10-01
 * 21:35 UTC; acrobot 25993). Kiírja, melyik saját számlánkat jelölné
 * kifizetettre a Számlázz.hu-ban (számla, összeg, dátum, jogcím, megjegyzés),
 * és melyik sort miért nem. SEMMIT NEM ÍR, a Számlázz.hu-hoz nem fordul.
 *
 *   pnpm --filter @acropora/api foxpost:paid-marks -- --from 2026-09-01
 *   éles konténerben: node /app/dist/integrations/foxpost/foxpost-paid-marks.cli.js --from 2026-09-01
 *
 * Csak `FOXPOST_MARK_PAID=dry` (vagy `live`) mellett fut; alapból KI.
 *
 * ÉLES ÍRÁS (acrobot 26031), a GLS-szel azonos kapuval: CSAK
 * `FOXPOST_MARK_PAID=live` ÉS `--apply` ÉS `--invoices <szám,szám,...>`
 * együtt, a közös Számlázz.hu-hurokon át (`applyPaidMarks`, forrás FOXPOST).
 *
 *   FOXPOST_MARK_PAID=live node /app/dist/integrations/foxpost/foxpost-paid-marks.cli.js \
 *     --from 2026-09-01 --apply --invoices ACRW-2026/00470,ACRW-2026/00471
 */
async function main(argv: readonly string[]): Promise<number> {
  const mode = foxpostMarkPaidMode(process.env.FOXPOST_MARK_PAID);
  if (mode === "off") {
    process.stderr.write(
      "A Foxpost kifizetett-jelölés ki van kapcsolva (FOXPOST_MARK_PAID=off); a száraz futáshoz: dry.\n",
    );
    return 1;
  }
  const at = argv.indexOf("--from");
  const from = at >= 0 ? argv[at + 1] : "2026-09-01";
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    process.stderr.write("A --from egy nap: YYYY-MM-DD.\n");
    return 2;
  }
  if (argv.includes("--apply"))
    return runPaidMarksApply({
      argv,
      mode,
      switchName: "FOXPOST_MARK_PAID",
      source: "FOXPOST",
      what: `Foxpost elszámolások ${from} óta`,
      loadMarks: async () =>
        foxpostPaidMarkInputs(
          (await loadFoxpostSettlements(from)).map((s) =>
            decideFoxpostSettlement(s),
          ),
        ),
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });
  process.stdout.write(
    `SZÁRAZ futás (semmit nem ír), Foxpost elszámolások ${from} óta:\n`,
  );
  process.stdout.write(await foxpostPaidMarksDryRun(from));
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
