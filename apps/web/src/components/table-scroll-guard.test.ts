/**
 * MINDEN NYERS TÁBLÁZAT GÖRGETŐ DOBOZBAN ÁLL, VAGY TELEFONON BLOKK (a 2026-11-19-i három hibakör mintája: egy doboz nélküli
 * táblázat vagy egy nem törő sor 390 pixelen az egész lapot oldalra tolta; itt a munkalap-lista dátumsora, #2758).
 *
 * A teszt az apps/web minden .tsx fájlját a TypeScript AST-jén olvassa, és minden `<table>`-ről megkérdezi: van-e ugyanabban a
 * fájlban görgető őse (`overflow-x-auto`, `overflow-auto`, `overflow-x-scroll`), vagy a saját osztálya telefonon blokká
 * teszi (`max-md:block`, mint a PilotDataTable és a jogosultság-tábla). A PilotDataTable a packages/ui-ban él, a saját dobozával.
 * MI PIROSIT: egy új vagy áthelyezett táblázat doboz nélkül. A KIVÉTELEK névvel és okkal állnak; új kivétel döntés, nem kerülőút.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const KIVETEL: Record<string, string> = {
  "components/service-assets/asset-list-print-page.tsx":
    "nyomtatási lap: papírra megy, nem telefonra",
  "components/imports/unas-import-wizard.tsx":
    "UNAS-import: a munka iránya szerint óvatos terület, a két táblázata külön döntésre vár",
};

const tsxUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxUnder(p);
    return name.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(name)
      ? [p]
      : [];
  });
const tagOf = (n: ts.Node): string | null =>
  ts.isJsxElement(n)
    ? n.openingElement.tagName.getText()
    : ts.isJsxSelfClosingElement(n)
      ? n.tagName.getText()
      : null;
const classOf = (n: ts.Node): string => {
  const attrs = ts.isJsxElement(n)
    ? n.openingElement.attributes
    : ts.isJsxSelfClosingElement(n)
      ? n.attributes
      : null;
  const a = attrs?.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText() === "className",
  );
  return a?.initializer ? a.initializer.getText() : "";
};
const SCROLL =
  /(^|[\s"'`])(overflow-x-auto|overflow-auto|overflow-x-scroll)([\s"'`]|$)/;

function unboxedTables(): { unboxed: string[]; total: number } {
  const unboxed: string[] = [];
  let total = 0;
  for (const file of tsxUnder(SRC)) {
    const rel = relative(SRC, file);
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (n: ts.Node) => {
      if (tagOf(n) === "table") {
        total += 1;
        let ok = /max-md:block/.test(classOf(n)) || rel in KIVETEL;
        for (let p = n.parent; p && !ok; p = p.parent)
          ok = tagOf(p) !== null && SCROLL.test(classOf(p));
        if (!ok)
          unboxed.push(
            `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`,
          );
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { unboxed, total };
}

describe("minden nyers táblázat görgető dobozban áll", () => {
  it("nincs doboz nélküli <table> az apps/web-ben (a kivételeken kívül)", () => {
    const { unboxed, total } = unboxedTables();
    expect(total).toBeGreaterThan(20);
    expect(unboxed).toEqual([]);
  });
});
