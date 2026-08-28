import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { AiProductSearchWriter } from "./ai-product-search.writer.js";

/**
 * KÉZZEL indított feltöltés és újraépítés, a `medusa:project` mintájára.
 *
 * Miért kell, ha két eseményíró már megvan: a két író csak akkor fut, ha egy
 * termék MEGVÁLTOZIK. Egy hónapok óta változatlan termék soha nem kapna sort,
 * és a keresés a katalógus töredékét látná - miközben minden teszt zöld. Ez a
 * parancs az első feltöltés, és ugyanez kell akkor is, ha a recept vagy a
 * szótár változik.
 *
 * Használat:
 *   pnpm --filter @acropora/api ai-search:rebuild
 *   pnpm --filter @acropora/api ai-search:rebuild --balance
 *
 * A `--balance` NEM ír, csak számol. Azért külön alak, mert az ellenőrzést
 * akkor is le kell tudni futtatni, amikor épp NEM akarunk hozzányúlni a
 * táblához - például éles környezetben, egy panasz után.
 */

export interface RebuildWriter {
  rebuildAll(): Promise<{ written: number }>;
  balance(): Promise<{
    searchableProducts: number;
    searchableDocuments: number;
    totalProducts: number;
    totalDocuments: number;
  }>;
}

/**
 * AZ EGYENSÚLY KÉT OLDALA, KIÍRVA - ÉS A KÜLÖNBSÉG NEM ÉRTELMEZÉS KÉRDÉSE.
 *
 * Nem a különbséget írjuk ki, hanem MINDKÉT számot, mert ha egyszer eltolódik,
 * azt kell tudni, MELYIK oldal mozdult. A két számnak egyeznie KELL: a törölt
 * és az inaktív termék is kap sort, csak `isSearchable = false` értékkel.
 * Nincs olyan eset, amiben szándékosan eltér, tehát az egyenlőtlenség MINDIG
 * hiba - és ezért ad a parancs is hibás kilépési kódot.
 *
 * Külön, exportált függvény, hogy adatbázis nélkül is mérhető legyen: egy
 * jelentés-szöveg, amit csak éles adattal lehetne megnézni, nem mérhető.
 */
export function describeBalance(balance: {
  searchableProducts: number;
  searchableDocuments: number;
  totalProducts: number;
  totalDocuments: number;
}): { text: string; balanced: boolean } {
  const balanced =
    balance.searchableProducts === balance.searchableDocuments &&
    balance.totalProducts === balance.totalDocuments;

  const lines = [
    `kereshető termék:    ${balance.searchableProducts}`,
    `kereshető dokumentum: ${balance.searchableDocuments}`,
    `összes termék:        ${balance.totalProducts}`,
    `összes dokumentum:    ${balance.totalDocuments}`,
  ];

  lines.push(
    balanced
      ? "EGYENSÚLYBAN: a két oldal megegyezik."
      : "ELTÉRÉS: a két oldal nem egyezik. Ez MINDIG hiba - futtasd az " +
          "újraépítést, és ha az eltérés megmarad, egy író hiányzik.",
  );

  return { text: `${lines.join("\n")}\n`, balanced };
}

export async function runAiSearchRebuildCli(
  argv: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  writer: RebuildWriter = new AiProductSearchWriter(),
): Promise<number> {
  const balanceOnly = argv.includes("--balance");

  if (!balanceOnly) {
    const { written } = await writer.rebuildAll();
    out.stdout(`újraépítve: ${written} dokumentum\n`);
  }

  const { text, balanced } = describeBalance(await writer.balance());

  /**
   * Az eltérés a HIBAKIMENETRE megy, az egyensúly a rendesre. Aki ezt egy
   * naplóba futtatja, a hibát akkor is látja, ha a kimenetet elnyeli.
   */
  if (balanced) out.stdout(text);
  else out.stderr(text);

  return balanced ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runAiSearchRebuildCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
