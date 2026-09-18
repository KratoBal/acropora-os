import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

import { describe, expect, it } from "vitest";

/**
 * Minden megírt teszt le is fusson.
 *
 * Ez a felület KÉT futtatóval dolgozik: a legtöbb teszt vitesttel megy (a
 * `vitest.config.ts` include listája szerint), a tiszta logikai modulok egy
 * része viszont a node beépített futtatójával, és azokat a `package.json`
 * sorolja fel. MIND A KÉT lista kézzel karbantartott.
 *
 * Egy teszt, ami egyik listára sem illeszkedik, nem hibázik: nem fut le, és a
 * futtató a többi teszt zöldjét jelenti ugyanazzal a darabszámmal, mint
 * előtte. Ez ma este már megtörtént a mobil oldalon - hét megírt teszt soha
 * nem futott, és a "129 teszt zöld" sor ugyanúgy nézett ki.
 */

const CONFIG = readFileSync("vitest.config.ts", "utf8");
const PACKAGE = readFileSync("package.json", "utf8");
const TEST_TSCONFIG = readFileSync("tsconfig.test.json", "utf8");

/** A vitest include listája, ahogy a konfigurációban áll. */
function vitestPatterns(): string[] {
  const block = CONFIG.slice(
    CONFIG.indexOf("include: ["),
    CONFIG.indexOf("]", CONFIG.indexOf("include: [")),
  );
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

/**
 * A node:test futtató HATÓKÖRE, mintákban.
 *
 * A `package.json` parancsa `find test-dist -name '*.test.js'`-t futtat, tehát
 * MINDENT elindít, amit a `tsconfig.test.json` lefordít -- nem egy kézzel
 * felsorolt fájlt. A hatókört ezért a tsconfig `include` listája adja.
 *
 * EZ A FÜGGVÉNY A PARANCS ALAKJÁRA IS RÁNÉZ, és ez nem formaság: ha valaki
 * visszaír egy kézzel felsorolt útvonalat, a `find` eltűnik, és akkor a
 * tsconfig hatóköre MÁR NEM mondja meg, mi fut le. Olyankor a lenti állítás a
 * régi, útvonalas ágra esik vissza -- ahogy 2026-09-18 előtt működött.
 */
function nodeRunnerPatterns(): string[] {
  if (!/find test-dist -name '\*\.test\.js'/.test(PACKAGE)) return [];
  const block = TEST_TSCONFIG.slice(
    TEST_TSCONFIG.indexOf('"include": ['),
    TEST_TSCONFIG.indexOf("]", TEST_TSCONFIG.indexOf('"include": [')),
  );
  return [...block.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((pattern) => pattern !== "include");
}

/**
 * Egy vitest minta illeszkedik-e egy útvonalra. Csak azokat a jeleket kezeli,
 * amiket a konfiguráció valóban használ: `**`, `*` és a `{ts,tsx}` alak.
 */
function matches(pattern: string, path: string): boolean {
  const expanded = pattern.replace(
    /\{([^}]+)\}/g,
    (_, options: string) => `(${options.split(",").join("|")})`,
  );
  const regex = new RegExp(
    `^${expanded
      .replace(/\./g, "\\.")
      .replace(/\*\*\//g, "§")
      .replace(/\*/g, "[^/]*")
      .replace(/§/g, "(?:.*/)?")}$`,
  );
  return regex.test(path);
}

async function testFiles(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/**/*.test.{ts,tsx}")) found.push(entry);
  return found.sort();
}

describe("teszt-leltár", () => {
  it("minden megírt teszt szerepel valamelyik futtató listájában", async () => {
    const patterns = vitestPatterns();
    const nodeRunner = nodeRunnerPatterns();
    const missing = (await testFiles()).filter((file) => {
      if (patterns.some((pattern) => matches(pattern, file))) return false;
      /*
        A NODE:TEST FUTTATÓ HATÓKÖRE A TSCONFIG-BÓL JÖN, nem egy felsorolt
        útvonalból. A parancs `find`-dal szedi össze a lefordított fájlokat,
        tehát ami a `tsconfig.test.json` `include` listájába esik, az LEFUT.
      */
      if (nodeRunner.some((pattern) => matches(pattern, file))) return false;
      // ÉS A RÉGI, ÚTVONALAS ÁG MEGMARAD: ha a parancs egyszer visszatér a
      // kézzel felsorolt alakra, ez az ág mondja meg, mi fut.
      return !PACKAGE.includes(
        file.replace(/^src\//, "").replace(/\.ts$/, ".js"),
      );
    });

    expect(
      missing,
      "Ezek a tesztek egyik futtatóhoz sincsenek bekötve, tehát nem futnak. Egy le nem futó teszt nem véd semmit, és a darabszámon nem látszik.",
    ).toEqual([]);
  });

  /** A saját mintáit is méri: egy elgépelt minta ugyanúgy néma. */
  it("a vitest minden mintája talál legalább egy fájlt", async () => {
    const files = await testFiles();
    const unused = vitestPatterns().filter(
      (pattern) => !files.some((file) => matches(pattern, file)),
    );

    expect(unused, "A vitest listája nem létező fájlokra hivatkozik.").toEqual(
      [],
    );
  });
});
