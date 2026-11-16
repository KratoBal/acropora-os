import {
  ANONYMIZATION_KINDS,
  type AnonymizationKind,
} from "../anonymization-register.js";
import {
  checkRegister,
  outOfScopeFieldKeys,
  requiredFieldKeys,
  schemaFieldKeys,
  uniqueFieldKeys,
  type AnonymizationRegister,
} from "../anonymization-register-check.js";
import {
  createPrismaRunnerDatabase,
  type SqlClient,
} from "./prisma-adapter.js";
import {
  runAnonymization,
  type RunnerOptions,
  type RunnerResult,
} from "./runner.js";

/**
 * THE COMPOSITION OF A STAGE ANONYMIZATION RUN (stage anonymization chain, slice S6; card 07b56a1f). It reads nothing but the
 * schema text and the register, wires the Postgres adapter into the runner, and returns the runner's result. The command line
 * (`prisma/stage-anonymize.ts`) is only a shell around it that reads the keys and the connection from the environment.
 *
 * THE REGISTER IS CHECKED FIRST: a register that disagrees with the schema (a column without a decision, a decision for a column
 * that is gone) stops the run before a connection is used. The runner's own guard then refuses any database that is not a
 * temporary `stage_anon_tmp_...` one, so this function cannot be pointed at production or at the stage database either.
 *
 * MODELS THAT LOSE ROWS: a model with a REQUIRED field whose decision deletes (a secret column the row cannot live without) has
 * its rows dropped by the transformer, so its counts and pairings move on purpose. They are handed to the adapter as
 * `excludeModels`, and the gate's row count section is told per model how many were dropped.
 */

export interface StageRunInput {
  client: SqlClient;
  schema: string;
  register: AnonymizationRegister;
  pseudonymizationKey: string;
  scanKey: string;
  stagePasswordHash: string;
  trial?: RunnerOptions["trial"];
}

export async function runStageAnonymization(
  input: StageRunInput,
): Promise<RunnerResult> {
  const { schema } = input;
  const check = checkRegister(schema, input.register);
  if (check.problems.length > 0) {
    throw new Error(
      `the anonymization register does not match the schema (${check.problems.length} problem(s)); the first: ${check.problems[0]}`,
    );
  }
  const requiredFields = requiredFieldKeys(schema);
  const excludeModels = new Set<string>();
  for (const [key, decision] of check.decisions) {
    const kind = (
      ANONYMIZATION_KINDS as Readonly<Record<string, AnonymizationKind>>
    )[decision.kind];
    const deletes =
      kind !== undefined &&
      (kind.action === "delete" || kind.naturalPersonRows === "delete");
    if (deletes && requiredFields.has(key))
      excludeModels.add(key.slice(0, key.indexOf(".")));
  }
  const database = await createPrismaRunnerDatabase(input.client, schema, {
    excludeModels,
  });
  return runAnonymization({
    database,
    decisions: check.decisions,
    requiredFields,
    knownFields: schemaFieldKeys(schema),
    outOfScopeFields: outOfScopeFieldKeys(schema),
    uniqueFields: uniqueFieldKeys(schema),
    pseudonymizationKey: input.pseudonymizationKey,
    scanKey: input.scanKey,
    stagePasswordHash: input.stagePasswordHash,
    trial: input.trial,
  });
}

/**
 * WHAT THE COMMAND MAY PRINT ABOUT A FAILURE (barracuda, #2329). The runner's and the transformer's own messages name a field, a
 * kind and a count, never a value, so they print as they are. A DATABASE error is different: a raw SQL error carries the server's
 * DETAIL line (`Key ("email")=(...) already exists`), and on an unexpected failure that line can hold a real value, which would go
 * to the terminal and the host log. A Prisma client error therefore prints its NAME and CODE only.
 */
export function describeRunFailure(error: unknown): string {
  if (error instanceof Error && /^PrismaClient/.test(error.name)) {
    const code = (error as { code?: unknown }).code;
    return `${error.name}${typeof code === "string" ? ` ${code}` : ""} (the database's message is not printed: it can carry a value)`;
  }
  return error instanceof Error ? error.message : "the run failed";
}
