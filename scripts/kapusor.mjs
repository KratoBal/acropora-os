#!/usr/bin/env node
/**
 * A TELJES KAPUSOR EGY PARANCSBAN, A VART FELADATSZAMMAL EGYUTT.
 *
 * MIERT LETEZIK. A `turbo run test` kimenete akkor is BIZTATONAK latszik, ha a
 * fele le sem futott: ha egy csomag `build` lepese elhasal, a RA EPULO teszt-
 * feladat el sem indul, tehat NULLA hiba-sor keletkezik. Aki a kimenetet
 * bukasra szuri, ures talalatot kap -- ami beture ugyanugy nez ki, mint egy
 * tiszta futas.
 *
 * Merve 2026-09-22, gyoker `.env` nelkul:
 *
 *     a turbo kilepesi kodja   1        <- ez HANGOS, es helyes
 *     Tasks:                   3 successful, 7 total   <- a nevezo 12-rol esett
 *     `# fail` sorok szama     0        <- ez a NEMA resz
 *
 * A kilepesi kod tehat NEM nema. Ami nema, az a NEVEZO: hany feladat futott
 * volna, es hany futott. Ezert meri ez a szkript mind a kettot.
 *
 * MIERT NINCS BENNE KEZZEL IRT VART SZAM. Egy beirt "12" a leiras napjan igaz,
 * es nem oregszik: egy uj csomag utan HAZUDNA, amig valaki at nem irja. Ezert a
 * vart erteket magatol a turbotol kerjuk el (`--dry-run=json`), minden futas
 * elott.
 *
 * ES A SZURES NEM RESZLET: a szarazfutas azokat a feladatokat IS felsorolja,
 * amikhez a csomagnak nincs szkriptje -- `command: "<NONEXISTENT>"` alakban, es
 * a valodi futas ezeket kihagyja. Merve: a `test` szarazfutasa 14 feladatot ad,
 * ebbol ketto (`@acropora/config#test`, `@acropora/ui#test`) nem letezik, tehat
 * a valodi futas 12. E nelkul a szures a kapu MINDEN tiszta futason pirosat
 * adna -- vagyis egy orzo, ami mindig szol, ugyanannyit er, mint amelyik soha.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const NEM_LETEZO = "<NONEXISTENT>";

/**
 * A TYPECHECK ELOTT A NEXT-APPOK GENERALT `.next/types` MAPPAJA TORLODIK.
 *
 * Merve 2026-09-30: a Next-appok `tsconfig`-ja bevonja a `.next/types/**` fajlokat,
 * amiket csak a `next build` general. Ha egy agvaltas oldalt mozgat vagy torol,
 * a regi `validator.ts` nem letezo oldalra mutat (TS2307), es mivel ez a sor a
 * typecheck-et a build ELOTT futtatja, a typecheck bukik -- a build-lepes pedig
 * utana csendben kijavitja. Kontroll: friss build utan egy #1277 elotti agra
 * valtva a web typecheck `exit 2`, visszavaltva `exit 0`.
 *
 * A torles azt a tiszta kicsekkolast allitja elo, amin a CI is fut. Hogy a
 * typecheck a generalt fajlok NELKUL is lefut, azt az
 * `apps/api/src/common/next-typecheck-gate.spec.ts` orzi (GLOB a hivatkozas, a
 * `skipLibCheck` sehol sincs kikapcsolva); ha az piros, ez a torles is
 * typecheck-hibat fog okozni, es ott van a javitas helye, nem itt.
 */
