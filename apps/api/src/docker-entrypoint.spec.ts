import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * WHAT THE CONTAINER STARTS (`docker-entrypoint.sh`), measured by running the
 * script itself with a stand-in `node` first on the PATH that records its
 * arguments. The image's default is the internal API after the migrations;
 * `REEFCLUB_PROCESS=true` is the ReefClub process WITHOUT the migrations
 * (ReefClub plan v6.1, 2.1; slice 6: its database role may not run them).
 */
const SCRIPT = fileURLToPath(
  new URL("../docker-entrypoint.sh", import.meta.url),
);

function run(env: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "entrypoint-spec-"));
  try {
    const log = join(dir, "calls.log");
    const fake = join(dir, "node");
    writeFileSync(fake, `#!/bin/sh\necho "$*" >> "${log}"\nexit 0\n`);
    chmodSync(fake, 0o755);
    const result = spawnSync("sh", [SCRIPT], {
      env: { PATH: `${dir}:/usr/bin:/bin`, ...env },
      encoding: "utf8",
    });
    const calls = existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n")
      : [];
    // A failed start is reported with whatever `node` was called before it.
    return result.status === 0 ? calls : [`EXIT ${result.status}`, ...calls];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("docker-entrypoint.sh", () => {
  it("alapból migrál, és utána a belső API-t indítja", () => {
    const calls = run({});
    assert.equal(calls.length, 2);
    assert.match(calls[0]!, /docker-entrypoint-migrate\.cjs$/);
    assert.equal(calls[1], "dist/main.js");
  });

  it("REEFCLUB_PROCESS=true: csak a ReefClub-folyamat indul, migráció nélkül", () => {
    assert.deepEqual(run({ REEFCLUB_PROCESS: "true" }), [
      "dist/main-reefclub.js",
    ]);
  });

  it("ismeretlen vagy elgépelt érték: a konténer nem indul el, semmit nem futtat", () => {
    // Only the exit code: `node` was never called (no migration, no start).
    for (const value of ["True", "reefclub", "1", "false"])
      assert.deepEqual(run({ REEFCLUB_PROCESS: value }), ["EXIT 64"], value);
  });
});
