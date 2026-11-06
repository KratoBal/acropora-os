import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { GAME_PRIVACY_VERSION, GAME_RULES_VERSION } from "./game-consent.js";

/*
  WHAT TURNS THIS RED: the server's current text versions and the game page's (apps/jatek/src/lib/jogi-szovegek.ts, `VERZIO`)
  drifting apart. The page sends the versions it showed and the server takes only the current ones, so a drift would turn every
  entry away (a version bumped on one side only) or, worse, store a version the player never saw. The page and the server are
  two packages that deploy together; this reads the page's source, as the mobile route spec reads the web's.
*/
const PAGE = join(
  process.cwd(),
  "..",
  "jatek",
  "src",
  "lib",
  "jogi-szovegek.ts",
);

describe("the text versions of the entry's two acceptances", () => {
  const source = readFileSync(PAGE, "utf8");
  const page = (key: string) =>
    new RegExp(`${key}:\\s*"([^"]+)"`).exec(source)?.[1];

  it("the page and the server name the same version of the rules and of the privacy notice", () => {
    assert.equal(page("szabalyzat"), GAME_RULES_VERSION);
    assert.equal(page("adatkezeles"), GAME_PRIVACY_VERSION);
  });

  it("a version is a non-empty short label (it is stored on every entry)", () => {
    for (const version of [GAME_RULES_VERSION, GAME_PRIVACY_VERSION]) {
      assert.match(version, /^[a-z]+-\d+\.\d+$/);
      assert.ok(version.length <= 40);
    }
  });
});
