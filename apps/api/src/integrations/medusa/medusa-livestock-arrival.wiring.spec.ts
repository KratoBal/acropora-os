import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
  THE RUNNER'S WIRING OF THE ARRIVAL KEY (V2.6 S3a). The runner assembles the product the service projects, and no unit spec runs
  it (it needs the whole database and the shop); the pure rule, the service's key line and the scheduler are each measured by
  their own specs, so the one link nothing else sees is "the runner asks for the arrivals and hands the rule's answer on".
  WHAT TURNS THIS RED: the select that no longer asks for the product's arrivals (the key would silently never go out); a select
  without the two filters (a cancelled arrival, or one a customer may not register for, would reach the rule's input and be left
  to it alone); the call that no longer passes the rule's answer on as `livestockArrival`.

  It reads the source WITHOUT its comments (a comment that still says the right words must not keep it green), and it is a
  weak instrument by nature: it proves the lines are there, not that the run works. The run itself is the test shop's.
*/
const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the projection runner hands the product's arrivals to the rule", () => {
  const runner = code("src/integrations/medusa/medusa-projection.runner.ts");

  it("asks for the product's arrivals that a customer may register for and that have not arrived", () => {
    // a window of the block, not a brace match: the guard must not depend on how the formatter breaks the lines
    const at = runner.indexOf("livestockArrivals: {");
    const select = at === -1 ? "" : runner.slice(at, at + 400);
    assert.notEqual(
      select,
      "",
      "the product select must ask for livestockArrivals",
    );
    assert.match(select, /preorderable:\s*true/);
    assert.match(
      select,
      /status:\s*\{\s*in:\s*\["ORDERED",\s*"IN_TRANSIT"\]\s*\}/,
    );
    assert.match(select, /expectedOn:\s*true/);
  });

  it("passes the rule's answer on as the product's livestockArrival", () => {
    assert.match(
      runner,
      /livestockArrival:\s*livestockArrivalMetadata\(\s*product\.livestockArrivals\s*\)/,
    );
  });
});
