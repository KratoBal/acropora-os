import "reflect-metadata";

import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { CapasuliItemJevService } from "./capasuli-item-jev.service.js";
import { ServiceDraftsRepository } from "./service-drafts.repository.js";
import { ServiceJobsRepository } from "../service-jobs/service-jobs.repository.js";

/**
 * A MA MEGLÉVŐ PISZKOZATOK UTÓLAGOS SZŰRÉSE, EGYSZER (brief 6. pont: kb. 27
 * tétel, ugyanazokkal a szabályokkal; a kiszűrt a "Kiszűrve" alá kerül, semmi
 * nem törlődik).
 *
 *   node dist/service-drafts/capasuli-jev-backfill.cli.js            (száraz)
 *   node dist/service-drafts/capasuli-jev-backfill.cli.js --apply
 *
 * ALAPBÓL SZÁRAZ: besorol (futás-sor nélkül), és kiírja, mi lenne a tételek
 * sorsa. Az `--apply` rögzíti a futásokat és a piszkozat szűrési állapotát --
 * csak a még szűretlen, függő tételen. A szűrés kapcsolója (JEV_CAPASULI_FILTER)
 * itt nem kell: ez kézzel indított, egyszeri lépés; a kulcs igen.
 */
async function main(argv: readonly string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const jev = new CapasuliItemJevService();
  if (!jev.hasKey()) {
    process.stderr.write("Nincs TYPESAFE_API_KEY: nincs mit besorolni.\n");
    return 2;
  }
  const repository = new ServiceDraftsRepository(new ServiceJobsRepository());
  const drafts = await repository.unfilteredPending();
  const counts: Record<string, number> = {};
  const shown: string[] = [];
  for (const d of drafts) {
    const filter = await jev.filterFor(
      {
        source: d.source,
        mailbox: d.mailbox,
        reportDate: d.reportDate.toISOString().slice(0, 10),
        fingerprint: d.fingerprint,
      },
      d.originalProblem,
      { record: apply, force: true },
    );
    counts[filter.filterState] = (counts[filter.filterState] ?? 0) + 1;
    process.stdout.write(
      `  ${d.reportDate.toISOString().slice(0, 10)}\t${filter.filterState}\t${filter.jevClass ?? "-"} ${filter.jevConfidence?.toFixed(2) ?? ""}\t${d.title.slice(0, 80)}\n`,
    );
    if (!apply) continue;
    if (filter.filterState === "UNFILTERED") continue;
    await repository.applyFilter(d.id, filter);
    if (filter.filterState !== "FILTERED" && filter.decisionRunId)
      shown.push(filter.decisionRunId);
  }
  if (apply) await repository.markRunsShown(shown);
  process.stdout.write(
    `${apply ? "ÉLES" : "SZÁRAZ"}: ${drafts.length} szűretlen függő tétel; ` +
      Object.entries(counts)
        .map(([state, n]) => `${state} ${n}`)
        .join(", ") +
      ".\n",
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
