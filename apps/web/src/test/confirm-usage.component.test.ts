import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

import { describe, expect, it } from "vitest";

/**
 * A BÖNGÉSZŐ KÉRDÉSE HELYETT A MIÉNK.
 *
 * A `window.confirm` ablaka egyetlen sorba zsúfolja a szöveget, a gombja pedig
 * „OK": aki megnyomja, nem tudja meg, mibe egyezett bele. A közös
 * `ConfirmDialog` ezért kötelezően három részre bontja a kérdést -- mit
 * teszünk, mi vész el, honnan szerezhető vissza --, és a harmadik azért külön
 * mező, mert épp azt szokás elfelejteni.
 *
 * Ez a teszt nem a szöveget méri (arra a képernyők saját tesztjei valók), hanem
 * a LEFEDETTSÉGET: egy holnap írt új képernyő, ami visszanyúl a böngésző
 * ablakához, ugyanaz a hiba lenne, csak más helyen. A lista ezért nem kézzel
 * karbantartott.
 */

const BROWSER_CONFIRM = /window\s*\.\s*confirm\s*\(|(?<![.\w])confirm\s*\(/;

async function sourceFiles(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/**/*.{ts,tsx}"))
    if (!/\.(test|spec)\.tsx?$/.test(entry))
      found.push(entry.replaceAll("\\", "/"));
  return found.sort();
}

describe("megerősítő kérdések", () => {
  /**
   * A KONTROLL A KERESÉSRE. Enélkül egy elrontott minta nulla találatot adna,
   * és a teszt zölden azt állítaná, hogy sehol nincs böngésző-kérdés -- miközben
   * azt jelentené, hogy a keresés romlott el.
   */
  it("finds the browser dialog in a sample that has it", () => {
    expect(BROWSER_CONFIRM.test('if (window.confirm("Biztos?")) run();')).toBe(
      true,
    );
    expect(BROWSER_CONFIRM.test("if (confirm(question)) run();")).toBe(true);
    // És ami NEM böngésző-kérdés: a saját metódusunk ugyanezen a néven.
    expect(BROWSER_CONFIRM.test("void this.confirm();")).toBe(false);
    expect(BROWSER_CONFIRM.test("onClick={() => void confirmDelete()}")).toBe(
      false,
    );
  });

  it("reads the files it claims to read", async () => {
    const files = await sourceFiles();

    // Nulla találat itt zöld lenne, és azt állítaná, hogy minden rendben.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(
      "src/components/service-assets/asset-detail-page.tsx",
    );
  });

  it("asks with our own dialog everywhere, not with the browser's", async () => {
    const files = await sourceFiles();
    const offenders = files.filter((file) =>
      BROWSER_CONFIRM.test(readFileSync(file, "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
