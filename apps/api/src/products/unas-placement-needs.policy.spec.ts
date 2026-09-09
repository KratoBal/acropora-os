import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("UNAS does not own placement needs", () => {
  it("has no fenyIgeny or aramlasIgeny write/calculation path", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/imports/unas/unas-apply.repository.ts"),
      "utf8",
    );

    assert.doesNotMatch(source, /\b(?:fenyIgeny|aramlasIgeny)\b/);
  });
});
