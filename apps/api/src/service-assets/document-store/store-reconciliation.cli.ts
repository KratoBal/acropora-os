import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  collectDocumentKeys,
  type DocumentKey,
  type DocumentStore,
  type DocumentStoreStatus,
} from "./document-store.js";
import { createDocumentStore } from "./document-store.provider.js";
import {
  reconcileDocumentStore,
  type ReconciliationReport,
} from "./document-store-reconciliation.js";

/**
 * A TAROLO-EGYEZTETES FUTTATOJA -- ez teszi valodiva a masodik meresi reteget.
 *
 * A `reconcileDocumentStore` fuggveny 2026-09-01 ota all a repoban, hat
 * tesztel egyutt, es ELES HIVOJA NULLA volt: csak a sajat spec-je futtatta.
 * Merve 2026-09-03, ismert pozitiv kontrollal -- ugyanabbol a mappabol a
 * `decideQuota`-nak VAN eles hivoja (`service-assets.service.ts:463`), tehat a
 * nulla nem a kereses tulajdonsaga volt.
 *
 * Egy egyeztetes, amit soha nem hivnak, nem ved semmitol -- de ugy nez ki,
 * mintha vedene. A tesztek azt bizonyitjak, hogy a detektor mukodik; egy VALODI
 * tarolorol csak ez a parancs mond valamit, mert AZ ELLEN fut.
 *
 * Hasznalat (a cel adatbazist a `DATABASE_URL`, a tarolot a sajat kornyezeti
 * valtozoi adjak, semmi nincs beegetve):
 *
 *     DATABASE_URL='...' pnpm --filter @acropora/api store:reconcile
 *
 * A KILEPESI KOD NEGY ALLAPOTOT KULONBOZTET MEG, es a negyedik a lenyeg:
 *
 *     0  egyeztetve, nincs elteres
 *     1  TALALT eltérést (arva fajl vagy hianyzo fajl), es felsorolja
 *     2  a lekerdezes vagy a tarolo elhasalt -- NEM tudjuk, hogy van-e elteres
 *     3  a tarolo NINCS BEALLITVA: nem egyeztettunk semmit
 *
 * A 3-as azert all kulon a 0-tol, mert a "nincs beallitva" es a "tiszta" KET
 * KULONBOZO allapot, es egy kozos nulla osszemosna oket. Ez ma tobbszor
 * elofordult a flottaban: egy sikeres, URES lekerdezes ugy nezett ki, mint egy
 * negativ eredmeny, holott a felulet soha nem is hordozta az informaciot.
 */

/**
 * A KET BEMENET FUGGVENYKENT, nem adatbazis- es tarolo-objektumkent.
 *
 * Igy a lekerdezes alakja EGY helyen all, konkret literallal, es a teszt a ket
 * oldalt kulon tudja adni. Egy `unknown`-t fogado felulet elnyelne, ha valaki
 * elveszi a `storageKey: { not: null }` szurest -- es akkor a `content`-es
 * sorok is bejonnenek, amiknek nincs is fajljuk: MINDEN mai sor "elveszett
 * sornak" latszana.
 */
export type FetchRowsWithStorageKey = () => Promise<DocumentKey[]>;

const fetchFromPrisma: FetchRowsWithStorageKey = async () => {
  const sorok = await prisma.assetDocument.findMany({
    where: { storageKey: { not: null } },
    select: { assetId: true, id: true },
  });
  return sorok.map((sor) => ({
    assetId: sor.assetId,
    documentId: sor.id,
  }));
};

export interface ReconciliationOutcome {
  code: 0 | 1 | 2 | 3;
  lines: string[];
}

function describeReport(report: ReconciliationReport): string[] {
  const lines = [
    `parba allt: ${report.matched}`,
    `arva fajl (van fajl, nincs sor): ${report.orphanedFiles.length}`,
    `hianyzo fajl (van sor, nincs fajl): ${report.missingFiles.length}`,
  ];
  /**
   * A KET LISTA KULON MEGY, MERT A TEENDOJUK ELLENTETES: az arva fajl helyet
   * foglal es torolheto, a hianyzo fajl viszont a FELHASZNALO ele kerul, es a
   * letoltesnel ad hibat. Egy kozos "elteres" lista ugyanazt a szamot adna ket
   * ellentetes bajra.
   */
  for (const key of report.orphanedFiles)
    lines.push(`  ARVA    ${key.assetId}/${key.documentId}`);
  for (const key of report.missingFiles)
    lines.push(`  HIANYZO ${key.assetId}/${key.documentId}`);
  return lines;
}

export async function runReconciliation(deps: {
  store: DocumentStore;
  fetchRows: FetchRowsWithStorageKey;
}): Promise<ReconciliationOutcome> {
  let status: DocumentStoreStatus;
  try {
    status = await deps.store.describe();
  } catch (cause) {
    return {
      code: 2,
      lines: [`a tarolo allapota nem kerdezheto le: ${String(cause)}`],
    };
  }
  if (status.state === "not-configured")
    return {
      code: 3,
      lines: [
        "a tarolo NINCS BEALLITVA, tehat nem egyeztettunk semmit.",
        "Ez NEM azt jelenti, hogy nincs elteres: azt, hogy nem mertuk meg.",
      ],
    };
  if (status.state === "broken")
    return { code: 2, lines: [`a tarolo hibas: ${status.reason}`] };

  let rows: DocumentKey[];
  let files: DocumentKey[];
  try {
    [rows, files] = await Promise.all([
      deps.fetchRows(),
      collectDocumentKeys(deps.store.list()),
    ]);
  } catch (cause) {
    return { code: 2, lines: [`a meres elhasalt: ${String(cause)}`] };
  }

  const report = reconcileDocumentStore({
    rowsWithStorageKey: rows,
    filesInStore: files,
  });
  const elteres = report.orphanedFiles.length + report.missingFiles.length;
  return { code: elteres > 0 ? 1 : 0, lines: describeReport(report) };
}

async function main(): Promise<number> {
  const outcome = await runReconciliation({
    store: createDocumentStore(process.env),
    fetchRows: fetchFromPrisma,
  });
  for (const line of outcome.lines) process.stdout.write(`${line}\n`);
  return outcome.code;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
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
