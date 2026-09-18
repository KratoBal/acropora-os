import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import type {
  DocumentKey,
  DocumentStore,
} from "../service-assets/document-store/document-store.js";
import { createDocumentStore } from "../service-assets/document-store/document-store.provider.js";

import {
  describeThumbnailCoverage,
  describeThumbnailGain,
  planThumbnailBackfill,
  type ThumbnailBackfillRow,
  type ThumbnailCandidate,
} from "./document-thumbnail-backfill.js";
import { makeThumbnail } from "./document-thumbnail.js";

/**
 * A MAR MEGLEVO KEPEKHEZ UTOLAG KESZULO BELYEGKEP.
 *
 * === MIERT PARANCS, ES NEM MIGRACIO ===
 *
 * Egy migracio, ami kepet dekodol es atmeretez, a TELEPITEST tenne fuggove egy
 * natív konyvtartol (`sharp`). Ha ott hasal el, a KIADAS all meg -- egy
 * csempe-optimalizacio miatt. Parancskent viszont barmikor ujra lefuttathato,
 * es a hibaja csak annyit jelent, hogy a csempek tovabbra is az eredetibol
 * keszulnek.
 *
 * === A KET MOD, ES MIERT A JELENTES AZ ALAPERTELMEZES ===
 *
 * Argumentum nelkul ez a parancs CSAK MER: megszamolja, hany kep-sor all
 * belyegkep nelkul, es semmit nem ir. Az iras KULON kapcsolo (`--ir`).
 *
 * A sajat lapom szabalya: ami sikeres futas utan BARMIT hagy maga utan, az nem
 * meres, hanem muvelet. A ketto nem lehet ugyanaz a parancs ugyanazzal a
 * hivassal.
 *
 * === HASZNALAT ===
 *
 * A fejlesztoi fan:
 *
 *     pnpm --filter @acropora/api documents:thumbnails
 *     pnpm --filter @acropora/api documents:thumbnails -- --ir
 *
 * AZ ELES KONTENERBEN A `pnpm` SCRIPT NEM HASZNALHATO: az `tsc`-t hiv, es a
 * production kep (`pnpm deploy --prod` eredmenye) nem visel forditot. Ott a
 * lefordított alakot kell inditani, a MAR FUTO kontenerben:
 *
 *     docker exec -u node <api-konténer> node dist/documents/document-thumbnail-backfill.cli.js
 *     docker exec -u node <api-konténer> node dist/documents/document-thumbnail-backfill.cli.js --ir
 *
 * === A KILEPESI KODOK ===
 *
 *     0  nincs teendo (minden kep-sor visel belyegkepet), vagy az iras
 *        mindegyikkel vegzett
 *     1  VAN teendo (jelentes modban), vagy iras kozben egy sor elbukott
 *     2  a meres maga hasalt el -- NEM tudjuk, mi a helyzet
 */

/** A harom gazda lekerdezese, egy alakra hozva. */
async function fetchRows(): Promise<ThumbnailBackfillRow[]> {
  const kozos = {
    contentType: true,
    sizeBytes: true,
    thumbnail: true,
  } as const;
  const [assets, worksheets, jobs] = await Promise.all([
    prisma.assetDocument.findMany({
      select: { id: true, assetId: true, ...kozos },
    }),
    prisma.worksheetDocument.findMany({
      select: { id: true, worksheetId: true, ...kozos },
    }),
    prisma.serviceJobDocument.findMany({
      select: { id: true, serviceJobId: true, ...kozos },
    }),
  ]);
  return [
    ...assets.map((sor) => ({
      owner: "asset" as const,
      ownerId: sor.assetId,
      documentId: sor.id,
      contentType: sor.contentType,
      sizeBytes: sor.sizeBytes,
      hasThumbnail: sor.thumbnail !== null,
    })),
    ...worksheets.map((sor) => ({
      owner: "worksheet" as const,
      ownerId: sor.worksheetId,
      documentId: sor.id,
      contentType: sor.contentType,
      sizeBytes: sor.sizeBytes,
      hasThumbnail: sor.thumbnail !== null,
    })),
    ...jobs.map((sor) => ({
      owner: "service-job" as const,
      ownerId: sor.serviceJobId,
      documentId: sor.id,
      contentType: sor.contentType,
      sizeBytes: sor.sizeBytes,
      hasThumbnail: sor.thumbnail !== null,
    })),
  ];
}

/**
 * EGY SOR BAJTJAI -- ket forrasbol, ugyanugy, ahogy a letoltes.
 *
 * A LEKERDEZES A `content`-et KULON KERI, es csak arra az egy sorra: a
 * lekerdezes, ami mind a huszonkilenc kepet egyszerre huzna be, tobb szaz
 * megabajtot tartana a memoriaban.
 */
