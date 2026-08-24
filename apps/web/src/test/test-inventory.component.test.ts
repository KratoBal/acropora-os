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

/** A vitest include listája, ahogy a konfigurációban áll. */
function vitestPatterns(): string[] {
  const block = CONFIG.slice(
    CONFIG.indexOf("include: ["),
    CONFIG.indexOf("]", CONFIG.indexOf("include: [")),
  );
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
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
    const missing = (await testFiles()).filter((file) => {
      if (patterns.some((pattern) => matches(pattern, file))) return false;
      // A node:test-tel futó modulok a package.json parancssorában állnak, a
      // lefordított útjukkal.
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
