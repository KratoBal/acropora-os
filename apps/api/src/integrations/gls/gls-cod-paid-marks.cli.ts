import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { runPaidMarksApply } from "../szamlazz/paid-marks-apply.cli.js";
import {
  glsCodMarkPaidMode,
  glsCodPaidMarksDryRun,
  loadGlsTransfers,
} from "./gls-cod-paid-marks.dry-run.js";
import { decideGlsTransfer, glsPaidMarkInputs } from "./gls-cod-paid-marks.js";

/**
 * A GLS UTÁNVÉT KIFIZETETT-JELÖLÉSÉNEK SZÁRAZ FUTÁSA (Balázs, GLS szál,
 * 2026-10-01; acrobot 25883). Kiírja, melyik saját számlánkat jelölné
 * kifizetettre a Számlázz.hu-ban (számla, összeg, dátum, jogcím, megjegyzés),
 * és melyiket miért nem. SEMMIT NEM ÍR, a Számlázz.hu-hoz nem fordul.
 *
 *   pnpm --filter @acropora/api gls:paid-marks -- --from 2026-09-01
 *   éles konténerben: node /app/dist/integrations/gls/gls-cod-paid-marks.cli.js --from 2026-09-01
 *
 * Csak `GLS_COD_MARK_PAID=dry` (vagy `live`) mellett fut; alapból KI.
 *
 * ÉLES ÍRÁS (acrobot 25989, 25993): CSAK `GLS_COD_MARK_PAID=live` ÉS `--apply`
 * ÉS `--invoices <szám,szám,...>` együtt. Csak a felsorolt, Balázs által
 * jóváhagyott számlákat írja; a többi jelölhetőhöz nem nyúl.
 *
 *   node /app/dist/integrations/gls/gls-cod-paid-marks.cli.js --from 2026-09-17 \
 *     --apply --invoices ACRW-2026/00479,ACRW-2026/00481,ACRW-2026/00485
 */
async function main(argv: readonly string[]): Promise<number> {
  const mode = glsCodMarkPaidMode(process.env.GLS_COD_MARK_PAID);
  if (mode === "off") {
    process.stderr.write(
      "A GLS kifizetett-jelölés ki van kapcsolva (GLS_COD_MARK_PAID=off); a száraz futáshoz: dry.\n",
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
      switchName: "GLS_COD_MARK_PAID",
      source: "GLS_COD",
      what: `GLS utalások ${from} óta`,
      loadMarks: async () =>
        glsPaidMarkInputs(
          (await loadGlsTransfers(from)).map((t) => decideGlsTransfer(t)),
        ),
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });
  process.stdout.write(
    `SZÁRAZ futás (semmit nem ír), GLS utalások ${from} óta:\n`,
  );
  process.stdout.write(await glsCodPaidMarksDryRun(from));
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
