import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * WHO WRITES A VARIANT'S OWN PRICE MUST ALSO WRITE ITS HISTORY (card edd0c25b, T4.1-D2).
 *
 * `recordOwnPrice` is the only writer of the own-price history. This spec makes the rule a
 * property of the tree instead of a sentence in a comment: every non-spec source file that
 * WRITES `sellingGrossPrice` (inside the argument of a Prisma `create`/`update`/`updateMany`/
 * `upsert`/`createMany`, or in a raw `SET`) must call `recordOwnPrice`. The price editor that
 * does not exist yet (D3) cannot be added without it.
 *
 * WHAT TURNS IT RED: a new file (or a new statement in a file) that writes the field and does
 * not call the writer; the takeover dropping its call. THE POSITIVE CONTROL: the scan must
 * find the takeover as a writer, otherwise a scan that finds nothing would pass for ever.
 */
/** the compiled spec runs from `test-dist/products/price-history/`: the sources are `apps/api/src` */
const SRC = new URL("../../../src/", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const FIELD = "sellingGrossPrice";
const WRITE_CALL = /\.(create|createMany|update|updateMany|upsert)\(/g;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "test-dist"].includes(entry.name)) continue;
      found.push(...sourceFiles(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".test.ts")
    )
      found.push(full);
  }
  return found;
}

/** Comments out: a comment that names the field is not a write. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** The text of the call's argument list, by balancing the parentheses. */
function argumentOf(text: string, openAt: number): string {
  let depth = 0;
  for (let i = openAt; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(openAt, i + 1);
  }
  return text.slice(openAt);
}

export function writesOwnPrice(text: string): boolean {
  const body = code(text);
  for (const match of body.matchAll(WRITE_CALL))
    if (argumentOf(body, match.index! + match[0].length - 1).includes(FIELD))
      return true;
  return new RegExp(`SET[^;]*"?${FIELD}"?`, "i").test(body);
}

export function callsWriter(text: string): boolean {
  return /\brecordOwnPrice\(/.test(code(text));
}

describe("the own-price history writer", () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: path.slice(SRC.length + 1),
    text: readFileSync(path, "utf8"),
  }));
  const writers = files.filter((f) => writesOwnPrice(f.text));

  it("finds the takeover among the writers of the field (positive control)", () => {
    assert.ok(
      writers.some((f) => f.path === "products/product.repository.ts"),
      `writers found: ${writers.map((f) => f.path).join(", ")}`,
    );
  });

  it("is blind to a read: a select or a mapping that names the field is not a write", () => {
    assert.equal(
      writesOwnPrice(
        `const v = await tx.productVariant.findMany({ select: { ${FIELD}: true } });`,
      ),
      false,
    );
    assert.equal(
      writesOwnPrice(`const dto = { ${FIELD}: variant.${FIELD} };`),
      false,
    );
    assert.equal(
      writesOwnPrice(
        `await tx.productVariant.updateMany({ where: { id }, data: { ${FIELD}: x } });`,
      ),
      true,
    );
    assert.equal(
      writesOwnPrice(`// tx.productVariant.update({ data: { ${FIELD}: 1 } })`),
      false,
    );
  });

  it("has every writer call recordOwnPrice in the same file", () => {
    const missing = writers.filter((f) => !callsWriter(f.text));
    assert.deepEqual(
      missing.map((f) => f.path),
      [],
      "these files write sellingGrossPrice without recordOwnPrice (own-price-history.ts)",
    );
  });
});
