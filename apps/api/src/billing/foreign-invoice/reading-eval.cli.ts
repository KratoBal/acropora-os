import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { IncomingReadingField } from "@acropora/types";

import { pdfTextLines } from "../../purchasing/supplier-invoice-import/pdf-text-lines.js";
import {
  BLANK_PAIRING,
  EVAL_FIELDS,
  evaluate,
  evaluateByGroup,
  formatReport,
  judge,
  readSample,
  type EvalMode,
  type EvalSample,
} from "./reading-eval.js";

/**
 * A SZAMLAOLVASO ERTEKELO PARANCSSORA (kartya dbab22cd).
 *
 *   node ../../packages/database/node_modules/tsx/dist/cli.mjs \
 *     src/billing/foreign-invoice/reading-eval.cli.ts [adat-mappa] [--mod=A|B|AB] [--reszletek]
 *
 * AZ ADAT-MAPPA NEM A REPOBAN ALL (szamla-adat nem kerul repoba, PR-ba, uzenetbe):
 * alapbol /home/marveen/marveen/agents/murena/szamlaolvaso-adat/. Felepitese:
 *
 *   samples/<id>.json   egy minta (vagy samples.jsonl: soronkent egy minta)
 *   pdf/<id>.pdf        a minta PDF-je, ha a minta "pdf" mezoje erre mutat
 *   lines-cache/        az ertekelo irja: a PDF-bol kinyert sorok (a PDF mtime-ja szerint ujraszamolva)
 *   results/            az ertekelo irja, CSAK --reszletek-kel: mintankenti itelet (itt van az ertek is)
 *
 * Egy minta: { id, pdf? | lines?, adapter, pairing, expected{11 mezo}, manualFields[], group? }.
 * A `group` (pl. feed, nav, verified) a helyes ertek forrasa: a jelentes csoportonkent is ad szazalekot.
 *
 * A KIMENET a stdout-on CSAK mezonev es szazalek (lasd `formatReport`): ezt lehet
 * tovabbmondani. A mintankenti elteres a mappaban marad.
 */

const DEFAULT_DIR = "/home/marveen/marveen/agents/murena/szamlaolvaso-adat";

interface RawSample {
  id?: unknown;
  pdf?: unknown;
  lines?: unknown;
  adapter?: unknown;
  pairing?: unknown;
  expected?: unknown;
  manualFields?: unknown;
  group?: unknown;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Beolvassa a mintakat; a hiba CSAK a minta azonositojat nevezi meg, tartalmat soha. */
async function loadSamples(dir: string): Promise<EvalSample[]> {
  const raws: RawSample[] = [];
  const sampleDir = join(dir, "samples");
  const names = await readdir(sampleDir).catch(() => [] as string[]);
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    raws.push(
      JSON.parse(await readFile(join(sampleDir, name), "utf8")) as RawSample,
    );
  }
  const jsonl = await readFile(join(dir, "samples.jsonl"), "utf8").catch(
    () => "",
  );
  for (const line of jsonl.split("\n"))
    if (line.trim()) raws.push(JSON.parse(line) as RawSample);
  if (raws.length === 0)
    fail(`Nincs minta: ${sampleDir} es samples.jsonl ures vagy hianyzik.`);