function generaltNextTipusokTorlese() {
  const appsDir = join(process.cwd(), "apps");
  for (const app of readdirSync(appsDir, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const nextApp = ["ts", "js", "mjs", "cjs"].some((v) =>
      existsSync(join(appsDir, app.name, `next.config.${v}`)),
    );
    const tipusok = join(appsDir, app.name, ".next", "types");
    if (nextApp && existsSync(tipusok)) {
      rmSync(tipusok, { recursive: true, force: true });
      console.log(`             torolve: apps/${app.name}/.next/types`);
    }
  }
}

/** A turbo sajat szamitasa arrol, hany feladat fut VALOJABAN. */
function vartFeladatszam(feladat) {
  const eredmeny = spawnSync(
    "pnpm",
    ["turbo", "run", feladat, "--dry-run=json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (eredmeny.status !== 0) return null;
  try {
    const adat = JSON.parse(eredmeny.stdout);
    return (adat.tasks ?? []).filter((t) => t.command !== NEM_LETEZO).length;
  } catch {
    return null;
  }
}

/** A `Tasks: N successful, M total` sor mindket szama. */
function feladatSzamok(kimenet) {
  const talalat = kimenet.match(/Tasks:\s+(\d+) successful, (\d+) total/);
  if (!talalat) return null;
  return { sikeres: Number(talalat[1]), osszes: Number(talalat[2]) };
}

function futtat(nev, parancs, argumentumok) {
  process.stdout.write(`${nev.padEnd(12)} fut...\n`);
  const eredmeny = spawnSync(parancs, argumentumok, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    kod: eredmeny.status,
    kimenet: `${eredmeny.stdout ?? ""}${eredmeny.stderr ?? ""}`,
  };
}

const KAPUK = [
  { nev: "format", parancs: ["pnpm", "run", "format:check"], turbo: null },
  {
    nev: "typecheck",
    parancs: ["pnpm", "turbo", "run", "typecheck", "--force"],
    turbo: "typecheck",
    elotte: generaltNextTipusokTorlese,
  },
  {
    nev: "test",
    parancs: ["pnpm", "turbo", "run", "test", "--force"],
    turbo: "test",
  },
  {
    nev: "build",
    parancs: ["pnpm", "turbo", "run", "build", "--force"],
    turbo: "build",
  },
];

let bukott = false;

for (const kapu of KAPUK) {
  kapu.elotte?.();
  const vart = kapu.turbo ? vartFeladatszam(kapu.turbo) : null;
  const { kod, kimenet } = futtat(
    kapu.nev,
    kapu.parancs[0],
    kapu.parancs.slice(1),
  );

  if (kapu.turbo) {
    const szamok = feladatSzamok(kimenet);
    if (!szamok) {
      console.log("             NINCS `Tasks:` SOR a kimenetben.");
      console.log(
        "             Ez nem reszlet: e nelkul nem tudjuk, mennyi futott.",
      );
      bukott = true;
    } else {
      console.log(
        `             Tasks: ${szamok.sikeres} sikeres, ${szamok.osszes} osszesen`,
      );
      if (vart === null) {
        console.log(
          "             A VART SZAM NEM MERHETO (a szarazfutas elhasalt).",
        );
        console.log(
          "             A hanyados igy csak onmagahoz kepest ertelmes.",
        );
        bukott = true;
      } else if (szamok.osszes < vart) {
        /**
         * EZ A NEMA ESET, es ezert all kulon a ket irany. Ha a nevezo KISEBB a
         * vartnal, akkor egy feladat el sem indult -- jellemzoen azert, mert
         * amitol fugg, elhasalt. A maradek zoldje ilyenkor teljes futasnak
         * latszik.
         */
        console.log(
          `             FELADAT ESETT KI: ${szamok.osszes} futott, ${vart} a vart.`,
        );
        console.log(
          "             Ez a NEMA eset: ha a maradek zold, a sor teljesen zoldnek latszik.",
        );
        bukott = true;
      } else if (szamok.osszes > vart) {
        /**
         * A MASIK IRANY NEM HIBA, csak azt jelenti, hogy a munkater valtozott
         * a szarazfutas ota. Kulon all, mert MAS a teendo: itt nincs mit
         * javitani, csak tudni kell rola.
         */
        console.log(
          `             UJ FELADAT JELENT MEG: ${szamok.osszes} futott, ${vart} a vart.`,
        );
      }
    }
  }

  if (kod !== 0) {
    console.log(`             BUKOTT (kilepesi kod ${kod}).`);
    bukott = true;
  } else {
    console.log("             zold");
  }
}

if (bukott) {
  console.log("\nVOLT BUKOTT KAPU -- lasd fent.");
  process.exit(1);
}
console.log(
  "\nMIND A NEGY KAPU ZOLD (a MOBIL kulon fut: pnpm mobile:lint, mobile:typecheck, mobile:test).",
);
