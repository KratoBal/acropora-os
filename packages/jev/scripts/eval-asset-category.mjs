#!/usr/bin/env node
/**
 * JEV V0 OFFLINE KIERTEKELO: service-assets.asset-category.
 *
 * Szerzodes: KratoBal/acropora-os #1199 (ACD-003 Q-004, ACD-004, PD-002
 * ACCEPT). OFFLINE: az adatbazist CSAK OLVASSA, semmit nem ir, es nincs eles
 * hivasi ut -- az API nem importalja ezt a csomagot.
 *
 * Hasznalat (a repo gyokerebol, elotte `pnpm --filter @acropora/jev build`):
 *
 *   DATABASE_URL=... node packages/jev/scripts/eval-asset-category.mjs \
 *     --golden <arany.csv> --dry-run
 *
 *   DATABASE_URL=... TYPESAFE_API_KEY=... \
 *     node packages/jev/scripts/eval-asset-category.mjs \
 *     --golden <arany.csv> --out <mappa>
 *
 * --dry-run: kulcs es Jev-hivas NELKUL. Kiirja az elotag-szabalyok
 *            szamat es az elso 20 vetuletet -- a fizetos futas elott igy
 *            ellenorizheto, mit latna a modell.
 *
 * A KULCS a `TYPESAFE_API_KEY` kornyezeti valtozobol jon. Nem kerul
 * parancssorba, naploba, riportba.
 *
 * Kilepesi kod: 0 kesz; 1 bemeneti hiba (a Jev nem hivodott); 2 a rogzitett
 * modell nem erheto el, a futas megallt.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@acropora/database";

import {
  cph1,
  cph1Canonical,
  parseGoldenCsv,
  projectAssetCategory,
  reportMarkdown,
  runAssetCategoryEvaluation,
} from "../dist/index.js";

function argumentum(nev) {
  const i = process.argv.indexOf(nev);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const goldenPath = argumentum("--golden");
const outDir = argumentum("--out");
const dryRun = process.argv.includes("--dry-run");
if (!goldenPath || (!dryRun && !outDir)) {
  console.error("Használat: --golden <csv> (--dry-run | --out <mappa>)");
  process.exit(1);
}
const apiKey = process.env.TYPESAFE_API_KEY?.trim();
if (!dryRun && !apiKey) {
  console.error(
    "MEGÁLLOK: a TYPESAFE_API_KEY környezeti változó nincs beállítva.",
  );
  process.exit(1);
}

try {
  /* A VALASZTHATO OPCIOK: minden AKTIV kategoria. A cimke-feloldas az osszesen megy,
     hogy egy archivalt kategoriara mutato cimke megnevezett hiba legyen. */
  const osszes = await prisma.assetCategory.findMany({
    select: { id: true, name: true, code: true, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const aktiv = osszes.filter((k) => k.isActive);

  const golden = parseGoldenCsv(readFileSync(goldenPath, "utf8"), osszes);
  console.log(
    `arany keszlet: ${golden.items.length} cimkezett, ${golden.unlabeled} meg cimkezetlen, ${golden.errors.length} hibas sor`,
  );
  if (golden.errors.length) {
    for (const hiba of golden.errors) console.error(`  ${hiba}`);
    process.exit(1);
  }
  const aktivIds = new Set(aktiv.map((k) => k.id));
  const inaktivCimke = golden.items.filter(
    (i) =>
      i.accepted.size > 0 && ![...i.accepted].some((id) => aktivIds.has(id)),
  );
  if (inaktivCimke.length)
    console.warn(
      `FIGYELEM: ${inaktivCimke.length} elem helyes kategoriaja nem aktiv, a modell nem valaszthatja.`,
    );

  /* A RESZLEG-UTVONAL: a gyokertol a sajat reszlegig, kodokkal. Korvedelemmel. */
  const reszlegek = new Map(
    (
      await prisma.worksheetDepartment.findMany({
        select: { id: true, parentId: true, code: true },
      })
    ).map((d) => [d.id, d]),
  );
  const utvonal = (id) => {
    const kodok = [];
    const latott = new Set();
    for (
      let d = reszlegek.get(id);
      d && !latott.has(d.id);
      d = d.parentId ? reszlegek.get(d.parentId) : undefined
    ) {
      latott.add(d.id);
      kodok.unshift(d.code);
    }
    return kodok;
  };

  const loadAsset = async (id) => {
    const a = await prisma.asset.findUnique({
      where: { id },
      select: {
        name: true,
        manufacturer: true,
        model: true,
        kind: true,
        performance: true,
        powerConsumption: true,
        departmentId: true,
        performanceUnit: { select: { name: true } },
        parentAsset: { select: { categoryRef: { select: { name: true } } } },
      },
    });
    if (!a) return null;
    return {
      name: a.name,
      manufacturer: a.manufacturer,
      model: a.model,
      kind: a.kind,
      performance: a.performance?.toFixed() ?? null,
      performanceUnit: a.performanceUnit?.name ?? null,
      powerConsumption: a.powerConsumption?.toFixed() ?? null,
      parentCategory: a.parentAsset?.categoryRef?.name ?? null,
      departmentPath: utvonal(a.departmentId),
    };
  };

  if (dryRun) {
    const szabalyok = { department: 0, pattern: 0, none: 0, missing: 0 };
    let kiirt = 0;
    for (const item of golden.items) {
      const bemenet = await loadAsset(item.assetId);
      if (!bemenet) {
        szabalyok.missing++;
        continue;
      }
      const { projection, prefixRule } = projectAssetCategory(bemenet);
      szabalyok[prefixRule]++;
      if (kiirt++ < 20)
        console.log(`${cph1(projection)}  ${cph1Canonical(projection)}`);
    }
    console.log(
      `elotag: reszleg-utvonal ${szabalyok.department}, minta ${szabalyok.pattern}, nem volt ${szabalyok.none}; nem talalt eszkoz ${szabalyok.missing}`,
    );
    process.exit(0);
  }

  const report = await runAssetCategoryEvaluation({
    golden: golden.items,
    categories: aktiv.map(({ id, name, code }) => ({ id, name, code })),
    loadAsset,
    apiKey,
    client: { fetch: (url, init) => fetch(url, init) },
    concurrency: 4,
  });

  mkdirSync(outDir, { recursive: true });
  const nev = (id) => osszes.find((k) => k.id === id)?.name ?? id;
  writeFileSync(
    join(outDir, "jev-asset-category-v0.json"),
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    join(outDir, "jev-asset-category-v0.md"),
    reportMarkdown(report, nev),
  );
  console.log(`riport: ${join(outDir, "jev-asset-category-v0.md")}`);
  if (report.stoppedReason) {
    console.error(`MEGÁLLT: ${report.stoppedReason}`);
    process.exit(2);
  }
} finally {
  await prisma.$disconnect();
}