  const samples: EvalSample[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const id = typeof raw.id === "string" && raw.id ? raw.id : null;
    if (!id) fail("Egy mintanak nincs azonositoja (id).");
    if (seen.has(id)) fail(`Ketszer szereplo minta azonosito: ${id}`);
    seen.add(id);
    const expected = raw.expected as Record<string, unknown> | undefined;
    if (!expected || typeof expected !== "object")
      fail(`A(z) ${id} mintanak nincs expected-je.`);
    for (const field of EVAL_FIELDS)
      if (!(field in expected))
        fail(`A(z) ${id} minta expected-jebol hianyzik a(z) ${field} mezo.`);
    const manual = Array.isArray(raw.manualFields) ? raw.manualFields : [];
    for (const field of manual)
      if (!EVAL_FIELDS.includes(field as IncomingReadingField))
        fail(
          `A(z) ${id} minta manualFields-eben ismeretlen mezo van: ${String(field)}`,
        );
    let lines: string[] | null = null;
    if (typeof raw.pdf === "string" && raw.pdf)
      lines = await linesOf(dir, id, raw.pdf);
    else if (Array.isArray(raw.lines)) lines = raw.lines.map(String);
    samples.push({
      id,
      lines,
      adapter: (raw.adapter ?? null) as EvalSample["adapter"],
      pairing: (raw.pairing ?? null) as EvalSample["pairing"],
      expected: expected as unknown as EvalSample["expected"],
      manualFields: manual as IncomingReadingField[],
      group: typeof raw.group === "string" ? raw.group : undefined,
    });
  }
  return samples;
}

/** A PDF szovegsorai; a kinyeres lassu, ezert a PDF modositasi ideje szerint gyorsitotarazva. */
async function linesOf(
  dir: string,
  id: string,
  pdf: string,
): Promise<string[] | null> {
  const pdfPath = join(dir, pdf);
  const pdfStat = await stat(pdfPath).catch(() => null);
  if (!pdfStat) fail(`A(z) ${id} minta PDF-je hianyzik: ${pdf}`);
  const cachePath = join(dir, "lines-cache", `${basename(id)}.json`);
  const cacheStat = await stat(cachePath).catch(() => null);
  if (cacheStat && cacheStat.mtimeMs >= pdfStat.mtimeMs)
    return JSON.parse(await readFile(cachePath, "utf8")) as string[] | null;
  let lines: string[] | null;
  try {
    lines = await pdfTextLines(new Uint8Array(await readFile(pdfPath)));
    // olvashatatlan vagy ures szovegreteg: ugyanaz, mint az appban (szkennelt)
    if (!lines.some((line) => line.trim())) lines = null;
  } catch {
    lines = null;
  }
  await mkdir(join(dir, "lines-cache"), { recursive: true });
  await writeFile(cachePath, JSON.stringify(lines));
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) ?? DEFAULT_DIR;
  const modeArg = args.find((a) => a.startsWith("--mod="))?.slice(6) ?? "A";
  const details = args.includes("--reszletek");
  if (!["A", "B", "AB"].includes(modeArg)) fail("--mod=A, B vagy AB lehet.");
  const modes = modeArg.split("") as EvalMode[];

  const samples = await loadSamples(dir);
  for (const mode of modes) {
    console.log(formatReport(evaluate(samples, mode)));
    console.log("");
    const groups = evaluateByGroup(samples, mode);
    if (groups.size > 1)
      for (const [name, report] of groups) {
        console.log(`#### csoport: ${name}`);
        console.log(formatReport(report));
        console.log("");
      }
    if (!details) continue;
    const rows = samples.map((sample) => {
      const read = readSample(sample, mode);
      const manual = new Set(sample.manualFields);
      return {
        id: sample.id,
        fields: Object.fromEntries(
          EVAL_FIELDS.map((field) => [
            field,
            {
              verdict:
                judge(field, sample.expected[field], read[field]) ??
                "NO_EXPECTED",
              manual: manual.has(field),
              expected: sample.expected[field],
              read: read[field],
            },
          ]),
        ),
        usedPairing:
          mode === "B" &&
          sample.pairing !== null &&
          sample.pairing !== BLANK_PAIRING,
      };
    });
    await mkdir(join(dir, "results"), { recursive: true });
    const file = join(
      dir,
      "results",
      `${new Date().toISOString().replace(/[:.]/g, "-")}-mod-${mode}.json`,
    );
    await writeFile(file, JSON.stringify(rows, null, 1));
    console.log(`mintankenti itelet (ertekekkel, a mappaban marad): ${file}`);
  }
}

main().catch((error: unknown) => {
  // csak az uzenet: egy hiba sem hordozhat szamla-adatot
  console.error(error instanceof Error ? error.message : "ismeretlen hiba");
  process.exit(1);
});
