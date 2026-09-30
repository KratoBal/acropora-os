import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { NavConnectionRepository } from "../../integrations/nav/nav-connection.repository.js";
import { NavCredentialCryptoService } from "../../integrations/nav/nav-credential-crypto.service.js";
import { NavCredentialsService } from "../../integrations/nav/nav-credentials.service.js";
import { NavOnlineInvoiceClient } from "../../integrations/nav/nav-online-invoice.client.js";
import { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";
import { NavIncomingInvoiceService } from "./nav-incoming-invoice.service.js";

/**
 * A BEJÖVŐ NAV-SZÁMLÁK VISSZATÖLTÉSE (acrobot, 2026-09-30).
 *
 *   pnpm --filter @acropora/api nav:backfill -- --from=2026-01-01
 *   pnpm --filter @acropora/api nav:backfill -- --from=2026-01-01 --apply
 *
 * ALAPBÓL SZÁRAZ: lekérdezi a NAV-ot, ablakonként kiírja, hány számla jönne
 * létre, és semmit nem ír. Csak az `--apply` ír, és a napi szinkron kurzorához
 * akkor sem nyúl. Előtte és utána kiírja a `NavIncomingInvoice` darabszámát.
 */
export function parseArgs(argv: readonly string[]): {
  from: Date;
  to: Date | undefined;
  apply: boolean;
} {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  const day = (text: string | undefined, name: string) => {
    if (text === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
      throw new Error(`A --${name} alakja ÉÉÉÉ-HH-NN, nem ${text}.`);
    return new Date(`${text}T00:00:00.000Z`);
  };
  const from = day(value("from"), "from");
  if (!from) throw new Error("Kötelező: --from=ÉÉÉÉ-HH-NN.");
  return { from, to: day(value("to"), "to"), apply: argv.includes("--apply") };
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const ki = (text: string) => process.stdout.write(text);
  const service = new NavIncomingInvoiceService(
    new NavOnlineInvoiceClient(),
    new NavCredentialsService(
      new NavConnectionRepository(),
      new NavCredentialCryptoService(),
    ),
    new NavIncomingInvoiceRepository(),
  );

  const before = await prisma.navIncomingInvoice.count();
  ki(
    `${args.apply ? "ÉLES" : "SZÁRAZ"} visszatöltés ${args.from.toISOString().slice(0, 10)}-tól; NavIncomingInvoice előtte: ${before}\n`,
  );
  const results = await service.backfill({
    from: args.from,
    to: args.to,
    dryRun: !args.apply,
    onWindow: (window) =>
      ki(
        `  ${window.windowStart.slice(0, 10)} .. ${window.windowEnd.slice(0, 10)}  látott ${window.invoicesSeen}, ${window.dryRun ? "jönne létre" : "létrejött"} ${window.createdCount}, kihagyva ${window.skippedCount}\n`,
      ),
  });
  const after = await prisma.navIncomingInvoice.count();
  const created = results.reduce((sum, window) => sum + window.createdCount, 0);
  ki(
    `${results.length} ablak; ${args.apply ? "létrejött" : "jönne létre"} ${created}; NavIncomingInvoice utána: ${after}\n`,
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
