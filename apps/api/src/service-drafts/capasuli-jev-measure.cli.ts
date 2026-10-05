import "reflect-metadata";

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { extractCapasuliReports } from "./capasuli-extractor.js";
import { CapasuliItemJevService } from "./capasuli-item-jev.service.js";
import {
  handLabel,
  measurementReport,
  type MeasuredItem,
} from "./capasuli-jev-measure.js";

/**
 * A CÁPASULI SZŰRÉS VAK MÉRÉSE, CSAK OLVAS (brief: exchange/capasuli-jev-
 * szures-2026-10-05.md, "Before it is switched on").
 *
 *   node dist/service-drafts/capasuli-jev-measure.cli.js [--since 2026-09-24] [--input levelek.jsonl]
 *
 * A tárolt jelentőket olvassa (`ServiceDraftMail`, a `--since` napjától), és a
 * `--input` fájl soraiból a régebbieket (`{"text": "...", "subject": "..."}`
 * soronként, a postafiókból kimentve). Ugyanaz a kivonatoló bontja tételekre,
 * mint az élő begyűjtés, és ugyanaz a besoroló sorolja be -- de `record:
 * false`-szal: NEM ír futás-sort, piszkozatot, semmit. A kapcsolótól (JEV_
 * CAPASULI_FILTER) függetlenül hív, csak a TYPESAFE_API_KEY kell hozzá.
 */
function argument(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at >= 0 ? (argv[at + 1] ?? null) : null;
}

async function main(argv: readonly string[]): Promise<number> {
  const since = argument(argv, "--since") ?? "2026-09-24";
  const input = argument(argv, "--input");
  const jev = new CapasuliItemJevService();
  if (!jev.hasKey()) {
    process.stderr.write("Nincs TYPESAFE_API_KEY: a mérés nem hív.\n");
    return 2;
  }

  const texts: string[] = (
    await prisma.serviceDraftMail.findMany({
      where: {
        source: "CAPASULI_DAILY_REPORT",
        OR: [
          { receivedAt: { gte: new Date(`${since}T00:00:00Z`) } },
          { receivedAt: null },
        ],
      },
      orderBy: { receivedAt: "asc" },
      select: { originalText: true },
    })
  ).map((m) => m.originalText);
  if (input)
    for (const line of (await readFile(input, "utf8")).split("\n"))
      if (line.trim()) texts.push(String(JSON.parse(line).text ?? ""));

  // a Re: válaszlevelek ugyanazt a jelentést ismétlik: nap + ujjlenyomat egyszer
  const seen = new Set<string>();
  const items: MeasuredItem[] = [];
  for (const text of texts)
    for (const report of extractCapasuliReports(text)) {
      const reportDate = report.reportDate.toISOString().slice(0, 10);
      for (const problem of report.problems) {
        const key = `${reportDate}:${problem.fingerprint}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          reportDate,
          title: problem.title,
          rule: handLabel(problem.text),
          verdict: await jev.classify(
            {
              source: "CAPASULI_DAILY_REPORT",
              mailbox: "measure",
              reportDate,
              fingerprint: problem.fingerprint,
            },
            problem.text,
            { record: false, force: true },
          ),
        });
      }
    }
  items.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  process.stdout.write(
    `Levelek: ${texts.length}\n${measurementReport(items, jev.threshold())}\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause) => {
      process.stderr.write(`${String(cause)}\n`);
      process.exitCode = 2;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
