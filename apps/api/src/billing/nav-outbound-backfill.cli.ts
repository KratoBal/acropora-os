import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { NavConnectionRepository } from "../integrations/nav/nav-connection.repository.js";
import { NavCredentialCryptoService } from "../integrations/nav/nav-credential-crypto.service.js";
import { NavCredentialsService } from "../integrations/nav/nav-credentials.service.js";
import { NavOnlineInvoiceClient } from "../integrations/nav/nav-online-invoice.client.js";
import {
  NavOutboundBackfill,
  parseNavOutboundArgs,
} from "./nav-outbound-backfill.js";

/**
 * A KIMENŐ SZÁMLÁK A NAV-BÓL, SZÁRAZON (kártya 785dfea6; lásd `nav-outbound-backfill.ts`).
 *
 *   pnpm --filter @acropora/api nav:outbound-backfill -- --from=2026-01-01 [--to=2026-11-20]
 *
 * CSAK OLVAS: a NAV OUTBOUND digestjét kérdezi kelt szerint, és ablakonként kiírja, mi van már meg (külső számla vagy az OS saját
 * számlája) és mi hiányzik, sorozatonként. Vevőnevet, adószámot és összeget nem ír ki. Kilépés: 0 lefutott; 2 rossz bemenet vagy a NAV
 * hibája (a hiba szövegével, például a 9-es: a technikai felhasználónak nincs joga a lekérdezéshez).
 */
async function main(argv: readonly string[]): Promise<number> {
  const args = parseNavOutboundArgs(argv);
  const ki = (text: string) => process.stdout.write(text);
  const backfill = new NavOutboundBackfill(
    new NavOnlineInvoiceClient(),
    new NavCredentialsService(
      new NavConnectionRepository(),
      new NavCredentialCryptoService(),
    ),
  );
  ki(
    `SZÁRAZ: kimenő számlák a NAV-ból, kelt ${args.from.toISOString().slice(0, 10)} .. ${args.to.toISOString().slice(0, 10)}\n`,
  );
  const results = await backfill.dryRun({
    from: args.from,
    to: args.to,
    onWindow: (w) =>
      ki(
        `  ${w.windowStart.slice(0, 10)} .. ${w.windowEnd.slice(0, 10)}  látott ${w.seen}, megvan (külső) ${w.presentExternal}, megvan (OS) ${w.presentOwn}, HIÁNYZIK ${w.missing}` +
          `, sztornó ${w.storno}, módosító ${w.modification}, magánszemély ${w.privatePerson}\n`,
      ),
  });
  const series = new Map<string, { seen: number; missing: number }>();
  for (const w of results)
    for (const [name, count] of Object.entries(w.bySeries)) {
      const total = series.get(name) ?? { seen: 0, missing: 0 };
      total.seen += count.seen;
      total.missing += count.missing;
      series.set(name, total);
    }
  ki(`sorozatonként:\n`);
  for (const [name, count] of [...series].sort(
    (a, b) => b[1].missing - a[1].missing || a[0].localeCompare(b[0]),
  ))
    ki(`  ${name}  látott ${count.seen}, hiányzik ${count.missing}\n`);
  const missing = results.flatMap((w) => w.missingNumbers);
  ki(
    `hiányzó számlaszámok (${missing.length}): ${missing.join(", ") || "nincs"}\n`,
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
