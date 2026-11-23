import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/*
  THE INSTALL IS NOT OLDER THAN THE PACKAGE LIST (acrobot 58477, murena 58483). For weeks, PR after PR reported "6 known
  environmental failures" in the API unit suite (app.bootstrap, three teaching-output specs, OCR). They were not environmental
  and not six: one clone's node_modules was older than the lock, and two declared packages were missing (`pptxgenjs`,
  `tesseract.js`). Each showed up as an unrelated ERR_MODULE_NOT_FOUND in whatever imported it, and a list of failures everyone
  has learned to skip is where a seventh, real one hides.

  This names the cause once, in one line: every package `apps/api/package.json` declares has its folder in `node_modules`.
  WHAT TURNS IT RED: an install older than the package list (fix: `pnpm install --frozen-lockfile` at the repo root). The path
  is the package root's: the compiled suite runs from `apps/api`, like the other specs that read `src/...`.
*/
describe("the installed packages", () => {
  it("every dependency apps/api/package.json declares is installed", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    });
    const missing = declared.filter(
      (name) => !existsSync(join("node_modules", name, "package.json")),
    );
    assert.deepEqual(
      missing,
      [],
      `node_modules is older than apps/api/package.json, missing: ${missing.join(", ")}. ` +
        "Run `pnpm install --frozen-lockfile` at the repository root; the failures that import these are the same cause.",
    );
    // a positive control: the list is read and the check sees installed packages (an empty list would pass anything)
    assert.ok(declared.length > 10, `only ${declared.length} declared`);
  });
});
