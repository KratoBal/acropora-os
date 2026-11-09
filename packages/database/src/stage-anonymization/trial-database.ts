import type { SqlClient } from "./prisma-adapter.js";
import type { ConnectionSettingState } from "./trial-integrations.js";

/**
 * WHAT THE TRIAL READS FROM THE DATABASE (task stage-anonim-proba): the four connection settings tables (which hold encrypted
 * credentials the anonymization sets to NULL), the device tokens, and which user the trial logs in as. Raw SQL over the same
 * `SqlClient` the adapter uses, with identifiers written here and checked against the schema by a test (a column that is not in the
 * schema would make a query fail, and a query that fails must not read as "nothing stored").
 */
export const CONNECTION_SETTING_TABLES = [
  {
    integration: "UNAS",
    table: "UnasConnectionSetting",
    columns: ["encryptedApiKey", "encryptionIv", "authenticationTag"],
  },
  {
    integration: "NAV",
    table: "NavConnectionSetting",
    columns: ["encryptedCredentials", "encryptionIv", "authenticationTag"],
  },
  {
    integration: "Számlázz",
    table: "SzamlazzConnectionSetting",
    columns: [
      "encryptedAgentKey",
      "agentKeyEncryptionIv",
      "agentKeyAuthenticationTag",
      "encryptedFinancialApiKey",
      "financialApiKeyEncryptionIv",
      "financialApiKeyAuthenticationTag",
    ],
  },
  {
    integration: "Medusa",
    table: "MedusaConnectionSetting",
    columns: ["encryptedApiKey", "encryptionIv", "authenticationTag"],
  },
] as const;

export interface TrialDatabase {
  connectionSettings(): Promise<ConnectionSettingState[]>;
  deviceTokenCount(): Promise<number>;
  /** The e-mail of a user the trial can log in as (an active OWNER or ADMIN with a password and no partner scope), or null. */
  loginEmail(): Promise<string | null>;
}

export const LOGIN_EMAIL_SQL = `SELECT "email" FROM "User" WHERE "role" IN ('OWNER', 'ADMIN') AND "isActive" AND "passwordHash" IS NOT NULL AND "customerId" IS NULL AND "supplierId" IS NULL ORDER BY ("role" = 'OWNER') DESC, "createdAt", "id" LIMIT 1`;

export const settingsSql = (
  table: string,
  columns: readonly string[],
): string =>
  `SELECT "credentialMode"::text AS "mode", (${columns
    .map((column) => `("${column}" IS NOT NULL)::int`)
    .join(" + ")}) AS "stored" FROM "${table}" ORDER BY "id"`;

export function createTrialDatabase(client: SqlClient): TrialDatabase {
  return {
    async connectionSettings() {
      const states: ConnectionSettingState[] = [];
      for (const { integration, table, columns } of CONNECTION_SETTING_TABLES) {
        const rows = await client.$queryRawUnsafe<
          { mode: string | null; stored: number | bigint | null }[]
        >(settingsSql(table, columns));
        // no row: the state is left out, and the measurement fails for it ("not read")
        if (rows.length === 0) continue;
        // EVERY row counts (barracuda, #2333): a second row that holds a secret must not slip past a measurement of the first only
        states.push({
          integration,
          credentialMode: rows[0]!.mode,
          storedCredentialColumns: rows.reduce(
            (sum, row) => sum + Number(row.stored ?? 0),
            0,
          ),
        });
      }
      return states;
    },
    async deviceTokenCount() {
      const rows = await client.$queryRawUnsafe<{ n: number | bigint }[]>(
        `SELECT COUNT(*)::int AS "n" FROM "DeviceToken"`,
      );
      return Number(rows[0]?.n ?? Number.NaN);
    },
    async loginEmail() {
      const rows =
        await client.$queryRawUnsafe<{ email: string }[]>(LOGIN_EMAIL_SQL);
      return rows[0]?.email ?? null;
    },
  };
}
