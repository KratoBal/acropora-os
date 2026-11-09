import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeRunFailure } from "./stage-run.js";

/*
  THE FAILURE TEXT OF THE COMMAND (S6, barracuda #2329). WHAT TURNS THIS RED: a database error whose message carries a value
  (a Postgres DETAIL line) printed as it is; a Prisma error printed without its name or code (nothing to diagnose with); the
  runner's own value-free message swallowed (it is what the operator needs).
*/
class FakePrismaError extends Error {
  override name = "PrismaClientKnownRequestError";
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

describe("describeRunFailure", () => {
  it("prints a database error's name and code, and never its message (a DETAIL line can hold a real value)", () => {
    const text = describeRunFailure(
      new FakePrismaError(
        'Raw query failed. Code: `23505`. Message: `Key ("email")=(kovacs.bela@example.invalid) already exists.`',
        "P2010",
      ),
    );
    assert.match(text, /PrismaClientKnownRequestError P2010/);
    assert.ok(!text.includes("kovacs"));
    assert.ok(!text.includes("already exists"));
  });

  it("covers every Prisma client error by its name, with or without a code", () => {
    const init = new Error("Can't reach database server at host:5432");
    init.name = "PrismaClientInitializationError";
    const text = describeRunFailure(init);
    assert.match(text, /^PrismaClientInitializationError \(/);
    assert.ok(!text.includes("host:5432"));
  });

  it("prints the runner's and the transformer's own messages as they are (they carry a field and a count, never a value)", () => {
    assert.equal(
      describeRunFailure(
        new Error(
          "Customer.notes: a string value in a text field with no decision",
        ),
      ),
      "Customer.notes: a string value in a text field with no decision",
    );
    assert.equal(describeRunFailure("boom"), "the run failed");
  });
});
