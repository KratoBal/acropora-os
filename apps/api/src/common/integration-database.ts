/**
 * Gate for database-backed integration specs.
 *
 * These specs create and delete rows, so pointing them at the wrong database
 * is the kind of mistake that only has to happen once. Opting in with
 * `RUN_DB_INTEGRATION=1` is therefore not enough on its own: the connection
 * string must also name a database dedicated to testing.
 *
 * The three outcomes are deliberately different:
 *
 * - not opted in            -> skip quietly (the established convention, so a
 *                              plain `pnpm test` stays fast and offline)
 * - opted in, test database -> run
 * - opted in, anything else -> refuse loudly. Someone who asked for the
 *                              integration suite and got silence would assume
 *                              it passed.
 */
/**
 * Suffixes that mark a database as existing to be written to and thrown away.
 *
 * `_ci` is here because the CI workflow's PostgreSQL service container is
 * named `acropora_ci` and is destroyed when the job ends - as disposable as a
 * database gets. Leaving it out turned CI red on the very commit that
 * introduced this gate, so the list is pinned by a test against the real
 * connection string from .github/workflows/ci.yml.
 */
export const TEST_DATABASE_SUFFIXES = ["_test", "_ci"] as const;

export type IntegrationDatabaseGate =
  | { mode: "skip" }
  | { mode: "run"; database: string }
  | { mode: "refuse"; reason: string };

export function integrationDatabaseGate(
  env: Record<string, string | undefined>,
): IntegrationDatabaseGate {
  if (env.RUN_DB_INTEGRATION !== "1") return { mode: "skip" };

  const url = env.DATABASE_URL;
  if (!url)
    return {
      mode: "refuse",
      reason:
        "RUN_DB_INTEGRATION=1 van beállítva, de a DATABASE_URL hiányzik. Az integrációs teszt saját adatbázist igényel.",
    };

  const database = databaseNameOf(url);
  if (!database)
    return {
      mode: "refuse",
      reason: `A DATABASE_URL-ből nem olvasható ki adatbázisnév, ezért nem állapítható meg, hogy teszt-adatbázisra mutat-e.`,
    };

  if (!TEST_DATABASE_SUFFIXES.some((suffix) => database.endsWith(suffix)))
    return {
      mode: "refuse",
      reason:
        `Az integrációs teszt "${database}" adatbázisra futna, aminek a neve nem ${TEST_DATABASE_SUFFIXES.map(
          (suffix) => `"${suffix}"`,
        ).join(" vagy ")} végű. ` +
        "Ezek a tesztek sorokat hoznak létre és törölnek, ezért kizárólag erre a célra létrehozott adatbázison futhatnak. " +
        "Lásd a CONTRIBUTING.md 'Integrációs tesztek' szakaszát.",
    };

  return { mode: "run", database };
}

/**
 * Parses only what is needed - the database name - without pulling the
 * credentials out of the URL or logging any part of it.
 */
export function databaseNameOf(url: string): string | null {
  try {
    const name = new URL(url).pathname.replace(/^\//, "");
    return name || null;
  } catch {
    return null;
  }
}
