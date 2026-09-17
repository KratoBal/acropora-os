import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { runKapcsolatUjraepites } from "./unas-kapcsolat-ujraepites.runner.js";

/**
 * A PARANCSSORI ALAK -- ES MOSTANTOL CSAK AZ.
 *
 * A torzs a `unas-kapcsolat-ujraepites.mag.ts` fajlban all, a valodi
 * adatbazis-bekotes a `...runner.ts`-ben. Ez a fajl nem exportal semmit, tehat
 * senki nem importalhatja -- es epp ez a lenyeg: amig a torzs ITT allt, a
 * futtato visszafele importalt, es a kor miatt a parancs EL SEM INDULT
 * (kilepesi kod 13, nulla kimenet; merve 2026-09-17 este az eles kontenerben).
 *
 * A `--help` NEM kenyelmi kapcsolo: ez az EGYETLEN ut, amin a parancs INDULASA
 * adatbazis nelkul merheto. A `unas-kapcsolat-ujraepites.parancs.spec.ts` ezt a
 * FORDITOTT alakot inditja el egy kulon folyamatban, es azt meri, hogy nulla
 * kilepesi koddal es NEM URES kimenettel ter vissza. A torzsre irt harom orzo
 * mind zold volt, mikozben a parancs nem indult el -- egy fixture-on hivott
 * fuggveny nem tud a modul-betoltesrol semmit.
 */
const HASZNALAT = `A UNAS kapcsolat-ujraepites parancsa.

  node dist/imports/unas/unas-kapcsolat-ujraepites.cli.js [kapcsolok]

    (kapcsolo nelkul)      TERVET keszit, semmit nem ir
    --apply                irja is a kapcsolatokat
    --nagy-valtozas-is     a 10 szazalekos hatart tudatosan atlepi
    --help                 ez a szoveg

Minden futas sort ir a UnasRelationRebuildRun tablaba, a megallt is.
A futasok olvasasa: pnpm run unas:kapcsolat-futasok
`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes("--help")) {
    process.stdout.write(HASZNALAT);
    process.exit(0);
  }
  const code = await runKapcsolatUjraepites(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  });
  await prisma.$disconnect();
  process.exit(code);
}
