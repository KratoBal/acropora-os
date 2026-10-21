import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * NO REEFCLUB CODE READS THE REQUEST'S BODY, QUERY OR PARAMETERS STRAIGHT FROM THE REQUEST OBJECT
 * (barracuda, #1771 review; plan v6.1, 5.2/10).
 *
 * The id-field guard (reefclub-id-field-coverage.spec.ts) reads what the controllers take through
 * `@Body`, `@Query` and `@Param`, the validated path. A controller that read `request.query.x` or
 * `request.body.x` from `@Req()` would bypass it, and `forbidNonWhitelisted` too, which acts on the
 * DTO only. The ReefClub controllers use `@Req()` for the session and the cookie, and nothing in
 * src/reefclub reads a body, query, params or searchParams member today. This keeps it so: a new
 * read is red until it moves to a decorator (or is named here, with the reason).
 *
 * What turns this red: such a read in any non-spec file under src/reefclub; the reader finding
 * fewer files than it should (an empty read cannot pass); the pattern no longer matching its own
 * positive controls.
 */
const SOURCE = new URL("../../src/reefclub/", import.meta.url).pathname;

const DIRECT_READ =
  /\.(?:body|query|params|searchParams)\b|\[\s*["'](?:body|query|params)["']\s*\]|\{\s*(?:[\w\s,:]*,\s*)?(?:body|query|params)\s*[,}:]/;

/** Reads that are allowed, as `file: reason`. Empty today. */
const ALLOWED: Record<string, string> = {};

function sources(): { file: string; text: string }[] {
  return readdirSync(SOURCE)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"))
    .map((name) => ({ file: name, text: readFileSync(SOURCE + name, "utf8") }));
}

describe("ReefClub: a kérés törzse, lekérdezése és paraméterei csak dekorátoron át", () => {
  it("a minta a saját pozitív kontrolljain talál, a semleges sorokon nem", () => {
    for (const line of [
      "const id = request.query.id;",
      "const x = req.body.aquariumId;",
      'const y = request["params"];',
      "const { body } = request;",
      "const { headers, query } = req;",
      "new URL(request.url).searchParams.get('x')",
    ])
      assert.match(line, DIRECT_READ, line);
    for (const line of [
      "@Body() body: ReefClubRecordDoseDto,",
      "const token = request.cookies?.rc_session;",
      "const address = request.headers['x-forwarded-for'];",
      "@Query() query: ListDto,",
    ])
      assert.doesNotMatch(line, DIRECT_READ, line);
  });

  it("egyik nem-spec fájl sem olvas közvetlenül a kérésből", () => {
    const files = sources();
    assert.ok(
      files.length >= 20,
      `${files.length} fájl: a beolvasás nem lát semmit`,
    );
    const found: string[] = [];
    for (const { file, text } of files)
      text.split("\n").forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, "");
        if (/^\s*(\*|\/\*)/.test(line)) return;
        // a decorated parameter is the validated path, not a direct read
        if (/@(Body|Query|Param)\(/.test(code)) return;
        if (DIRECT_READ.test(code) && !(file in ALLOWED))
          found.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`);
      });
    assert.deepEqual(found, []);
  });
});
