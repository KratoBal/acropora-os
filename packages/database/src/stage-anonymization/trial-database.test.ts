import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { SqlClient } from "./prisma-adapter.js";
import {
  CONNECTION_SETTING_TABLES,
  createTrialDatabase,
  LOGIN_EMAIL_SQL,
  settingsSql,
} from "./trial-database.js";

/*
  WHAT THE TRIAL READS FROM THE DATABASE (S-trial). WHAT TURNS THIS RED: a table or a column in a query that is not in the schema (a
  query that fails would read as "nothing stored"); a settings row that is missing taken for a clean one; a stored credential column
  counted as zero; a login user query that picks a partner-scoped, inactive or password-less user.
*/
const SCHEMA = readFileSync(
  new URL("../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const modelFields = (model: string): Set<string> => {
  const block = new RegExp(`\\nmodel ${model} \\{(.*?)\\n\\}`, "s").exec(
    SCHEMA,
  );
  assert.ok(block, `model ${model} exists`);
  return new Set(
    block[1]!
      .split("\n")
      .map((line) => /^\s+(\w+)\s+\S+/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );
};
const clientReturning = (
  rows: unknown[][],
): { client: SqlClient; queries: string[] } => {
  const queries: string[] = [];
  let i = 0;
  return {
    queries,
    client: {
      $queryRawUnsafe: async (sql: string) => {
        queries.push(sql);
        return (rows[i++] ?? []) as never;
      },
      $executeRawUnsafe: async () => 0,
    },
  };
};

describe("the identifiers the trial queries", () => {
  it("are all in the schema: the four settings tables with their credential columns and credentialMode, DeviceToken, and the User columns of the login query", () => {
    for (const { table, columns } of CONNECTION_SETTING_TABLES) {
      const fields = modelFields(table);
      assert.ok(fields.has("credentialMode") && fields.has("id"), table);
      for (const column of columns)
        assert.ok(fields.has(column), `${table}.${column}`);
    }
    assert.ok(modelFields("DeviceToken").size > 0);
    const user = modelFields("User");
    for (const column of [
      "email",
      "role",
      "isActive",
      "passwordHash",
      "customerId",
      "supplierId",
      "createdAt",
      "id",
    ])
      assert.ok(user.has(column), `User.${column}`);
  });

  it("cover every encrypted credential column the anonymization register deletes in those four tables (a new one must be counted)", () => {
    const register = readFileSync(
      new URL("../../src/anonymization-register.ts", import.meta.url),
      "utf8",
    );
    for (const { table, columns } of CONNECTION_SETTING_TABLES) {
      const block = new RegExp(`\\n  ${table}: \\{(.*?)\\n  \\},`, "s").exec(
        register,
      );
      assert.ok(block, `${table} in the register`);
      const secrets = [...block[1]!.matchAll(/\b(\w+): "secret"/g)].map(
        (m) => m[1]!,
      );
      assert.ok(secrets.length > 0, `${table} has secret columns`);
      assert.deepEqual([...columns].sort(), secrets.sort(), table);
    }
  });
});

describe("createTrialDatabase", () => {
  it("reads the mode and the count of stored credential columns per table, and leaves out a table with no row (the measurement then fails for it)", async () => {
    const { client, queries } = clientReturning([
      [{ mode: "ENV_FALLBACK", stored: 0 }],
      [],
      [{ mode: "DATABASE", stored: 2n }],
      [{ mode: "DISABLED", stored: null }],
    ]);
    const states = await createTrialDatabase(client).connectionSettings();
    assert.deepEqual(states, [
      {
        integration: "UNAS",
        credentialMode: "ENV_FALLBACK",
        storedCredentialColumns: 0,
      },
      {
        integration: "Számlázz",
        credentialMode: "DATABASE",
        storedCredentialColumns: 2,
      },
      {
        integration: "Medusa",
        credentialMode: "DISABLED",
        storedCredentialColumns: 0,
      },
    ]);
    assert.equal(queries.length, 4);
    assert.equal(
      queries[0],
      settingsSql("UnasConnectionSetting", [
        "encryptedApiKey",
        "encryptionIv",
        "authenticationTag",
      ]),
    );
    assert.match(
      queries[0]!,
      /\("encryptedApiKey" IS NOT NULL\)::int \+ \("encryptionIv" IS NOT NULL\)::int/,
    );
  });

  it("counts the device tokens, and an unreadable count is NaN (never zero)", async () => {
    assert.equal(
      await createTrialDatabase(
        clientReturning([[{ n: 3 }]]).client,
      ).deviceTokenCount(),
      3,
    );
    assert.ok(
      Number.isNaN(
        await createTrialDatabase(
          clientReturning([[]]).client,
        ).deviceTokenCount(),
      ),
    );
  });

  it("asks for an active owner or admin with a password and no partner scope, owners first", async () => {
    const { client, queries } = clientReturning([
      [{ email: "u1@teszt.acropora.invalid" }],
      [],
    ]);
    const db = createTrialDatabase(client);
    assert.equal(await db.loginEmail(), "u1@teszt.acropora.invalid");
    assert.equal(await db.loginEmail(), null);
    for (const part of [
      `"role" IN ('OWNER', 'ADMIN')`,
      `"isActive"`,
      `"passwordHash" IS NOT NULL`,
      `"customerId" IS NULL`,
      `"supplierId" IS NULL`,
      `("role" = 'OWNER') DESC`,
    ])
      assert.ok(LOGIN_EMAIL_SQL.includes(part), part);
    assert.equal(queries[0], LOGIN_EMAIL_SQL);
  });
});
