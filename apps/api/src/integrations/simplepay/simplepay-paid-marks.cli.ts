import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { runPaidMarksApply } from "../szamlazz/paid-marks-apply.cli.js";
import {
  loadSimplePayOrders,
  simplePayMarkPaidMode,
  simplePayPaidMarksDryRun,
} from "./simplepay-paid-marks.dry-run.js";
import {
  loadRefundsAfterMarks,
  loadSimplePayMarkedBefore,
  loadWrittenSimplePayMarks,
  simplePayMarksToWrite,
} from "./simplepay-paid-marks.live.js";
import { decideSimplePayOrder } from "./simplepay-paid-marks.js";
import { refundsAfterMarksReport } from "./simplepay-paid-marks.refunds.js";

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
 *
 * ÉLES ÍRÁS (acrobot 25997): CSAK `SIMPLEPAY_MARK_PAID=live` ÉS `--apply` ÉS
 * `--invoices <szám,szám,...>` együtt. Csak a felsorolt, Balázs által
 * jóváhagyott számlákat írja, a közös íróval (a GLS-sel azonos napló és
 * szabályok); a többi jelölhetőhöz nem nyúl.
 *
 *   node /app/dist/integrations/simplepay/simplepay-paid-marks.cli.js --from 2026-09-01 \
 *     --apply --invoices ACRW-2026/00512,ACRW-2026/00520
 *
 * Mindkét futás végén: ha egy MÁR BEÍRT jelölés rendelésére később
 * visszatérítés érkezett, listázza. Visszaírni nem ír semmit.
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
  if (argv.includes("--apply")) {
    // the shared gate (#1388): live switch, --invoices, key before the log
    const code = await runPaidMarksApply({
      argv,
      mode,
      switchName: "SIMPLEPAY_MARK_PAID",
      source: "SIMPLEPAY",
      what: `SimplePay-fizetések ${from} óta`,
      loadMarks: async () => {
        const decisions = (await loadSimplePayOrders(from)).orders.map(
          (order) => decideSimplePayOrder(order),
        );
        const markable = new Set(
          decisions.flatMap((d) => (d.markable ? [d.mark.invoiceNumber] : [])),
        );
        const { marks, markedBefore } = simplePayMarksToWrite({
          decisions,
          approved: markable,
          markedBefore: await loadSimplePayMarkedBefore(markable),
        });
        for (const number of markedBefore)
          process.stdout.write(
            `  ${number}\tkimarad: korábban már kapott SimplePay-jelölést, nem írtam\n`,
          );
        return marks;
      },
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });
    // 1 and 2: the gate stopped before anything ran
    if (code === 0 || code === 3)
      process.stdout.write(await refundsAfterWrittenMarks());
    return code;
  }
  process.stdout.write(
    `SZÁRAZ futás (semmit nem ír), SimplePay-fizetések ${from} óta:\n`,
  );
  process.stdout.write(await simplePayPaidMarksDryRun(from));
  process.stdout.write(await refundsAfterWrittenMarks());
  return 0;
}

const refundsAfterWrittenMarks = async () =>
  refundsAfterMarksReport(
    await loadRefundsAfterMarks(await loadWrittenSimplePayMarks()),
  );

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
