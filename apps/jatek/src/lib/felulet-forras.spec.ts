import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/*
  FORRAS-OLVASO ORZOK (a partner csomag mintaja: a forras szoveget olvassak, nem renderelnek). Amit merik: hogy az
  api cime SEHOL nem kerul a bongeszonek szant kodba, es hogy a bongeszo csak a lap SAJAT /api utvonalait hivja.
  Amit NEM merik: hogy a futo szerver tenyleg igy viselkedik (azt a stage-en kell kiprobalni).
*/
// a `pnpm test` a csomag mappajabol fut: a forras a mappa `src` alatt van (nem a lefordult `test-dist`-ben)
const SRC = join(process.cwd(), "src");

const fajlok = (kony: string): string[] =>
  readdirSync(kony, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fajlok(join(kony, e.name)) : [join(kony, e.name)],
  );

describe("a felulet forrasa", () => {
  it("the api address and the fake switch are read only on the server (lib and route handlers), never in a component", () => {
    for (const f of fajlok(join(SRC, "components")).filter(
      (n) => n.endsWith(".tsx") && !n.endsWith(".spec.tsx"),
    )) {
      const szoveg = readFileSync(f, "utf8");
      assert.doesNotMatch(
        szoveg,
        /JATEK_API_URL|JATEK_ALLOW_FAKE|JATEK_PROXY_SECRET|process\.env/,
        f,
      );
    }
  });

  it("the browser components call only the page's own /api paths", () => {
    const hivasok = fajlok(join(SRC, "components"))
      .filter((n) => n.endsWith(".tsx") && !n.endsWith(".spec.tsx"))
      .flatMap((f) =>
        [...readFileSync(f, "utf8").matchAll(/fetch\(\s*"([^"]+)"/g)].map(
          (m) => m[1]!,
        ),
      );
    assert.ok(hivasok.length >= 2);
    for (const h of hivasok)
      assert.match(h, /^\/api\/(bekuldes|megerosites)$/, h);
  });

  it("the home page reads the week's question with the visitor's address (the GET needs it too: without it every visitor shares one rate bucket)", () => {
    const oldal = readFileSync(join(SRC, "app", "page.tsx"), "utf8");
    assert.match(
      oldal,
      /const ip = latogatoIp\(\s*\w+\.get\("x-forwarded-for"\)\s*,?\s*\)/,
    );
    assert.match(oldal, /api\.aktualis\(\s*ip\s*,?\s*\)/);
    assert.match(oldal, /api\.nyertesek\(\s*ip\s*,?\s*\)/);
  });
});
