import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import type { DocumentOwner } from "./document-store.js";
import {
  inlineJelentes,
  olvashatoMeret,
  type SorOsszegzes,
} from "./inline-document-report.js";

/**
 * MENNYI TARTALOM ALL MA A SOROKBAN -- A PARANCS, AMI EDDIG HIANYZOTT.
 *
 * A kartya (8f606437) azt kerdezi, mennyi helyet szabaditana fel a regi
 * dokumentum-sorok athelyezese a tarolora, es a valasz MERETLEN volt. Nem
 * jogosultsag es nem eszkoz hianyzott: a valasz az ADATBAN all, a fejlesztoi
 * kontenerbol pedig az eles adatbazis halozatilag nem erheto el. Amit innen meg
 * lehet tenni, az a PARANCS megirasa -- hogy aki eleri, egyet futtasson, ne
 * kutasson.
 *
 * Hasznalat (a cel adatbazist a `DATABASE_URL` adja, semmi nincs beegetve):
 *
 *     DATABASE_URL='...' pnpm --filter @acropora/api document:inline-report
 *
 * ES EZ A FEJLESZTOI ALAK -- AZ ELES KONTENERBEN NEM FUT LE. A fenti szkript
 * `tsc`-t hiv es egy `../../.env` fajlt olvas; a futo kep viszont
 * `pnpm deploy --prod` eredmenye, tehat NINCS benne fordito, es a valtozok
 * kornyezetiek, nem fajlbol jonnek. Aki ott probalja, forditasi hibat lat, es
 * azt hiszi, a MERESSEL van baj. A kontenerben a mar leforditott alak megy,
 * a hoszton allo kezbol:
 *
 *     docker exec <api-kontener> node dist/service-assets/document-store/inline-document-report.cli.js
 *
 * CSAK OLVAS. Nincs benne `create`, `update` es `delete` -- a sajat lapom
 * probaja szerint egy SIKERES futas utan csak TUDAS marad, semmi mas.
 *
 * === A `Record` ALAK SZANDEKOS, ES NEM DISZ ===
 *
 * Aki uj dokumentum-gazdat vesz fel a `DOCUMENT_OWNERS` halmazba, FORDITASI
 * HIBAT kap, amig ide is beir egy sort. Ugyanaz a megfontolas, mint a
 * `store-reconciliation.cli.ts`-ben: egy kezzel karbantartott lista pontosan az
 * uj gazdat hagyna ki -- azt, amiert a mero letezik.
 */

type Lekerdezes = () => Promise<SorOsszegzes | null>;

async function osszegez(
  owner: DocumentOwner,
  szamol: (
    hol: { storageKey: null } | { NOT: { storageKey: null } },
  ) => Promise<{
    _count: number;
    _sum: { sizeBytes: number | null };
  }>,
): Promise<SorOsszegzes> {
  const sorban = await szamol({ storageKey: null });
  const tarolon = await szamol({ NOT: { storageKey: null } });
  return {
    owner,
    sorbanAllo: sorban._count,
    sorbanAlloBajt: sorban._sum.sizeBytes ?? 0,
    tarolon: tarolon._count,
  };
}

const LEKERDEZESEK: Record<DocumentOwner, Lekerdezes> = {
  asset: () =>
    osszegez("asset", (where) =>
      prisma.assetDocument.aggregate({
        where,
        _count: true,
        _sum: { sizeBytes: true },
      }),
    ),
  worksheet: () =>
    osszegez("worksheet", (where) =>
      prisma.worksheetDocument.aggregate({
        where,
        _count: true,
        _sum: { sizeBytes: true },
      }),
    ),
  "service-job": () =>
    osszegez("service-job", (where) =>
      prisma.serviceJobDocument.aggregate({
        where,
        _count: true,
        _sum: { sizeBytes: true },
      }),
    ),
  /**
   * A TERMEKKEPEKNEK NINCS ILYEN TABLAJUK, es ezert ad `null`-t, nem nullat.
   * A ketto NEM ugyanaz: a nulla azt allitana, hogy megneztuk es ures. Egy
   * jelentes, ami egy nem letezo halmazra nullat ir, pontosan ugy nez ki, mint
   * egy ures halmaz -- es a kovetkezo olvaso abbol azt vonna le, hogy ott nincs
   * mit athelyezni.
   */
  product: async () => null,
};

export async function inlineDokumentumJelentes() {
  const sorok: SorOsszegzes[] = [];
  const kihagyott: DocumentOwner[] = [];
  for (const owner of Object.keys(LEKERDEZESEK) as DocumentOwner[]) {
    const sor = await LEKERDEZESEK[owner]();
    if (sor) sorok.push(sor);
    else kihagyott.push(owner);
  }
  return { jelentes: inlineJelentes(sorok), kihagyott };
}

async function main() {
  const { jelentes, kihagyott } = await inlineDokumentumJelentes();

  console.log("SORBAN ALLO DOKUMENTUMOK (storageKey nelkul)");
  for (const sor of jelentes.soronkent) {
    console.log(
      `  ${sor.owner.padEnd(12)} sorban: ${String(sor.sorbanAllo).padStart(6)}   ` +
        `${olvashatoMeret(sor.sorbanAlloBajt).padStart(10)} (${sor.sorbanAlloBajt} B)   ` +
        `tarolon: ${sor.tarolon}`,
    );
  }
  console.log(
    `  OSSZESEN     sorban: ${String(jelentes.osszesSorbanAllo).padStart(6)}   ` +
      `${olvashatoMeret(jelentes.osszesSorbanAlloBajt).padStart(10)} (${jelentes.osszesSorbanAlloBajt} B)   ` +
      `tarolon: ${jelentes.osszesTarolon}`,
  );
  if (kihagyott.length > 0)
    console.log(
      `  (nincs ilyen tabla, ezert nem szerepel: ${kihagyott.join(", ")})`,
    );
  console.log(
    "\nA szam a NYERS TARTALOM osszmerete -- az, ami ATKERULNE a tarolora.\n" +
      "NEM a felszabadulo lemezterulet: a Postgres a nagy ertekeket TOAST-ban\n" +
      "tomoritve tarolja, es a torles a helyet a tablanak hagyja, amig VACUUM\n" +
      "FULL nem fut.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (hiba) => {
      console.error(hiba);
      await prisma.$disconnect();
      process.exit(1);
    });
}
