import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DOWNLOAD_DIRECTORIES } from "./download-directories";

/*
  A LETÖLTÖTT FÁJLOK KIJELENTKEZÉSKOR TÖRLŐDNEK (barracuda kérdése a #2086-on, 2026-11-03: a számla PDF-je a telefonon
  maradt). MI PIROSÍT: ha egy letöltő a gyorsítótárban olyan könyvtárat nyit, aminek a neve nem a közös listából jön (azt a
  kijelentkezés nem törölné); ha a törlő nem a teljes listán megy végig; ha a kijelentkezés útja nem hívja a törlőt.
*/
const SRC = "src";

function forrasok(mappa: string): string[] {
  return readdirSync(mappa).flatMap((nev) => {
    const ut = join(mappa, nev);
    if (statSync(ut).isDirectory()) return forrasok(ut);
    return /\.tsx?$/.test(nev) && !/\.spec\./.test(nev) ? [ut] : [];
  });
}

/** A `new Directory(Paths.cache, X)` hívások második argumentuma, fájlonként. */
function gyorsitotarKonyvtarak(): {
  ut: string;
  arg: string;
  forras: string;
}[] {
  return forrasok(SRC).flatMap((ut) => {
    const forras = readFileSync(ut, "utf8");
    return [
      ...forras.matchAll(/new Directory\(\s*Paths\.cache\s*,\s*([^)]+?)\s*\)/g),
    ].map((m) => ({ ut, arg: m[1]!, forras }));
  });
}

/** Az argumentum a közös listából jön-e: közvetlenül, vagy egy ugyanabban a fájlban belőle képzett `const`-on át. */
function listabolJon(arg: string, forras: string): boolean {
  if (/^DOWNLOAD_DIRECTORIES\.\w+$/.test(arg)) return true;
  if (!/^\w+$/.test(arg)) return false;
  return new RegExp(`const ${arg} = DOWNLOAD_DIRECTORIES\\.\\w+;`).test(forras);
}

describe("a letöltött fájlok könyvtárai", () => {
  it("a mérő felismeri a listából jövő és a nem onnan jövő nevet (önteszt)", () => {
    assert.equal(listabolJon("DOWNLOAD_DIRECTORIES.attachments", ""), true);
    assert.equal(
      listabolJon("DIR", "const DIR = DOWNLOAD_DIRECTORIES.attachments;"),
      true,
    );
    assert.equal(
      listabolJon("DIR", 'const DIR = "uzenet-csatolmanyok";'),
      false,
    );
    assert.equal(listabolJon('"szamlak"', ""), false);
  });

  it("POZITÍV KONTROLL: a gyorsítótárba letöltő hívások megtalálhatók", () => {
    assert.ok(
      gyorsitotarKonyvtarak().length >= 2,
      "kevesebb mint két new Directory(Paths.cache, ...) hívást találtam: a keresés romlott el",
    );
  });

  it("minden gyorsítótár-könyvtár neve a közös listából jön", () => {
    const kivul = gyorsitotarKonyvtarak()
      // a törlő maga a listán megy végig (a ciklusváltozó a neve); azt a negyedik állítás méri
      .filter(
        (h) => !h.ut.endsWith(join("offline", "forget-downloaded-files.ts")),
      )
      .filter((h) => !listabolJon(h.arg, h.forras))
      .map((h) => `${h.ut}: ${h.arg}`);
    assert.deepEqual(kivul, [], "ezt a könyvtárat a kijelentkezés nem törölné");
  });

  it("a törlő a teljes listán megy végig, és a kijelentkezés útja hívja", () => {
    const torlo = readFileSync(
      join(SRC, "lib", "offline", "forget-downloaded-files.ts"),
      "utf8",
    );
    assert.match(
      torlo,
      /for \(const name of Object\.values\(DOWNLOAD_DIRECTORIES\)\)/,
    );
    assert.match(torlo, /directory\.delete\(\)/);
    const offline = readFileSync(
      join(SRC, "lib", "offline", "forget-offline-data.ts"),
      "utf8",
    );
    assert.match(offline, /await forgetDownloadedFiles\(\);/);
    // ELSŐ lépésként (barracuda, #2088): ha egy későbbi lépés eldob, a letöltött fájlok addigra már törlődtek
    const lepesek = [...offline.matchAll(/await (forget\w+)\(\);/g)].map(
      (m) => m[1],
    );
    assert.ok(
      lepesek.length >= 2,
      `kevés törlő lépést találtam: ${lepesek.join(", ")}`,
    );
    assert.equal(lepesek[0], "forgetDownloadedFiles");
    assert.ok(Object.keys(DOWNLOAD_DIRECTORIES).length >= 2);
  });
});
