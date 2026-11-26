import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A FÁJLVÁLASZTÓ ÉS A FÁJL-MŰVELETEK A PARTNER PORTÁLON (picasso képernyő-leltár, 4. pont, P3 és P5; acrobot 62248).
 *
 * P3: a natív, stílus nélküli fájlválasztó helyett saját gomb (`FilePick`): a portálon nem maradhat LÁTHATÓ `<input type="file">`;
 * minden ilyen mező rejtett, és egy saját gomb vagy felirat nyitja. P5: a dokumentum-csempén a Megnyitás ugyanolyan látható, mint a
 * Letöltés (eddig halvány `ghost` gomb volt egy `secondary` mellett).
 *
 * A HATÁR: forrást olvas (a csomagban nincs renderelő, lásd portal-wiring.spec.ts). MI PIROSIT: egy fájl-mező `hidden` nélkül; a
 * dokumentum-panel vagy az új hibajegy nem a `FilePick`-et használja; a Megnyitás újra `ghost`.
 */
const components = readdirSync("src/components").filter((name) =>
  name.endsWith(".tsx"),
);
const read = (name: string) => readFileSync(`src/components/${name}`, "utf8");
/** The code without its block comments: a comment may quote `<input type="file">` itself. */
const code = (name: string) => read(name).replace(/\/\*[\s\S]*?\*\//g, "");

describe("P3: nincs látható natív fájlválasztó", () => {
  it("minden fájl-mező rejtett (a megnyitása saját gombé vagy feliraté)", () => {
    const inputs = components.flatMap((name) =>
      // up to the element's own "/>": an "=>" inside an onChange holds a ">" too
      (
        code(name).match(
          /<input\b(?:(?!\/>)[\s\S])*?type="file"(?:(?!\/>)[\s\S])*?\/>/g,
        ) ?? []
      ).map((input) => ({ name, input })),
    );
    // positive control: the measurement sees the inputs at all (file-pick, and the two pages with their own "kattints a tallózáshoz")
    assert.ok(inputs.length >= 3, `found ${inputs.length} file inputs`);
    for (const { name, input } of inputs)
      assert.match(
        input,
        /className="hidden"/,
        `${name}: ${input.slice(0, 100)}`,
      );
  });

  it("a dokumentum-panel és az új hibajegy a FilePick-kel választ", () => {
    for (const name of ["document-panel.tsx", "new-ticket.tsx"]) {
      const source = read(name);
      assert.match(source, /from "\.\/file-pick"/, name);
      assert.match(source, /<FilePick\b/, name);
      assert.doesNotMatch(source, /type="file"/, name);
    }
  });

  it("a FilePick üríti a rejtett mezőt, ha a választás üres (feltöltés után)", () => {
    assert.match(
      read("file-pick.tsx"),
      /if \(files\.length === 0 && input\.current\) input\.current\.value = "";/,
    );
  });
});

describe("P5: a dokumentum-csempe műveletei egyformán láthatók", () => {
  it("a Megnyitás és a Letöltés is secondary gomb", () => {
    const source = read("document-panel.tsx");
    const open = source.match(
      /<PilotButton\s+variant="(\w+)"[^>]*?onClick=\{\(\) => void fetchFile\(item, "open"\)\}/s,
    );
    const save = source.match(
      /<PilotButton\s+variant="(\w+)"[^>]*?onClick=\{\(\) => void fetchFile\(item, "save"\)\}/s,
    );
    assert.equal(save?.[1], "secondary");
    assert.equal(open?.[1], "secondary");
  });
});
