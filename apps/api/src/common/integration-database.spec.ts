import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  databaseNameOf,
  integrationDatabaseGate,
} from "./integration-database.js";

const DEV_URL =
  "postgresql://acropora:acropora@acropora-postgres:5432/acropora";
const TEST_URL =
  "postgresql://acropora:acropora@acropora-postgres:5432/acropora_test?schema=public";
// Copied verbatim from .github/workflows/ci.yml. The first version of this
// gate accepted only `_test` and turned CI red, because CI's throwaway
// service container is named acropora_ci. Pinning the real string here means
// the workflow and the gate cannot drift apart silently again.
const CI_URL =
  "postgresql://acropora:acropora@localhost:5432/acropora_ci?schema=public";

describe("integrationDatabaseGate", () => {
  it("skips quietly when the suite was not opted into", () => {
    assert.deepEqual(integrationDatabaseGate({}), { mode: "skip" });
    assert.deepEqual(integrationDatabaseGate({ DATABASE_URL: DEV_URL }), {
      mode: "skip",
    });
  });

  it("runs against a database named for testing", () =>
    assert.deepEqual(
      integrationDatabaseGate({
        RUN_DB_INTEGRATION: "1",
        DATABASE_URL: TEST_URL,
      }),
      { mode: "run", database: "acropora_test" },
    ));

  it("accepts the database CI actually uses", () =>
    assert.deepEqual(
      integrationDatabaseGate({
        RUN_DB_INTEGRATION: "1",
        DATABASE_URL: CI_URL,
      }),
      { mode: "run", database: "acropora_ci" },
    ));

  it("refuses the ordinary development database rather than skipping", () => {
    const gate = integrationDatabaseGate({
      RUN_DB_INTEGRATION: "1",
      DATABASE_URL: DEV_URL,
    });
    assert.equal(gate.mode, "refuse");
    // Someone who asked for the integration suite and got silence would
    // assume it passed, so this must be loud.
    assert.ok(gate.mode === "refuse" && gate.reason.includes("acropora"));
  });

  it("refuses when opted in without a connection string", () =>
    assert.equal(
      integrationDatabaseGate({ RUN_DB_INTEGRATION: "1" }).mode,
      "refuse",
    ));

  it("refuses an unparsable connection string instead of assuming the best", () =>
    assert.equal(
      integrationDatabaseGate({
        RUN_DB_INTEGRATION: "1",
        DATABASE_URL: "not-a-url",
      }).mode,
      "refuse",
    ));

  it("refuses a URL with no database name", () =>
    assert.equal(
      integrationDatabaseGate({
        RUN_DB_INTEGRATION: "1",
        DATABASE_URL: "postgresql://acropora:acropora@acropora-postgres:5432/",
      }).mode,
      "refuse",
    ));

  it("is not fooled by the suffix appearing elsewhere in the URL", () =>
    assert.equal(
      integrationDatabaseGate({
        RUN_DB_INTEGRATION: "1",
        DATABASE_URL:
          "postgresql://acropora:acropora@db_test.example:5432/acropora",
      }).mode,
      "refuse",
    ));

  it("reads the database name without exposing credentials", () => {
    assert.equal(databaseNameOf(TEST_URL), "acropora_test");
    assert.equal(databaseNameOf(DEV_URL), "acropora");
    assert.equal(databaseNameOf("garbage"), null);
  });
});