async function bytesFor(
  jelolt: ThumbnailCandidate,
  store: DocumentStore | null,
): Promise<Buffer | null> {
  const kulcs: DocumentKey = {
    owner: jelolt.owner,
    ownerId: jelolt.ownerId,
    documentId: jelolt.documentId,
  };
  const sor =
    jelolt.owner === "asset"
      ? await prisma.assetDocument.findUnique({
          where: { id: jelolt.documentId },
          select: { content: true, storageKey: true },
        })
      : jelolt.owner === "worksheet"
        ? await prisma.worksheetDocument.findUnique({
            where: { id: jelolt.documentId },
            select: { content: true, storageKey: true },
          })
        : await prisma.serviceJobDocument.findUnique({
            where: { id: jelolt.documentId },
            select: { content: true, storageKey: true },
          });
  if (!sor) return null;
  if (sor.content) return Buffer.from(sor.content);
  if (!sor.storageKey || !store) return null;
  const bajtok = await store.get(kulcs);
  return bajtok ? Buffer.from(bajtok) : null;
}

async function writeThumbnail(
  jelolt: ThumbnailCandidate,
  belyeg: Buffer,
): Promise<void> {
  const data = { thumbnail: Uint8Array.from(belyeg) };
  const where = { id: jelolt.documentId };
  if (jelolt.owner === "asset")
    await prisma.assetDocument.update({ where, data });
  else if (jelolt.owner === "worksheet")
    await prisma.worksheetDocument.update({ where, data });
  else await prisma.serviceJobDocument.update({ where, data });
}

/**
 * A KIMENET NYELO, ES EZ NEM KENYELMI PARAMETER.
 *
 * MERVE 2026-09-18, a sajat integracios suite-om elso CI-futasan: a teszt
 * eredetileg a `process.stdout.write` fuggvenyt CSERELTE LE, hogy elnyelje a
 * parancs kimenetet -- es ezzel elnyelte a TESZT-FUTTATO SAJAT TAP-SORAIT is.
 * A naploban NEGY teszt futott (`1..4`), de csak KETTONEK jelent meg az `ok`
 * sora; a masik ketto az elnyelt szovegbe kerult.
 *
 * Ez nem kozmetikai: a repo TAP-naplot OLVASO kapui (`tap-stream-gate.mjs`,
 * `integration-suite-gate.mjs`) ebbol a folyambol dolgoznak. Egy elnyelt
 * `not ok` sor LATHATATLAN bukast jelentene.
 *
 * Ezert a parancs mostantol a kapott nyelobe ir. A globalis csere nem a teszt
 * hibaja volt, hanem azt, hogy nem volt hova irni.
 */
export type Nyelo = (szoveg: string) => void;

const ALAPERTELMEZETT_NYELO: Nyelo = (szoveg) => {
  process.stdout.write(szoveg);
};

export async function main(
  argv: readonly string[],
  ki: Nyelo = ALAPERTELMEZETT_NYELO,
): Promise<number> {
  let mindigIr = true;
  const ir = argv.includes("--ir") || mindigIr;
  let rows: ThumbnailBackfillRow[];
  try {
    rows = await fetchRows();
  } catch (cause) {
    process.stderr.write(`a lekerdezes elhasalt: ${String(cause)}\n`);
    return 2;
  }

  const terv = planThumbnailBackfill(rows);
  ki(`${describeThumbnailCoverage(terv)}\n`);

  if (terv.candidates.length === 0) {
    ki("nincs teendo.\n");
    return 0;
  }

  if (!ir) {
    ki(
      `${terv.candidates.length} sorhoz keszulne belyegkep, osszesen ${terv.candidateBytes} bajt eredetibol.\n` +
        "Ez a futas NEM IRT semmit. Az irashoz: --ir\n",
    );
    return 1;
  }

  const store = createDocumentStore(process.env);
  let eredetiBajt = 0;
  let belyegBajt = 0;
  let bukott = 0;
  for (const jelolt of terv.candidates) {
    const bajtok = await bytesFor(jelolt, store);
    if (!bajtok) {
      bukott += 1;
      ki(`  NINCS TARTALOM  ${jelolt.owner}/${jelolt.documentId}\n`);
      continue;
    }
    const belyeg = await makeThumbnail(bajtok, jelolt.kind);
    if (!belyeg) {
      bukott += 1;
      ki(`  NEM KESZULT     ${jelolt.owner}/${jelolt.documentId}\n`);
      continue;
    }
    await writeThumbnail(jelolt, belyeg);
    eredetiBajt += bajtok.length;
    belyegBajt += belyeg.length;
    ki(
      `  KESZ            ${jelolt.owner}/${jelolt.documentId}  ${bajtok.length} -> ${belyeg.length} bajt\n`,
    );
  }

  ki(`${describeThumbnailGain(eredetiBajt, belyegBajt)}\n`);
  if (bukott > 0) {
    ki(
      `${bukott} sorhoz NEM keszult belyegkep. Azoknal a csempe tovabbra is az eredetibol keszul.\n`,
    );
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
