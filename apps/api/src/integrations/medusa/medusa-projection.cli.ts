import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { runProjectionCli } from "./medusa-projection.runner.js";

/**
 * A PARANCS BELEPESI PONTJA, ES CSAK AZ.
 *
 * A torzs a `medusa-projection.runner.ts` modulban all, a hitelesites es a
 * kliens-epites a `medusa-projection.credentials.ts` modulban. Ez a fajl
 * MARAD a nyilvanos felulet: mindent, amit eddig exportalt, tovabb exportal,
 * tehat a negy testverparancs es a spec importja BETURE valtozatlan.
 *
 * MIERT NEM VITTUK AT AZ IMPORTOKAT A HIVOKBAN: egy kiemeles akkor merheto,
 * ha CSAK a helyet valtoztatja. Ha ugyanabban a korben tizenket import-sort is
 * atirunk ot fajlban, a diff mar nem mondja meg, mi mozdult es mi valtozott.
 */
export * from "./medusa-projection.credentials.js";
export * from "./medusa-projection.runner.js";

/**
 * KÉZZEL indított vetítés, termékazonosítónként.
 *
 * Szándékosan nincs ütemező és nincs kötegelés: ez a kör az első, ellenőrzött
 * átvitel, és az első éles betöltésnek ember által indított, egyszeri
 * műveletnek kell lennie. Ha ütemezőbe kötnénk, az első futás egy naplósorrá
 * válna, amit senki nem néz meg akkor, amikor a legfontosabb lenne.
 *
 * Használat:
 *   pnpm --filter @acropora/api medusa:project <termékazonosító> [további...]
 *   pnpm --filter @acropora/api medusa:project sku:TESZT0001 [további...]
 *
 * A `sku:` előtag azért van, mert ember cikkszámot ismer, nem belső
 * azonosítót. Előtag nélkül a paraméter termékazonosító. NEM találgatunk a két
 * alak között: egy „melyik lehet ez" heurisztika pont akkor tévedne, amikor egy
 * cikkszám véletlenül azonosítónak látszik.
 *
 * A KULCSOT NEM KELL ÁTADNI: a parancs a tárolt hitelesítő adatból dolgozik,
 * amit a Beállítások oldalon lehet megadni. A környezeti változó tartalék marad,
 * de nem néma: ha azon az úton megy, a parancs egy sorban kimondja. A CÍM
 * (`MEDUSA_ADMIN_URL`) továbbra is a környezetből jön, mert az nem titok.
 */

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runProjectionCli(process.argv.slice(2));
  await prisma.$disconnect();
  process.exit(code);
}
