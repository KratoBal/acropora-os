import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { HttpSzamlazzAgentClient } from "../szamlazz/szamlazz-agent.client.js";
import { SzamlazzConnectionRepository } from "../szamlazz/szamlazz-connection.repository.js";
import { SzamlazzCredentialCryptoService } from "../szamlazz/szamlazz-credential-crypto.service.js";
import { SzamlazzCredentialProvider } from "../szamlazz/szamlazz-credential.provider.js";
import {
  applyGlsPaidMarks,
  applyReport,
  prismaGlsPaidMarkStore,
} from "./gls-cod-paid-marks.apply.js";
import {
  glsCodMarkPaidMode,
  glsCodPaidMarksDryRun,
  loadGlsTransfers,
} from "./gls-cod-paid-marks.dry-run.js";
import { decideGlsTransfer } from "./gls-cod-paid-marks.js";

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
  if (argv.includes("--apply")) {
    if (mode !== "live") {
      process.stderr.write(
        "Az éles íráshoz GLS_COD_MARK_PAID=live kell; most: " + mode + ".\n",
      );
      return 1;
    }
    const at = argv.indexOf("--invoices");
    const approved = new Set(
      (at >= 0 ? (argv[at + 1] ?? "") : "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
    );
    if (approved.size === 0) {
      process.stderr.write(
        "Az --apply csak a jóváhagyott számlákra ír: --invoices <szám,szám,...>\n",
      );
      return 2;
    }
    const decisions = (await loadGlsTransfers(from)).map((t) =>
      decideGlsTransfer(t),
    );
    const credential = await new SzamlazzCredentialProvider(
      new SzamlazzConnectionRepository(),
      new SzamlazzCredentialCryptoService(),
    ).resolve();
    process.stdout.write(
      `ÉLES írás a Számlázz.hu-ba (kulcs: ${credential.revision}), GLS utalások ${from} óta, ${approved.size} jóváhagyott számla:\n`,
    );
    const lines = await applyGlsPaidMarks({
      decisions,
      approved,
      agentKey: credential.agentKey,
      client: new HttpSzamlazzAgentClient(),
      store: prismaGlsPaidMarkStore,
    });
    process.stdout.write(applyReport(lines, approved));
    return lines.some(
      (l) => l.outcome.kind === "FAILED" || l.outcome.kind === "UNKNOWN",
    )
      ? 3
      : 0;
  }
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
