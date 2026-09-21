import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  describeWorksheetSheetCoverage,
  planWorksheetSheetBackfill,
  type WorksheetSheetBackfillRow,
} from "./worksheet-sheet-backfill.js";
import { WorksheetsRepository } from "./worksheets.repository.js";

/**
 * A MAR LEZART LAPOKHOZ UTOLAG KESZULO KIADOTT MUNKALAP.
 *
 * === MIERT PARANCS, ES NEM MIGRACIO ===
 *
 * Ugyanaz az indok, mint a belyegkep-backfillnel: egy migracio, ami PDF-et
 * renderel, a TELEPITEST tenne fuggove a generatortol. Ha ott hasal el, a
 * KIADAS all meg. Parancskent barmikor ujra lefuttathato, es a hibaja csak
 * annyit jelent, hogy az a lap meg nincs meg.
 *
 * === A DATUMOK A VERZIOBOL JONNEK, NEM AZ ORABOL ===
 *
 * Acrobot merte le (2026-09-18): a `worksheet-sheet-mapping.ts` a
 * `version.issueDate` es a `version.closedAt` ertekeket veszi at, es a
 * generatorban nincs `new Date()` vagy `Date.now()`. Egy MA legyartott lap
 * tehat az augusztusi munkalaphoz is a HELYES, korabbi datumokat viseli.
 *
 * AKI EZT KESOBB "JAVITANA" a generalas idejere, epp a hitelesseget rontana
 * el: a lap arrol a napról szol, amikor a munka lezarult, nem arrol, amikor a
 * fajl keletkezett.
 *
 * === A KET MOD, ES MIERT A JELENTES AZ ALAPERTELMEZES ===
 *
 * Argumentum nelkul ez a parancs CSAK MER. Az iras kulon kapcsolo (`--ir`).
 * Ami sikeres futas utan BARMIT hagy maga utan, az nem meres, hanem muvelet.
 *
 * === HASZNALAT ===
 *
 * A fejlesztoi fan:
 *
 *     pnpm --filter @acropora/api worksheets:sheets
 *     pnpm --filter @acropora/api worksheets:sheets -- --ir
 *
 * AZ ELES KONTENERBEN A `pnpm` SCRIPT NEM HASZNALHATO (az `tsc`-t hiv, es a
 * production kep nem visel forditot). Ott a lefordított alakot kell inditani,
 * a MAR FUTO kontenerben:
 *
 *     docker exec -u node <api-konténer> node dist/worksheets/worksheet-sheet-backfill.cli.js
 *     docker exec -u node <api-konténer> node dist/worksheets/worksheet-sheet-backfill.cli.js --ir
 *
 * === A KILEPESI KODOK ===
 *
 *     0  nincs teendo, vagy az iras mindegyikkel vegzett
 *     1  VAN teendo (jelentes modban), vagy iras kozben egy sor elbukott
 *     2  a meres maga hasalt el -- NEM tudjuk, mi a helyzet
 */

export type Nyelo = (szoveg: string) => void;

const ALAPERTELMEZETT_NYELO: Nyelo = (szoveg) => {
  process.stdout.write(szoveg);
};

/**
 * A LEZART VERZIOK, A KIADOTT LAP MEGLETEVEL EGYUTT.
 *
 * A SZURES A `closedAt` MEZORE MEGY, NEM AZ ALLAPOTRA. Merve: ezt a mezot az
 * egesz modulban EGYETLEN hely irja, a `close()` -- tehat a "kitoltott
 * `closedAt`" pontosan azt jelenti, hogy ez a verzio atment a lezaraso n. Az
 * allapot ehhez kepest tovabb mozoghat (AWAITING_SIGNATURE, SIGNED, REJECTED),
 * es egy allapot-lista mindharmat kulon felsorolna -- a negyedik erteknel
 * pedig csendben kihagyna.
 */
/**
 * A KET FUTAS KET KULONBOZO KERDESRE VALASZOL, ES EZERT KET SZURO.
 *
 *   lezaraskori (`GENERATED_SHEET`)  minden LEZART verzio, aminek nincs
 *                                    lezaraskori lapja
 *   vegleges    (`SIGNED_SHEET`)     minden ALAIRT verzio, aminek nincs
 *                                    vegleges lapja
 *
 * A LEFEDETTSEG MINDIG UGYANARRA A TIPUSRA KERDEZ, AMIT IRNA. Ez nem formasag:
 * ha a lefedettseg egy MASIK tipust nezne, a parancs ujra es ujra legyartana
 * ugyanazt a lapot -- minden futasnal egyet, csendben.
 */
