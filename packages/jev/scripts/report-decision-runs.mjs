#!/usr/bin/env node
/**
 * JEV V1 PILOT RIPORT: a `DecisionRun` tabla, service-assets.asset-category.
 *
 * Szerzodes: KratoBal/acropora-os #1199 ACD-009 (komment 5870009352). CSAK
 * OLVAS: a lekerdezesek egy `READ ONLY` tranzakcioban futnak, tehat az
 * adatbazis maga tagadna meg barmilyen irast. Nincs eles hivasi ut -- az API
 * nem importalja ezt a szkriptet. Eles es stage adatbazison egyarant futhat.
 *
 * Hasznalat (a repo gyokerebol, elotte `pnpm --filter @acropora/jev build`):
 *
 *   DATABASE_URL=... node packages/jev/scripts/report-decision-runs.mjs \
 *     --out <mappa> [--label eles|stage] [--policy-version 2] \
 *     [--examples 3] [--now 2026-10-20T12:00:00Z]
 *
 * --policy-version  a mert verzio (alap: a csomag rogzitett policyje); a
 *                   drift-szakasz ettol fuggetlenul a kulcs MINDEN futasat
 *                   latja
 * --examples        peldak szama tipusonkent (alap 3, legfeljebb 10). Csak
 *                   ezeknek a vetitett neve kerul a riportba (PD-001): a
 *                   `projectionPayload` tomegesen nem olvasodik ki.
 * --now             az EXPIRED szamitas viszonyitasi pontja (alap: most)
 * --label           a riport fajlneveben es cimeben all; a DATABASE_URL soha
 *
 * Kilepesi kod: 0 kesz; 1 bemeneti hiba; 2 adatbazis-hiba (nem keszult riport).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@acropora/database";

import {
  ASSET_CATEGORY_POLICY,
  decisionReport,
  decisionReportMarkdown,
} from "../dist/index.js";

function argumentum(nev) {
  const i = process.argv.indexOf(nev);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const outDir = argumentum("--out");
const label = argumentum("--label");
const verzioSzoveg = argumentum("--policy-version");
const peldaSzoveg = argumentum("--examples");
const mostSzoveg = argumentum("--now");

const policyVersion =
  verzioSzoveg === undefined
    ? ASSET_CATEGORY_POLICY.version
    : Number(verzioSzoveg);
const examplesPerKind = peldaSzoveg === undefined ? 3 : Number(peldaSzoveg);
const now = mostSzoveg === undefined ? new Date() : new Date(mostSzoveg);

const hibak = [];
if (!outDir) hibak.push("hiányzik: --out <mappa>");
if (!Number.isInteger(policyVersion) || policyVersion < 1)
  hibak.push(`érvénytelen --policy-version: ${verzioSzoveg}`);
if (!Number.isInteger(examplesPerKind) || examplesPerKind < 0)
  hibak.push(`érvénytelen --examples: ${peldaSzoveg}`);
if (Number.isNaN(now.getTime())) hibak.push(`érvénytelen --now: ${mostSzoveg}`);
if (label !== undefined && !/^[a-z0-9-]+$/.test(label))
  hibak.push(`érvénytelen --label (kisbetű, szám, kötőjel): ${label}`);
if (hibak.length) {
  for (const h of hibak) console.error(h);
  console.error(
    "Használat: --out <mappa> [--label eles|stage] [--policy-version N] [--examples N] [--now ISO]",
  );
  process.exit(1);
}

/* A VETITETT NEV: a vetulet adatreszenek `name` mezoje, masra nem nezunk. */
function vetitettNev(payload) {
  const nev = payload?.data?.name;
  return typeof nev === "string" ? nev : null;
}

try {
  const { report, nevek } = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const runs = await tx.decisionRun.findMany({
        where: { policyKey: ASSET_CATEGORY_POLICY.key },
        select: {
          id: true,
          policyKey: true,
          policyVersion: true,
          optionsHash: true,
          requestedModel: true,
          respondedModel: true,
          selectedValue: true,
          confidence: true,
          exposure: true,
          resolution: true,
          resolvedValue: true,
          status: true,
          latencyMs: true,
          errorCode: true,
          entityId: true,
          clientOperationId: true,
          createdAt: true,
        },
      });
      const categories = await tx.assetCategory.findMany({
        select: { id: true, name: true, code: true },
      });
      const report = decisionReport({
        runs,
        categories,
        policyKey: ASSET_CATEGORY_POLICY.key,
        policyVersion,
        now,
        examplesPerKind,
      });
      const peldak = await tx.decisionRun.findMany({
        where: { id: { in: report.examples.map((p) => p.runId) } },
        select: { id: true, projectionPayload: true },
      });
      return {
        report,
        nevek: new Map(
          peldak.map((p) => [p.id, vetitettNev(p.projectionPayload)]),
        ),
      };
    },
    { timeout: 60_000 },
  );
  for (const p of report.examples) p.name = nevek.get(p.runId) ?? null;

  const alap = `jev-decision-runs-${label ? `${label}-` : ""}v${policyVersion}`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, `${alap}.json`),
    JSON.stringify({ label: label ?? null, ...report }, null, 2),
  );
  const md = decisionReportMarkdown(report);
  writeFileSync(
    join(outDir, `${alap}.md`),
    label ? md.replace(/^# (.*)$/m, `# $1 (${label})`) : md,
  );
  const t = report.trigger;
  console.log(
    `futás ${report.runs.total}; SHOWN döntés ${t.shownDecisions}/${t.shownRequired}, HIDDEN-kontroll ${t.controlDecisions}/${t.controlRequired}, trigger ${t.met ? "TELJESÜLT" : "még nem"}`,
  );
  console.log(`riport: ${join(outDir, `${alap}.md`)}`);
} catch (hiba) {
  /* CSAK AZ UZENET: a Prisma hibaja a gepet es a portot nevezi meg, a
     jelszot nem; a teljes objektum a minifikalt futtatokornyezetet onti ki. */
  console.error(
    `MEGÁLLOK: ${hiba instanceof Error ? hiba.message.trim() : String(hiba)}`,
  );
  process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
