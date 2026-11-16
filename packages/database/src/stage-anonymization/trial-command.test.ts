import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SqlClient } from "./prisma-adapter.js";
import { createTrialCommand } from "./trial-command.js";

/*
  THE TRIAL COMMAND AS THE ANONYMIZATION COMMAND RUNS IT (S-trial). WHAT TURNS THIS RED: a connection to the temporary database left
  open when the copy is made; a trial that gets the operator's whole environment (the keys); a trial that runs on the swap
  candidate instead of the copy; a copy left behind; a copy that cannot be made and a trial that passes; a result read from anything
  but the last stdout line.
*/
const DATABASE_URL =
  "postgresql://u:p@localhost:5432/stage_anon_tmp_x?schema=public";
const events: string[] = [];
function admin(
  failCreate = false,
): SqlClient & { $disconnect(): Promise<void> } {
  return {
    $queryRawUnsafe: async () => [] as never,
    $executeRawUnsafe: async (sql: string) => {
      events.push(sql.replace(/ WITH \(FORCE\)/, ""));
      if (failCreate && sql.startsWith("CREATE DATABASE"))
        throw new Error(
          "server says: source database is being accessed by other users",
        );
      return 0;
    },
    $disconnect: async () => {
      events.push("admin disconnected");
    },
  };
}
const NODE = process.execPath;
/** A command that prints, as its single check, the sorted names of its environment variables and its DATABASE_URL. */
const dump = [
  NODE,
  "-e",
  `console.log("progress line"); console.log(JSON.stringify({checks:[{name: Object.keys(process.env).sort().join(",") + "|" + process.env.DATABASE_URL, passed:true}]}))`,
] as const;

describe("createTrialCommand", () => {
  it("closes its own connections first, runs the command on the COPY with a small environment, and drops the copy", async () => {
    events.length = 0;
    const saved = { ...process.env };
    process.env.STAGE_ANON_PSEUDONYM_KEY = "kulcs-ami-nem-mehet-1";
    process.env.UNAS_API_KEY = "masik-kulcs-ami-nem-mehet";
    try {
      const result = await createTrialCommand({
        databaseUrl: DATABASE_URL,
        disconnect: async () => {
          events.push("client disconnected");
        },
        openAdmin: () => admin(),
        command: dump,
        password: "stage-jelszo-nem-igazi-1", // scan-secrets: allow (an invented test string, not a credential)
        redisUrl: "redis://localhost:6379",
        path: process.env.PATH,
      })();
      assert.equal(result.passed, true);
      const [name] = (result.checks ?? []).map((c) => c.name);
      const [keys, url] = name!.split("|");
      assert.equal(events[0], "client disconnected");
      assert.deepEqual(events.slice(1), [
        'DROP DATABASE IF EXISTS "stage_anon_tmp_x_trial"',
        'CREATE DATABASE "stage_anon_tmp_x_trial" TEMPLATE "stage_anon_tmp_x"',
        'DROP DATABASE IF EXISTS "stage_anon_tmp_x_trial"',
        "admin disconnected",
      ]);
      assert.match(
        url!,
        /\/stage_anon_tmp_x_trial\?schema=public$/,
        "the copy, not the swap candidate",
      );
      const names = keys!.split(",");
      assert.ok(
        names.includes("DATABASE_URL") &&
          names.includes("STAGE_TRIAL_PASSWORD") &&
          names.includes("REDIS_URL"),
      );
      for (const secret of [
        "STAGE_ANON_PSEUDONYM_KEY",
        "UNAS_API_KEY",
        "STAGE_ANON_SCAN_KEY",
      ])
        assert.ok(!names.includes(secret), secret);
    } finally {
      for (const key of ["STAGE_ANON_PSEUDONYM_KEY", "UNAS_API_KEY"])
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
  });

  it("fails the trial, with our message and no server text, when the copy cannot be made, and drops nothing it did not make", async () => {
    events.length = 0;
    const result = await createTrialCommand({
      databaseUrl: DATABASE_URL,
      disconnect: async () => undefined,
      openAdmin: () => admin(true),
      command: dump,
    })();
    assert.equal(result.passed, false);
    assert.match(
      result.checks?.[0]?.name ?? "",
      /^trial: the trial copy of the temporary database could not be created/,
    );
    assert.ok(!JSON.stringify(result).includes("server says"));
    assert.equal(events.at(-1), "admin disconnected");
  });

  it("refuses a database that is not a temporary one (no copy, no command)", async () => {
    events.length = 0;
    const result = await createTrialCommand({
      databaseUrl: "postgresql://u:p@localhost:5432/acropora",
      disconnect: async () => undefined,
      openAdmin: () => admin(),
      command: dump,
    })();
    assert.equal(result.passed, false);
    assert.ok(!events.some((e) => e.startsWith("CREATE")));
  });

  it("gives no checks for a command that is not found, so the gate fails on 'reported no checks'", async () => {
    const result = await createTrialCommand({
      databaseUrl: DATABASE_URL,
      disconnect: async () => undefined,
      openAdmin: () => admin(),
      command: ["/nincs/ilyen/program"],
    })();
    assert.equal(result.passed, false);
    assert.deepEqual(result.checks, []);
  });
});