export type BackfillMod = {
  type: "GENERATED_SHEET" | "SIGNED_SHEET";
  /** MELY VERZIOKAT nezi egyaltalan. */
  where: { closedAt: { not: null } } | { status: "SIGNED" };
  cimke: string;
};

export const LEZARASKORI: BackfillMod = {
  type: "GENERATED_SHEET",
  where: { closedAt: { not: null } },
  cimke: "lezaraskori",
};

export const VEGLEGES: BackfillMod = {
  type: "SIGNED_SHEET",
  /*
    AZ ALLAPOTRA SZUR, NEM A `closedAt`-RE -- es ez a kulonbseg szandekos. A
    vegleges lap az ALAIRAS utan letezik; egy lezart, de alairatlan verzion
    ugyanaz a piszkozat-felirat allna rajta, mint a lezaraskorin, tehat nem
    lenne vegleges semmiben, csak a neveben.
  */
  where: { status: "SIGNED" },
  cimke: "vegleges",
};

async function fetchRows(
  mod: BackfillMod,
): Promise<WorksheetSheetBackfillRow[]> {
  const versions = await prisma.worksheetVersion.findMany({
    where: mod.where,
    select: {
      id: true,
      worksheetId: true,
      worksheet: { select: { number: true } },
      documents: { where: { type: mod.type }, select: { id: true } },
    },
  });
  return versions.map((v) => ({
    worksheetId: v.worksheetId,
    worksheetNumber: v.worksheet.number,
    versionId: v.id,
    hasSheet: v.documents.length > 0,
  }));
}

export async function main(
  argv: readonly string[],
  ki: Nyelo = ALAPERTELMEZETT_NYELO,
): Promise<number> {
  const ir = argv.includes("--ir");
  /*
    AZ ALAPERTELMEZES A REGI VISELKEDES. Egy mukodo parancs jelentese nem
    valtozhat meg attol, hogy uj kepesseget kap: aki a regi alakot hivja, a
    regi eredmenyt kapja.
  */
  const mod = argv.includes("--vegleges") ? VEGLEGES : LEZARASKORI;
  ki(`mod: ${mod.cimke} (${mod.type})\n`);
  let rows: WorksheetSheetBackfillRow[];
  try {
    rows = await fetchRows(mod);
  } catch (cause) {
    process.stderr.write(`a lekerdezes elhasalt: ${String(cause)}\n`);
    return 2;
  }

  const terv = planWorksheetSheetBackfill(rows);
  ki(`${describeWorksheetSheetCoverage(terv)}\n`);

  for (const sor of terv.skippedNoNumber)
    ki(`  SZAM NELKUL     ${sor.worksheetId} / ${sor.versionId}\n`);

  if (terv.candidates.length === 0) {
    ki("nincs teendo.\n");
    return 0;
  }

  if (!ir) {
    ki(
      `${terv.candidates.length} lezart verziohoz keszulne kiadott lap.\n` +
        "Ez a futas NEM IRT semmit. Az irashoz: --ir\n" +
        "A kilepesi kod 1: VAN teendo. Hiba eseten a kod 2.\n",
    );
    return 1;
  }

  /**
   * AZ IRO FELHASZNALO: NINCS. A `uploadedById` elhagyhato, es a
   * visszamenoleges generalast NEM egy ember vegzi -- egy kitalalt azonosito
   * azt allitana, hogy valaki feltoltotte.
   */
  const repository = new WorksheetsRepository();
  let bukott = 0;
  for (const sor of terv.candidates) {
    try {
      await repository.writeGeneratedSheetFor(
        prisma,
        sor.worksheetId,
        sor.versionId,
        null,
        mod.type,
      );
      ki(`  KESZ            ${sor.worksheetNumber} (${sor.versionId})\n`);
    } catch (cause) {
      bukott += 1;
      ki(
        `  NEM KESZULT     ${sor.worksheetNumber} (${sor.versionId}): ${String(cause)}\n`,
      );
    }
  }

  if (bukott > 0) {
    ki(`${bukott} lezart verziohoz NEM keszult lap.\n`);
    return 1;
  }
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
