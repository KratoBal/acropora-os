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

  /*
    A KÖZVETETT ÚT IS ZÁRVA (barracuda, #2100 review): egy `products/` alatti modul, amit a
    vetítés importál, és ami a készletből számol valamit, a mezőt a boltba vihetné. A mérő a két
    belépőpont (a futtató és a termék-vetítés) RELATÍV importjainak tranzitív zárását járja be, és
    egyikben sem engedi az `attributeSet` szót. Mért állapot 2026-11-03-án: 70 fájl, egyik sem
    említi; az `attributes/` mappából csak a `public-fields.ts` érhető el (az attribútum-
    DEFINÍCIÓKAT olvassa, nem a készleteket).
  */
  const IMPORT = /(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g;

  const closureOf = (entries: string[]): string[] => {
    const seen = new Set<string>();
    const stack = entries.map((entry) => join(SRC, entry));
    while (stack.length) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const base = join(file, "..", match[1]!.replace(/\.js$/, ""));
        for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
          try {
            readFileSync(candidate);
            stack.push(candidate);
            break;
          } catch {
            /* not this candidate */
          }
        }
      }
    }
    return [...seen];
  };

  it("the import walker reaches a known transitive dependency (positive control)", () => {
    const reached = closureOf([
      "integrations/medusa/medusa-projection.runner.ts",
    ]).map((f) => relative(SRC, f));
    assert.ok(
      reached.includes(
        "integrations/medusa/medusa-product-knowledge.service.ts",
      ),
    );
    assert.ok(
      reached.includes("products/attributes/public-fields.ts"),
      "the transitive step is found",
    );
  });

  it("nothing the projection imports, directly or not, mentions the attribute set", () => {
    const reached = closureOf([
      "integrations/medusa/medusa-projection.runner.ts",
      "integrations/medusa/medusa-product-projection.service.ts",
    ]);
    assert.ok(reached.length > 40, `walked ${reached.length} files`);
    const mentions = reached
      .filter((file) =>
        /attributeSet|attribute-sets\.policy|attribute-set-admin/i.test(
          readFileSync(file, "utf8"),
        ),
      )
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
