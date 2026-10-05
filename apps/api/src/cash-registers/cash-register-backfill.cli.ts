import { pathToFileURL } from "node:url";
import { prisma } from "@acropora/database";
import { NavConnectionRepository } from "../integrations/nav/nav-connection.repository.js";
import { NavCredentialCryptoService } from "../integrations/nav/nav-credential-crypto.service.js";
import { NavCredentialsService } from "../integrations/nav/nav-credentials.service.js";
import { OpgClient } from "./opg-client.js";
import { CashRegisterRepository } from "./cash-register.repository.js";
import { CashRegisterService, opgErrorCode } from "./cash-register.service.js";
export function parseArgs(args: readonly string[]) {
  const filtered = args.filter((a) => a !== "--");
  if (filtered.some((a) => a !== "--apply"))
    throw new Error("Használat: nav:opg-backfill [--apply]");
  return { apply: filtered.includes("--apply") };
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const service = new CashRegisterService(
    new OpgClient(),
    new NavCredentialsService(
      new NavConnectionRepository(),
      new NavCredentialCryptoService(),
    ),
    new CashRegisterRepository(),
  );
  if (args.apply)
    process.stdout.write(
      `${JSON.stringify(await service.sync("BACKFILL", true))}\n`,
    );
  else
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, registers: await service.plan() }, null, 2)}\n`,
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main()
    .catch((e) => {
      process.stderr.write(`${opgErrorCode(e)}\n`);
      process.exitCode = 2;
    })
    .finally(() => prisma.$disconnect());
