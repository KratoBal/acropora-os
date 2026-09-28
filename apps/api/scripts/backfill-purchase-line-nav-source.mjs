#!/usr/bin/env node
/**
 * A MEGLEVO BESZERZESI SZAMLASOROK VISSZATOLTESE: NAV sorszam es eredeti
 * sorszoveg (#1199 A-007).
 *
 * ALAPBOL CSAK OLVAS (`READ ONLY` tranzakcio), es megszamolja, hany sor
 * parosithato egyertelmuen, es miert marad a tobbi `null`. Irni csak az
 * `--apply` kapcsoloval ir, es akkor is csak azt a sort, aminek a NAV mezoje
 * meg ures: futtathato tobbszor, ki nem toltott erteket nem ir felul.
 *
 * A parositas szabalya a `nav-line-source.ts`-ben all (`pairExistingLines`):
 * a sor szovege PONTOSAN egyezik egy NAV sor szovegevel, es a szoveg mindket
 * oldalon egyszer fordul elo.
 *
 * Hasznalat (a repo gyokerebol, elotte `pnpm --filter @acropora/api build`):
 *
 *   DATABASE_URL=... node apps/api/scripts/backfill-purchase-line-nav-source.mjs
 *   DATABASE_URL=... node apps/api/scripts/backfill-purchase-line-nav-source.mjs --apply
 *
 * Szoveget nem ir ki, csak szamokat.
 *
 * Kilepesi kod: 0 kesz; 1 bemeneti hiba; 2 adatbazis-hiba.
 */
import { prisma } from "@acropora/database";

import {
  navSourceLines,
  pairExistingLines,
} from "../dist/purchasing/nav-line-source.js";

const ISMERT = new Set(["--apply"]);
const ismeretlen = process.argv.slice(2).filter((a) => !ISMERT.has(a));
if (ismeretlen.length) {
  console.error(`Ismeretlen argumentum: ${ismeretlen.join(" ")}`);
  console.error("Használat: [--apply]");
  process.exit(1);
}
const apply = process.argv.includes("--apply");

const SOR = { id: true, sourceDescription: true, navLineNumber: true };

async function felmer(db) {
  const navSzamlak = await db.navIncomingInvoice.findMany({
    where: { purchaseInvoiceId: { not: null } },
    select: { purchaseInvoiceId: true, parsedData: true },
  });
  const osszeg = {
    navInvoices: navSzamlak.length,
    lines: 0,
    paired: 0,
    noNavData: 0,
    skipped: {
      alreadySet: 0,
      noText: 0,
      noMatch: 0,
      ambiguous: 0,
      invalidLineNumber: 0,
    },
  };
  const parok = [];
  for (const nav of navSzamlak) {
    const sorok = await db.purchaseInvoiceLine.findMany({
      where: { purchaseInvoiceId: nav.purchaseInvoiceId },
      select: SOR,
    });
    osszeg.lines += sorok.length;
    const navSorok = navSourceLines(nav.parsedData);
    if (!navSorok) {
      osszeg.noNavData += sorok.length;
      continue;
    }
    const { pairs, skipped } = pairExistingLines(sorok, navSorok);
    parok.push(...pairs);
    osszeg.paired += pairs.length;
    for (const [ok, db_] of Object.entries(skipped)) osszeg.skipped[ok] += db_;
  }
  /* A NAV-bol rogzitett, de NAV szamlahoz nem kotott bizonylatok sorai: ezekhez
     nincs tarolt NAV adat, tehat nem is lehet visszatolteni. */
  osszeg.huNavWithoutNavLink = await db.purchaseInvoiceLine.count({
    where: {
      purchaseInvoice: { source: "HU_NAV", navIncomingInvoice: { is: null } },
    },
  });
  return { osszeg, parok };
}

function kiir(osszeg) {
  const s = osszeg.skipped;
  console.log(
    [
      `NAV számlához kötött bizonylat: ${osszeg.navInvoices}, soraik: ${osszeg.lines}`,
      `egyértelműen párosítható: ${osszeg.paired}`,
      `null marad: már kitöltve ${s.alreadySet}, szöveg nélkül ${s.noText}, nincs egyező NAV sor ${s.noMatch}, nem egyértelmű ${s.ambiguous}, rossz NAV sorszám ${s.invalidLineNumber}, nincs tárolt NAV adat ${osszeg.noNavData}`,
      `HU_NAV bizonylat NAV kapcsolat nélkül, sorai: ${osszeg.huNavWithoutNavLink}`,
    ].join("\n"),
  );
}

try {
  if (!apply) {
    const { osszeg } = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return felmer(tx);
      },
      { timeout: 120_000 },
    );
    kiir(osszeg);
    console.log("csak olvasás volt; íráshoz: --apply");
  } else {
    const { osszeg, irt } = await prisma.$transaction(
      async (tx) => {
        const { osszeg, parok } = await felmer(tx);
        let irt = 0;
        for (const par of parok) {
          const { count } = await tx.purchaseInvoiceLine.updateMany({
            where: { id: par.id, navLineNumber: null },
            data: {
              navLineNumber: par.navLineNumber,
              navLineDescription: par.navLineDescription,
            },
          });
          irt += count;
        }
        return { osszeg, irt };
      },
      { timeout: 300_000 },
    );
    kiir(osszeg);
    console.log(`kiírt sor: ${irt}`);
  }
} catch (hiba) {
  /* Csak az uzenet: a Prisma hibaja a gepet es a portot nevezi meg, a jelszot nem. */
  console.error(
    `MEGÁLLOK: ${hiba instanceof Error ? hiba.message.trim() : String(hiba)}`,
  );
  process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
