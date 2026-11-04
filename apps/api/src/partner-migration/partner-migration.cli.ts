import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

import { describeTarget } from "../common/database-target.js";

import { PartnerDuplicateRepository } from "../partner-duplicates/partner-duplicate-report.service.js";
import {
  applyOperations,
  restoreRegistered,
} from "./partner-migration.executor.js";
import {
  decideOperations,
  type BindChoices,
  type MigrationDecisions,
} from "./partner-migration-run.js";
import {
  PartnerMigrationPlanService,
  PartnerMigrationSuppliers,
} from "./partner-migration.service.js";

/**
 * A PARTNEREK EGYSZERI ÁTVEZETÉSE A TÖRZSBE (partnertörzs) -- EGYSZER FUTÓ PARANCS.
 *
 * Használat:
 *   pnpm --filter @acropora/api partner:migrate                                  # TERV és LENYOMAT, írás nélkül
 *   pnpm --filter @acropora/api partner:migrate --apply --fingerprint <lenyomat>  # az írás, a terv lenyomatával
 *   pnpm --filter @acropora/api partner:migrate --bind KÓD=VEVŐ-AZONOSÍTÓ        # kifejezett döntés (többször is)
 *   pnpm --filter @acropora/api partner:migrate --restore                         # mit állítana vissza (írás nélkül)
 *   pnpm --filter @acropora/api partner:migrate --restore --apply                 # a visszaállítás
 *
 * AZ ALAPÉRTELMEZÉS A TERV, ÉS A LENYOMAT KÖTELEZŐ AZ ÍRÁSHOZ: az `--apply` csak azt hajtja végre, amit a próbafuttatás kiírt
 * (és amit a lista alapján jóváhagytak). Ha közben egy partner vagy egy vevő-sor változott, a lenyomat más, és az írás megáll.
 * Egy tranzakcióban fut: vagy minden partner átvezetődik, vagy semmi.
 *
 * A visszaállítás a `partner.registered` eseményekből dolgozik (partnerenként a legutolsó esemény dönt); a létrehozott sor csak akkor
 * törlődik, ha azóta semmi nem hivatkozik rá. A STAGE-PRÓBA SORRENDJE: próba, --apply, --restore (próba), --restore --apply, majd újra
 * --apply és --restore (ez fogja meg a többszöri átvezetést). Az ÉLES futás Balázs jelenlétében, a próba lenyomatával történik; a
 * futás célját minden kimenet első sora mondja ki.
 */
export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CliOptions {
  apply: boolean;
  restore: boolean;
  fingerprint: string | null;
  binds: BindChoices;
}

export function parseArgs(
  argv: readonly string[],
): CliOptions | { error: string } {
  const options: CliOptions = {
    apply: false,
    restore: false,
    fingerprint: null,
    binds: {},
  };
  const binds: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--apply") options.apply = true;
    else if (arg === "--restore") options.restore = true;
    else if (arg === "--fingerprint") {
      const value = argv[(i += 1)];
      if (!value || !/^[0-9a-f]{64}$/.test(value))
        return {
          error: "A --fingerprint egy 64 jegyű hexadecimális lenyomat.",
        };
      options.fingerprint = value;
    } else if (arg === "--bind") {
      const value = argv[(i += 1)] ?? "";
      const match = /^([^=\s]+)=([^=\s]+)$/.exec(value);
      if (!match)
        return { error: "A --bind alakja: --bind KÓD=VEVŐ-AZONOSÍTÓ." };
      if (binds[match[1]!] && binds[match[1]!] !== match[2])
        return {
          error: `A(z) ${match[1]} partnerre két különböző --bind döntés van.`,
        };
      binds[match[1]!] = match[2]!;
    } else return { error: `Ismeretlen kapcsoló: ${arg}.` };
  }
  options.binds = binds;
  if (options.restore && (options.fingerprint || Object.keys(binds).length))
    return { error: "A --restore mellé nem adható --fingerprint vagy --bind." };
  return options;
}

const OPERATION_LABEL = {
  CREATE: "ÚJ vevő-sor készül",
  BIND: "meglévő vevő-sorhoz kötjük",
  SKIP: "kimarad",
} as const;

export function describeDecisions(decisions: MigrationDecisions): string[] {
  const lines = decisions.operations.map((op) =>
    op.kind === "BIND"
      ? `  ${op.code}: ${OPERATION_LABEL.BIND}: ${op.customerId}`
      : op.kind === "SKIP"
        ? `  ${op.code}: ${OPERATION_LABEL.SKIP}: ${op.reason}`
        : `  ${op.code}: ${OPERATION_LABEL.CREATE}`,
  );
  const count = (kind: string) =>
    decisions.operations.filter((op) => op.kind === kind).length;
  return [
    `Partnerek: ${decisions.operations.length}; új vevő-sor: ${count("CREATE")}; kötés meglévőhöz: ${count("BIND")}; kimarad: ${count("SKIP")}.`,
    ...lines,
    ...decisions.problems.map((problem) => `  HIBA: ${problem}`),
    `LENYOMAT: ${decisions.fingerprint}`,
  ];
}

export async function runPartnerMigrationCli(
  argv: readonly string[],
  out: CliOutput,
): Promise<number> {
  const options = parseArgs(argv);
  if ("error" in options) {
    out.stderr(`${options.error}\n`);
    return 2;
  }
  out.stdout(`CÉL-ADATBÁZIS: ${describeTarget(process.env.DATABASE_URL)}\n`);
  const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
    prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 120_000,
      maxWait: 30_000,
    });

  if (options.restore) {
    const outcomes = await transaction((tx) =>
      restoreRegistered(tx, null, !options.apply),
    );
    out.stdout(
      `${options.apply ? "Visszaállítás" : "Visszaállítás (próba, nem ír)"}: ${outcomes.length} partner.\n`,
    );
    for (const outcome of outcomes)
      out.stdout(
        `  ${outcome.supplierId}: ${outcome.result}${outcome.detail ? ` (${outcome.detail})` : ""}\n`,
      );
    return 0;
  }

  const plan = await new PartnerMigrationPlanService(
    new PartnerMigrationSuppliers(),
    new PartnerDuplicateRepository(),
  ).build();
  const decisions = decideOperations(plan, options.binds);
  for (const line of describeDecisions(decisions)) out.stdout(`${line}\n`);
  if (decisions.problems.length) {
    out.stderr("A döntések hibásak: az írás nem indul.\n");
    return 1;
  }
  if (!options.apply) {
    out.stdout(
      "Próbafuttatás: semmi nem íródott. Az íráshoz: --apply --fingerprint <a fenti lenyomat>.\n",
    );
    return 0;
  }
  if (options.fingerprint !== decisions.fingerprint) {
    out.stderr(
      "A --fingerprint hiányzik vagy nem egyezik a mostani tervvel (közben változott valami?): az írás nem indul.\n",
    );
    return 1;
  }
  const outcomes = await transaction((tx) =>
    applyOperations(tx, decisions.operations, null),
  );
  const done = outcomes.filter((o) => o.mode !== "SKIPPED");
  out.stdout(`Kész: ${done.length} partner átvezetve (egy tranzakcióban).\n`);
  for (const outcome of done)
    out.stdout(
      `  ${outcome.code}: ${outcome.mode} ${outcome.customerId ?? ""}\n`,
    );
  out.stdout(
    "Visszaállítás (próba, nem ír): pnpm --filter @acropora/api partner:migrate --restore\n" +
      "Visszaállítás (az írás):       pnpm --filter @acropora/api partner:migrate --restore --apply\n",
  );
  return 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runPartnerMigrationCli(process.argv.slice(2), {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
