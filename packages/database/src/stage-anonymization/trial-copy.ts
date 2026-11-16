import type { SqlClient } from "./prisma-adapter.js";
import { assertTemporaryDatabase } from "./runner.js";

/**
 * THE THROWAWAY COPY THE TRIAL RUNS ON (task stage-anonim-proba; acrobot 45177). The trial writes: a customer, a TESZT invoice, a
 * sale, a work sheet, a ticket. Those rows must not end up in the stage, and the temporary database IS the swap candidate, so the
 * trial runs on a COPY of it (`CREATE DATABASE ... TEMPLATE ...`), dropped afterwards, whatever happens in between. The swap
 * candidate is never written to by the trial.
 *
 * BOTH NAMES GO THROUGH THE RUNNER'S GUARD: the source and the copy (`<source>_trial`) must be `stage_anon_tmp_...` names, so this
 * cannot create, or DROP, a database that is not a temporary one (the DROP is the dangerous half, and it names only the copy).
 *
 * THE TEMPLATE MUST HAVE NO OTHER CONNECTION: Postgres refuses to copy a database somebody is connected to. The anonymization
 * command disconnects its client before it calls this; the message below says so, because the server's own message is a bare
 * "source database is being accessed by other users".
 */
export function trialCopyName(source: string): string {
  const copy = `${source}_trial`;
  assertTemporaryDatabase(source);
  assertTemporaryDatabase(copy);
  return copy;
}

export async function withTrialCopy<T>(
  admin: SqlClient,
  source: string,
  run: (copyName: string) => Promise<T>,
): Promise<T> {
  const copy = trialCopyName(source);
  // the names passed the guard, so they hold only [a-z0-9_] and are safe as quoted identifiers
  const drop = `DROP DATABASE IF EXISTS "${copy}" WITH (FORCE)`;
  await admin.$executeRawUnsafe(drop);
  try {
    await admin.$executeRawUnsafe(
      `CREATE DATABASE "${copy}" TEMPLATE "${source}"`,
    );
  } catch {
    throw new Error(
      "the trial copy of the temporary database could not be created: it must have no other connection, and the user needs the right to create a database",
    );
  }
  try {
    return await run(copy);
  } finally {
    await admin.$executeRawUnsafe(drop);
  }
}
