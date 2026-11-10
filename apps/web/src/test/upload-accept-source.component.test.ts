import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

import { ACCEPTED_UPLOAD_MIMETYPES } from "@acropora/types";
import { describe, expect, it } from "vitest";

/**
 * A FÁJLVÁLASZTÓ ÉS A SZERVER UGYANABBÓL A TÁBLÁBÓL (b68357b7 kártya).
 *
 * Az elfogadott feltöltési típusok a közös `UPLOADED_FILE_TYPES` táblában
 * állnak (`@acropora/types`); a szerver ellenőrzője és a választók `accept`
 * listája (`uploadAccept`) onnan olvas. Egy kézzel írt lista a választóban
 * csendben elcsúszna: felkínálna valamit, amit a szerver elutasít, vagy
 * elrejtene valamit, amit elfogad, és egyik sem buktat semmit.
 *
 * A teszt ezért azt méri, hogy a web és a partner portál forrásában NE álljon
 * kézzel írt lista, ami KIZÁRÓLAG feltöltési típusokból áll: `accept="..."`
 * attribútum, vesszős szöveg vagy legalább kételemű tömb. A más típusokat is
 * vivő listák (képtár gif/webp-vel, XML, `.pdf` kiterjesztés) más végpontra
 * mennek, azokat nem érinti.
 *
 * A lista nem kézzel karbantartott: egy holnap írt új képernyő ugyanúgy
 * beleesik.
 */

const UPLOAD = new Set(ACCEPTED_UPLOAD_MIMETYPES);
const only = (items: string[]) =>
  items.length > 0 && items.every((item) => UPLOAD.has(item.trim()));

/** The hand-written upload lists in one source, as `file: literal` lines. */
function handWritten(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/accept="([^"]*)"/g))
    if (only(match[1]!.split(","))) found.push(match[0]);
  // the attributes are counted above: the comma strings are looked for in what is left
  const rest = source.replace(/accept="[^"]*"/g, "");
  for (const match of rest.matchAll(/["'`]([^"'`\n]*,[^"'`\n]*)["'`]/g))
    if (only(match[1]!.split(","))) found.push(match[0]);
  for (const match of rest.matchAll(/\[([^\][]*)\]/g)) {
    const items = [...match[1]!.matchAll(/["'`]([^"'`]*)["'`]/g)].map(
      (item) => item[1]!,
    );
    const bare = match[1]!
      .replace(/["'`][^"'`]*["'`]/g, "")
      .replace(/[\s,]/g, "");
    if (items.length >= 2 && bare === "" && only(items)) found.push(match[0]);
  }
  return found;
}

async function sourceFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const pattern of ["src/**/*.{ts,tsx}", "../partner/src/**/*.{ts,tsx}"])
    for await (const entry of glob(pattern))
      if (!/\.(test|spec)\.tsx?$/.test(entry))
        found.push(entry.replaceAll("\\", "/"));
  return found.sort();
}

describe("a feltöltési típusok egy forrásból", () => {
  /** A KONTROLL A KERESÉSRE: elrontott minta mellett a zöld semmit nem mondana. */
  it("finds a hand-written upload list in every form it takes, and nothing else", () => {
    for (const sample of [
      '<input accept="image/jpeg,image/png,application/pdf" />',
      '<input accept="application/pdf" />',
      'const UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png";',
      'const PHOTO_TYPES = ["image/jpeg", "image/png"];',
    ])
      expect(handWritten(sample), sample).toHaveLength(1);
    for (const sample of [
      'accept={uploadAccept(["pdf", "jpeg", "png"])}',
      '<input accept="image/png,image/jpeg,image/gif,image/webp" />',
      '<input accept="application/pdf,.pdf" />',
      'if (blob.type !== "application/pdf") fail();',
      'const kinds = ["pdf", "jpeg"];',
    ])
      expect(handWritten(sample), sample).toEqual([]);
  });

  it("reads the files it claims to read, on both surfaces", async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("src/components/messages/conversation-view.tsx");
    expect(files).toContain("../partner/src/components/document-panel.tsx");
  });

  it("takes every upload list from the shared table, not by hand", async () => {
    const offenders = (await sourceFiles()).flatMap((file) =>
      handWritten(readFileSync(file, "utf8")).map(
        (literal) => `${file}: ${literal}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
