import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import { UNAS_WRITABLE_PRODUCT_FIELDS } from "../../imports/unas/unas-write-policy.js";

/*
  A KÉSZLET-KÖTÉS HATÁRAI (S1, kártya 8639ac2a; acrobot 41628/41631, polip 41630). MI PIROSÍT:
  ha az `attributeSetId` a bolti vetítésbe kerülne (a kötés webshop felé írás lenne); ha a UNAS-
  szinkron írhatná a mezőt; ha a termék-szerkesztés (`UpdateProductDto`) fogadná, azaz a
  UNAS-gazdájú termék őre a MEZŐN lazulna a VÉGPONT helyett; ha egy író végpont a külön
  jogosultság nélkül maradna. A mérők a forrásszöveget olvassák, pozitív kontrollal.
*/
const SRC = new URL("../../", import.meta.url).pathname.replace(
  /\/test-dist\//,
  "/src/",
);

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")
        ? [join(dir, entry.name)]
        : [],
  );
const text = (path: string) => readFileSync(join(SRC, path), "utf8");

describe("the attribute set binding stays out of the shop and off the UNAS rules", () => {
  it("the matcher finds the identifier (positive control)", () => {
    assert.ok(/attributeSet/i.test("data: { attributeSetId: x }"));
  });

  it("no source of the Medusa integration mentions the attribute set (it never reaches the projection)", () => {
    const sources = files(join(SRC, "integrations/medusa"));
    assert.ok(sources.length > 20, `walked ${sources.length} files`);
    const mentions = sources
      .filter((file) => /attributeSet/i.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    assert.deepEqual(mentions, []);
  });

  it("the UNAS sync cannot write it, and the product edit does not accept it", () => {
    assert.ok(
      !(UNAS_WRITABLE_PRODUCT_FIELDS as readonly string[]).includes(
        "attributeSetId",
      ),
    );
    assert.doesNotMatch(
      text("products/dto/update-product.dto.ts"),
      /attributeSet/i,
    );
    assert.doesNotMatch(
      text("products/product.repository.ts"),
      /attributeSetId\s*:\s*input/,
    );
  });

  it("both write routes need the dedicated permission", () => {
    for (const path of [
      "products/attributes/attribute.controller.ts",
      "products/attributes/product-attribute-set.controller.ts",
    ]) {
      const source = text(path);
      const writes = (source.match(/@(Post|Put|Patch|Delete)\(/g) ?? []).length;
      const guarded = (
        source.match(
          /RequirePermissions\(PERMISSIONS\.PRODUCTS_ATTRIBUTE_SET_MANAGE\)/g,
        ) ?? []
      ).length;
      assert.ok(writes >= 1, path);
      assert.equal(
        guarded,
        writes,
        `${path}: every write route carries the permission`,
      );
    }
  });
});
