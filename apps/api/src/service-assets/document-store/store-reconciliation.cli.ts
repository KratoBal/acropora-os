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
 *     4  a kulcsok egyeznek, de a TAROLO NEM AD MERETET -- a meres FELIG kesz
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
export interface RowWithSize {
  key: DocumentKey;
  /** A TABLA allitasa a fajl mereterol -- ezt vetjuk ossze a taroloeval. */
  sizeBytes: number;
}

export type FetchRowsWithStorageKey = () => Promise<RowWithSize[]>;

const fetchFromPrisma: FetchRowsWithStorageKey = async () => {
  const sorok = await prisma.assetDocument.findMany({
    where: { storageKey: { not: null } },
    select: { assetId: true, id: true, sizeBytes: true },
  });
  return sorok.map((sor) => ({
    key: { assetId: sor.assetId, documentId: sor.id },
    sizeBytes: sor.sizeBytes,
  }));
};

export interface ReconciliationOutcome {
  code: 0 | 1 | 2 | 3 | 4;
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

  let rows: RowWithSize[];
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
    rowsWithStorageKey: rows.map((sor) => sor.key),
    filesInStore: files,
  });
  const lines = describeReport(report);
  const elteres = report.orphanedFiles.length + report.missingFiles.length;
  if (elteres > 0) return { code: 1, lines };

  /**
   * A MERET-OSSZEVETES CSAK AKKOR JON, HA A KULCSOK MAR EGYEZNEK.
   *
   * Ha van arva vagy hianyzo fajl, az a SULYOSABB lelet, es a meret-elteres
   * mellette zaj lenne: egy hianyzo fajlnak nincs merete, amit ossze lehetne
   * vetni. Eloszor a halmaz alljon helyre, aztan a tartalom.
   */
  const size = deps.store.size?.bind(deps.store);
  if (!size)
    return {
      code: 4,
      lines: [
        ...lines,
        "a tarolo NEM AD MERETET, tehat a meret-osszevetes NEM tortent meg.",
        "A kulcsok egyeznek; hogy a MERETUK is egyezik-e, azt nem mertuk.",
      ],
    };

  const meretElteres: string[] = [];
  for (const sor of rows) {
    let tarolt: number | null;
    try {
      tarolt = await size(sor.key);
    } catch (cause) {
      return {
        code: 2,
        lines: [`a meret-lekerdezes elhasalt: ${String(cause)}`],
      };
    }
    /**
     * A `null` ITT NEM ELTERES: a kulcs-osszevetes szerint a fajl OTT VAN, es
     * ha a meret kozben megis megallapithatatlan, az VERSENYHELYZET (torles a
     * ket meres kozott), nem adathiba. Kulon soron all, hogy a szam ne
     * hazudjon.
     */
    if (tarolt === null) {
      meretElteres.push(
        `  MERET?  ${sor.key.assetId}/${sor.key.documentId} (a merete nem allapithato meg)`,
      );
      continue;
    }
    if (tarolt !== sor.sizeBytes)
      meretElteres.push(
        `  MERET   ${sor.key.assetId}/${sor.key.documentId} tabla=${sor.sizeBytes} tarolo=${tarolt}`,
      );
  }
  if (meretElteres.length > 0)
    return {
      code: 1,
      lines: [
        ...lines,
        `meret-elteres: ${meretElteres.length}`,
        ...meretElteres,
      ],
    };
  return { code: 0, lines: [...lines, "meret-elteres: 0"] };
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
