import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

import { describe, expect, it } from "vitest";

/**
 * A TOKEN NEM FELTÉTEL (kártya 6f8e6f23).
 *
 * Az éles belépés sütis: a munkamenetnek nincs olvasható tokenje (`production-auth.ts`: `token: undefined`), a
 * hívók `session?.token ?? ""`-t adnak tovább, és az `apiRequest` a sütit küldi. Egy `if (!token) return` vagy
 * `if (token)` feltétel ezért élesben a kérés ELŐTT áll meg, hibaüzenet nélkül: a lap a betöltőn vagy üresen marad,
 * a fejlesztői belépéssel (ahol van token) pedig minden működik. Mért esetek: a szerződés-lap (2026-09-24), a
 * teljesítési igazolás panel, a partner-tanúsítványok, és 2026-11-05-én a Banki átutalások lap, ahol Balázs csak a
 * szürke betöltőt látta. Ez a teszt a forrásban keresi a mintát, mert a komponens-tesztek tokennel futnak.
 */

const TOKEN_GUARD =
  /if\s*\((?:[^()]|\([^()]*\))*(?:!\s*token\b(?!\s*\.)|\btoken\s*\))/;

/** A blokk- és sorkommentek nélkül: a figyelmeztető kommentek („nem `if (token)`”) nem találatok. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

async function sourceFiles(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/**/*.{ts,tsx}"))
    if (!/\.(test|spec)\.tsx?$/.test(entry))
      found.push(entry.replaceAll("\\", "/"));
  return found.sort();
}

describe("a token nem feltétel", () => {
  it("finds the guard in a sample that has it, and not in what only looks like it", () => {
    expect(TOKEN_GUARD.test("if (!token) return;")).toBe(true);
    expect(TOKEN_GUARD.test("if (!token || !canView) return;")).toBe(true);
    expect(TOKEN_GUARD.test("if (!canManage || !token) return;")).toBe(true);
    expect(TOKEN_GUARD.test("if (token) void load();")).toBe(true);
    expect(TOKEN_GUARD.test("if (canView && token) void load();")).toBe(true);
    expect(TOKEN_GUARD.test("if (!canView) return;")).toBe(false);
    expect(TOKEN_GUARD.test("if (!tokenExpired) return;")).toBe(false);
    expect(TOKEN_GUARD.test("if (!token.length) return;")).toBe(false);
    expect(
      TOKEN_GUARD.test(code("// nem `if (!token)`: a süti hitelesít\nrun();")),
    ).toBe(false);
  });

  it("reads the files it claims to read", async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("src/components/finance/bank-transfers-page.tsx");
  });

  it("no screen stops its request on a missing token", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      const lines = code(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (TOKEN_GUARD.test(line)) offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
