import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * EVERY SETTING A DOCKERFILE DEMANDS AT BUILD TIME REACHES `next build`.
 *
 * Turbo runs in strict environment mode: a variable the `build` task does not
 * list under `env` is NOT passed to the task, however the Dockerfile set it.
 * The ReefClub web image then failed on the test Coolify with "REEFCLUB_API_URL
 * is required" although the build argument was given and the Dockerfile's own
 * `RUN test -n` passed: the CI stayed green only because a GitHub Actions
 * runner gets a placeholder (apps/reefclub/src/lib/api-url.ts).
 *
 * The names come from the Dockerfiles themselves (every `RUN test -n "$NAME"`,
 * the build guard each app's image carries), not from a list kept here, so the
 * next app with a required build setting is covered without anyone remembering.
 */
const REPO = new URL("../../../../", import.meta.url).pathname;

function requiredBuildSettings(): { app: string; name: string }[] {
  const apps = join(REPO, "apps");
  const found: { app: string; name: string }[] = [];
  for (const entry of readdirSync(apps, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dockerfile = join(apps, entry.name, "Dockerfile");
    if (!existsSync(dockerfile)) continue;
    for (const match of readFileSync(dockerfile, "utf8").matchAll(
      /^RUN test -n "\$([A-Z0-9_]+)"/gm,
    )) {
      found.push({ app: entry.name, name: match[1]! });
    }
  }
  return found;
}

describe("a build setting the Dockerfiles require is in turbo's build env", () => {
  const turbo = JSON.parse(readFileSync(join(REPO, "turbo.json"), "utf8")) as {
    tasks: { build: { env?: string[] } };
  };
  const listed = turbo.tasks.build.env ?? [];
  const required = requiredBuildSettings();

  it("the scan finds the known requirements (a wrong root would make every check below vacuous)", () => {
    const names = required.map((r) => `${r.app}:${r.name}`).sort();
    assert.deepEqual(names, [
      "partner:API_URL",
      "reefclub:REEFCLUB_API_URL",
      "web:API_URL",
    ]);
  });

  for (const { app, name } of required) {
    it(`${app}: ${name} is listed`, () => {
      assert.ok(
        listed.includes(name),
        `${app}'s Dockerfile requires ${name} at build time, but turbo.json build.env lists only ${listed.join(", ")}: turbo's strict env mode would not pass it to next build`,
      );
    });
  }
});
