#!/usr/bin/env node
/**
 * PRODUCT ENRICHMENT V0 BENCHMARK (ACD-021 / PD-011): the offline harness.
 *
 * Contract: KratoBal/acropora-os #1199, comment 5938327176. OFFLINE: it reads
 * one JSON file and prints a report. No network, no database, no Jev call,
 * no environment variable. Nothing is written unless `--out` is given.
 *
 * Usage (from the repository root, after `pnpm --filter @acropora/jev build`):
 *
 *   node packages/jev/scripts/eval-product-enrichment.mjs \
 *     --dataset <file.json> [--out <dir>] [--json] [--gate]
 *
 * --dataset  the benchmark dataset (`product-enrichment-benchmark@1`). The
 *            real 30-50 product set lives OUTSIDE the repository; the
 *            synthetic fixture is packages/jev/fixtures/product-enrichment-synthetic.json
 * --out      also write report.md and report.json into this directory
 * --json     print JSON instead of markdown
 * --gate     exit 3 when the unsupported-fact hard gate is not PASS
 *
 * Exit code: 0 done; 1 input error; 3 hard gate failed (only with --gate).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  benchmarkReportMarkdown,
  parseBenchmarkDataset,
  scoreBenchmark,
} from "../dist/product-enrichment/index.js";

function argument(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const datasetPath = argument("--dataset");
const outDir = argument("--out");
const asJson = process.argv.includes("--json");
const gate = process.argv.includes("--gate");

if (!datasetPath) {
  console.error("Missing --dataset <file.json>.");
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileSync(datasetPath, "utf8"));
} catch (error) {
  console.error(`Cannot read the dataset: ${error.message}`);
  process.exit(1);
}

const parsed = parseBenchmarkDataset(raw);
if (!parsed.ok) {
  console.error("The dataset is invalid:");
  for (const e of parsed.errors) console.error(`  - ${e}`);
  process.exit(1);
}

const report = scoreBenchmark(parsed.dataset);
const markdown = benchmarkReportMarkdown(report);
const json = `${JSON.stringify(report, null, 2)}\n`;

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.md"), markdown);
  writeFileSync(join(outDir, "report.json"), json);
}
process.stdout.write(asJson ? json : markdown);

if (gate && report.unsupportedFacts.gate !== "PASS") process.exit(3);
