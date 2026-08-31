import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  describeRefusalConflicts,
  findRefusalConflicts,
  type AuditableDatasheet,
} from "./datasheet-refusal-audit.js";

/**
 * AZ AUDIT FUTTATÓJA - a megtagadás-állapot MÁSODIK rétege.
 *
 * A séma egyetlen hézagja az, hogy egy mező ki lehet töltve, miközben áll rá egy
 * megtagadás-sor: a `CHECK` nem hivatkozhat másik táblára, és a mező neve itt
 * ADAT, nem oszlop. A döntés két réteget kért, és a kettő nem ugyanazt fedi le:
 * az alkalmazás-oldali őrző MEGELŐZ, de csak a normál írást látja; ez az audit
 * nem előz meg, viszont MINDENT lát, ami a táblában áll, akárhogy került oda.
 *
 * **EZ A PARANCS AZ, AMI A MÁSODIK RÉTEGET VALÓDIVÁ TESZI.** A tesztek azt
 * bizonyítják, hogy a detektor működik; egy adatbázisról csak ez mond valamit,
 * mert AZ ELLEN fut. Enélkül a második réteg papíron lenne meg.
 *
 * Használat (a cél adatbázist a `DATABASE_URL` adja, semmi nincs beégetve):
 *
 *     DATABASE_URL='...' pnpm --filter @acropora/api datasheet:audit
 *
 * A kilépési kód a lényeg, mert ez a parancs gépnek is szól:
 *
 *     0  nincs ellentmondó pár
 *     1  TALÁLT legalább egyet, és felsorolja
 *     2  a lekérdezés maga hasalt el (nem tudjuk, hogy van-e)
 *
 * A 2-es külön áll, és ez nem finomság: egy elérhetetlen adatbázis NEM
 * ugyanaz, mint egy tiszta adatbázis, és a kettőt egy közös nem-nulla kód
 * összemosná.
 */

/**
 * Az olvasás FÜGGVÉNYKÉNT, nem adatbázis-objektumként.
 *
 * Így a lekérdezés alakja EGY helyen áll, konkrét literállal - a Prisma abból
 * vezeti le a visszaadott sor típusát, tehát ha valaki elveszi a `refusals`
 * részt, a fordító szól. Egy `unknown` argumentumot fogadó felület ezt
 * elnyelné, és az audit csendben nulla megtagadást látna.
 */
export type FetchDatasheets = () => Promise<AuditableDatasheet[]>;

const fetchFromPrisma: FetchDatasheets = () =>
  prisma.productDatasheet.findMany({
    include: { refusals: { select: { mezo: true } } },
  });

export async function runDatasheetAuditCli(
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  fetchDatasheets: FetchDatasheets = fetchFromPrisma,
): Promise<number> {
  let sheets: AuditableDatasheet[];
  try {
    sheets = await fetchDatasheets();
  } catch (error) {
    out.stderr(
      `Az adatlapok lekérdezése elhasalt: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        `Ez NEM azt jelenti, hogy nincs ellentmondó pár - azt jelenti, hogy nem ` +
        `tudjuk. A kilépési kód ezért 2, nem 1.\n`,
    );
    return 2;
  }

  const conflicts = findRefusalConflicts(sheets);

  /**
   * A DARABSZÁM AKKOR IS KIÍRÓDIK, HA NULLA. Enélkül egy üres adatbázison futó
   * audit ugyanúgy nézne ki, mint egy tele adatbázison futó tiszta eredmény - és
   * pont ez a különbség számít, amikor valaki egy zöld sorra hivatkozik.
   */
  out.stdout(
    `${sheets.length} adatlap megnézve.\n${describeRefusalConflicts(conflicts)}\n`,
  );

  return conflicts.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runDatasheetAuditCli();
  await prisma.$disconnect();
  process.exit(code);
}
