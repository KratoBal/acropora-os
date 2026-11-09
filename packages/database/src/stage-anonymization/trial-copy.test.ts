import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SqlClient } from "./prisma-adapter.js";
import { trialCopyName, withTrialCopy } from "./trial-copy.js";

/*
  THE THROWAWAY COPY (S-trial). WHAT TURNS THIS RED: a copy or a DROP of a database that is not a temporary one; a copy left behind
  when the trial throws; a DROP that does not name only the copy; a create that fails with the server's own message (it can carry
  a name or a value) instead of ours.
*/
function fakeAdmin(failCreate = false) {
  const statements: string[] = [];
  const client: SqlClient = {
    $queryRawUnsafe: async () => [] as never,
    $executeRawUnsafe: async (sql: string) => {
      statements.push(sql);
      if (failCreate && sql.startsWith("CREATE DATABASE"))
        throw new Error(
          'source database "stage_anon_tmp_x" is being accessed by other users',
        );
      return 0;
    },
  };
  return { client, statements };
}

describe("withTrialCopy", () => {
  it("drops a leftover, creates the copy from the template, runs, and drops the copy: in that order, naming only temporary databases", async () => {
    const { client, statements } = fakeAdmin();
    const result = await withTrialCopy(
      client,
      "stage_anon_tmp_x",
      async (copy) => {
        assert.equal(copy, "stage_anon_tmp_x_trial");
        assert.equal(
          statements.length,
          2,
          "the copy exists when the trial runs",
        );
        return 42;
      },
    );
    assert.equal(result, 42);
    assert.deepEqual(statements, [
      'DROP DATABASE IF EXISTS "stage_anon_tmp_x_trial" WITH (FORCE)',
      'CREATE DATABASE "stage_anon_tmp_x_trial" TEMPLATE "stage_anon_tmp_x"',
      'DROP DATABASE IF EXISTS "stage_anon_tmp_x_trial" WITH (FORCE)',
    ]);
  });

  it("drops the copy even when the trial throws, and passes the error on", async () => {
    const { client, statements } = fakeAdmin();
    await assert.rejects(
      withTrialCopy(client, "stage_anon_tmp_x", async () => {
        throw new Error("a trial that blew up");
      }),
      /a trial that blew up/,
    );
    assert.match(
      statements.at(-1)!,
      /^DROP DATABASE IF EXISTS "stage_anon_tmp_x_trial"/,
    );
  });

  it("says its own message when the copy cannot be created (not the server's, which names a database), and runs nothing", async () => {
    const { client } = fakeAdmin(true);
    let ran = false;
    await assert.rejects(
      withTrialCopy(client, "stage_anon_tmp_x", async () => {
        ran = true;
      }),
      (error: Error) =>
        error.message.startsWith("the trial copy") &&
        !error.message.includes("stage_anon_tmp_x"),
    );
    assert.equal(ran, false);
  });

  it("refuses a source that is not a temporary database, and a name whose copy would not be one, before any statement", async () => {
    for (const source of [
      "acropora",
      "acropora_stage",
      "stage_anon_tmp_",
      "stage_anon_tmp_x; drop database acropora",
      `stage_anon_tmp_${"a".repeat(36)}`,
    ]) {
      const { client, statements } = fakeAdmin();
      await assert.rejects(
        withTrialCopy(client, source, async () => undefined),
        /temporary database/,
        source,
      );
      assert.deepEqual(statements, [], source);
    }
    assert.equal(trialCopyName("stage_anon_tmp_a"), "stage_anon_tmp_a_trial");
  });
});
