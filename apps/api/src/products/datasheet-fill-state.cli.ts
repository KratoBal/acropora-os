import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  describeFillState,
  measureFillState,
  type FillStateDatasheet,
} from "./datasheet-fill-state.js";

/**
 * A KITÖLTÖTTSÉG MÉRŐJE — KÜLÖN PARANCS, ÉS EZ SZÁNDÉKOS.
 *
 * Ugyanaz a szkript-alak és ugyanaz a három kilépési kód, mint a
 * `datasheet:audit`-nál, de MÁS PARANCS. Az ok nem stílus:
 *
 * 1. A KILÉPÉSI KÓD SZERZŐDÉS, ÉS MÁR HASZNÁLJÁK. Ha ugyanaz a parancs két
 *    különböző okból adná az 1-et, a hívó a kimenet elemzése nélkül nem tudná,
 *    melyik történt.
 * 2. A KÉT ÁLLÍTÁS ÉLETCIKLUSA ELLENTÉTES. Az ellentmondás-audit elvárt értéke
 *    NULLA, mindig. Ezé ma NEM nulla, és akkor csökken, ahogy a kitöltés halad.
 *    Egy futásban a kapu vagy nem húzható meg, vagy a kitöltés ideje alatt
 *    folyamatosan pirosat ad.
 * 3. EBBŐL KÖVETKEZIK A HASZNÁLATUK IS: az ellentmondás KAPU, ez MÉRŐ. Az egyik
 *    megállít, a másik megmutatja, hol tartunk.
 *
 * **EZT A PARANCSOT NE KÖSD BE OLYAN KAPUBA, AMI MUNKÁT BLOKKOL, amíg a kitöltés
 * tart.** Ha valaki később be akarja kötni, az külön döntés — és akkor már lesz
 * mihez mérni, hogy mikor ért el nullára.
 *
 * Használat (a cél adatbázist a `DATABASE_URL` adja, semmi nincs beégetve):
 *
 *     DATABASE_URL='...' pnpm --filter @acropora/api datasheet:fill-state
 *
 * Kilépési kódok:
 *
 *     0  minden adatlap csoportosítható géppel
 *     1  van, ami nem: hiányzó vagy eltérő írásmódú `genus`, felsorolva
 *     2  a lekérdezés maga hasalt el (nem tudjuk, hogy hol tartunk)
 *
 * A 2-es itt is külön áll, ugyanabból az okból: egy elérhetetlen adatbázis nem
 * ugyanaz, mint egy hibátlanul kitöltött.
 */
export type FetchFillStateDatasheets = () => Promise<FillStateDatasheet[]>;

const fetchFromPrisma: FetchFillStateDatasheets = () =>
  prisma.productDatasheet.findMany({
    select: { id: true, genus: true, species: true },
  });

export async function runDatasheetFillStateCli(
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  fetchDatasheets: FetchFillStateDatasheets = fetchFromPrisma,
): Promise<number> {
  let sheets: FillStateDatasheet[];
  try {
    sheets = await fetchDatasheets();
  } catch (error) {
    out.stderr(
      `Az adatlapok lekérdezése elhasalt: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        `Ez NEM azt jelenti, hogy minden ki van töltve - azt jelenti, hogy nem ` +
        `tudjuk. A kilépési kód ezért 2, nem 1.\n`,
    );
    return 2;
  }

  const state = measureFillState(sheets);
  out.stdout(`${describeFillState(state)}\n`);

  return state.missingGenus.length > 0 || state.inconsistentGenus.length > 0
    ? 1
    : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runDatasheetFillStateCli();
  await prisma.$disconnect();
  process.exit(code);
}
