import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

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

type NyersSor = {
  sorban: bigint;
  sorban_bajt: bigint;
  sorban_nyers: bigint;
  mindketto: bigint;
  mindketto_bajt: bigint;
  mindketto_nyers: bigint;
  csak_tarolon: bigint;
  egyik_sem: bigint;
};

/**
 * EGY LEKERDEZES TABLANKENT, NEGY HALMAZRA -- ES NYERS SQL, NEM `aggregate`.
 *
 * Ket dolgot a Prisma aggregatuma nem tud: a `FILTER (WHERE ...)` alaku
 * halmaz-bontast egyetlen menetben, es az `octet_length(content)` osszegzeset.
 * A negy halmaz teendoje KULONBOZIK, tehat kulon szamot kell kapniuk; a nyers
 * hossz pedig azert kell, mert ez a jelentes REGI sorokrol szol, es a
 * `sizeBytes`-t a MAI iro ut szamolja.
 */
async function tablaOsszegzes(
  owner: DocumentOwner,
  tabla: Prisma.Sql,
): Promise<SorOsszegzes> {
  const [sor] = await prisma.$queryRaw<NyersSor[]>`
    SELECT
      count(*) FILTER (WHERE "content" IS NOT NULL AND "storageKey" IS NULL) AS sorban,
      coalesce(sum("sizeBytes") FILTER (WHERE "content" IS NOT NULL AND "storageKey" IS NULL), 0) AS sorban_bajt,
      coalesce(sum(octet_length("content")) FILTER (WHERE "content" IS NOT NULL AND "storageKey" IS NULL), 0) AS sorban_nyers,
      count(*) FILTER (WHERE "content" IS NOT NULL AND "storageKey" IS NOT NULL) AS mindketto,
      coalesce(sum("sizeBytes") FILTER (WHERE "content" IS NOT NULL AND "storageKey" IS NOT NULL), 0) AS mindketto_bajt,
      coalesce(sum(octet_length("content")) FILTER (WHERE "content" IS NOT NULL AND "storageKey" IS NOT NULL), 0) AS mindketto_nyers,
      count(*) FILTER (WHERE "content" IS NULL AND "storageKey" IS NOT NULL) AS csak_tarolon,
      count(*) FILTER (WHERE "content" IS NULL AND "storageKey" IS NULL) AS egyik_sem
    FROM ${tabla}
  `;
  /*
    EGY AGGREGATUM MINDIG EGY SORT AD -- meg ures tablan is. Ha megsem, akkor
    nem ures halmazrol van szo, hanem arrol, hogy a lekerdezes nem azt csinalta,
    amit hiszunk; egy `?? 0` itt csendben nullat jelentene, es a jelentes
    "nincs mit athelyezni" alakban hazudna.
  */
  if (!sor) throw new Error(`A(z) ${owner} osszegzese nem adott sort.`);
  const szam = (b: bigint | number) => Number(b);
  return {
    owner,
    sorbanAllo: szam(sor.sorban),
    sorbanAlloBajt: szam(sor.sorban_bajt),
    sorbanAlloNyersBajt: szam(sor.sorban_nyers),
    mindketHelyen: szam(sor.mindketto),
    mindketHelyenBajt: szam(sor.mindketto_bajt),
    mindketHelyenNyersBajt: szam(sor.mindketto_nyers),
    csakTarolon: szam(sor.csak_tarolon),
    egyikSem: szam(sor.egyik_sem),
  };
}

const LEKERDEZESEK: Record<DocumentOwner, () => Promise<SorOsszegzes | null>> =
  {
    asset: () => tablaOsszegzes("asset", Prisma.sql`"AssetDocument"`),
    worksheet: () =>
      tablaOsszegzes("worksheet", Prisma.sql`"WorksheetDocument"`),
    "service-job": () =>
      tablaOsszegzes("service-job", Prisma.sql`"ServiceJobDocument"`),
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

  const sor = (cimke: string, db: number, bajt: number, nyers: number) =>
    `  ${cimke.padEnd(26)} ${String(db).padStart(6)} db   ` +
    `${olvashatoMeret(bajt).padStart(10)} (${bajt} B)` +
    (nyers !== bajt ? `   NYERS: ${olvashatoMeret(nyers)} (${nyers} B)` : "");

  console.log("DOKUMENTUM-SOROK, NEGY HALMAZBAN\n");
  for (const s of jelentes.soronkent) {
    console.log(`${s.owner}:`);
    console.log(
      sor(
        "csak sorban (athelyezendo)",
        s.sorbanAllo,
        s.sorbanAlloBajt,
        s.sorbanAlloNyersBajt,
      ),
    );
    console.log(
      sor(
        "mindket helyen (MA torolheto)",
        s.mindketHelyen,
        s.mindketHelyenBajt,
        s.mindketHelyenNyersBajt,
      ),
    );
    console.log(
      `  ${"csak a tarolon".padEnd(26)} ${String(s.csakTarolon).padStart(6)} db`,
    );
    console.log(
      `  ${"egyik helyen sem".padEnd(26)} ${String(s.egyikSem).padStart(6)} db` +
        (s.egyikSem > 0 ? "   <- LELET: a megkotes ezt kizarja" : ""),
    );
  }
  console.log("\nOSSZESEN:");
  console.log(
    sor(
      "csak sorban (athelyezendo)",
      jelentes.osszesSorbanAllo,
      jelentes.osszesSorbanAlloBajt,
      jelentes.osszesSorbanAlloNyersBajt,
    ),
  );
  console.log(
    sor(
      "mindket helyen (MA torolheto)",
      jelentes.osszesMindketHelyen,
      jelentes.osszesMindketHelyenBajt,
      jelentes.osszesMindketHelyenNyersBajt,
    ),
  );
  console.log(
    `  ${"csak a tarolon".padEnd(26)} ${String(jelentes.osszesCsakTarolon).padStart(6)} db`,
  );
  console.log(
    `  ${"egyik helyen sem".padEnd(26)} ${String(jelentes.osszesEgyikSem).padStart(6)} db`,
  );

  if (kihagyott.length > 0)
    console.log(
      `  (nincs ilyen tabla, ezert nem szerepel: ${kihagyott.join(", ")})`,
    );
  console.log(
    "\nA KET SZAM TEENDOJE MAS: a 'csak sorban' allo tartalmat AT KELL HELYEZNI,\n" +
      "a 'mindket helyen' allot viszont csak TOROLNI a sorbol (a tarolon mar ott van).\n" +
      "Ahol a NYERS hossz eltér a `sizeBytes`-tol, ott a kulonbseg maga a lelet.\n\n" +
      "ES EGYIK SZAM SEM A FELSZABADULO LEMEZTERULET: a Postgres a nagy ertekeket\n" +
      "TOAST-ban tomoritve tarolja, es a torles a helyet a tablanak hagyja, amig\n" +
      "VACUUM FULL nem fut.",
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
