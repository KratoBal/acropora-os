/**
 * MERI, MENNYI IDEIG TART N ESZKÖZ LÉTREHOZÁSA A VALÓDI ÍRÓ ÚTON.
 *
 * Ezt a szkriptet acrobot kérte (5b83142e kártya, 2026-09-23): a FANK-import
 * kb. 2663 eszközt hozna létre, egyenként, a meglévő `POST /service/assets`
 * végponton keresztül (nincs tömeges végpont, és ez a szkript sem ír ilyet).
 * A kérdés az volt, hogy ez időben belefér-e, és van-e olyan határ (időtúllépés,
 * kapcsolat-korlát, sorszám-generátor újrapróbálkozás), ami N növelésével
 * ROMLIK, nem lineáris.
 *
 * HOL FUTHAT: KIZÁRÓLAG teszt-adatbázison, a `TEST_DATABASE_SUFFIXES` ellenőrzi
 * (ugyanaz a szabály, mint az `apps/api/src/common/integration-database.ts`
 * kapuja). Ez a szkript sorokat hoz létre és töröl -- élesen ez a fajta
 * művelet visszafordíthatatlan kárt okozna.
 *
 * FUTTATÁS (apps/api könyvtárból, egy már FUTÓ API-val szemben):
 *   DATABASE_URL=postgresql://.../acropora_ci API_URL=http://127.0.0.1:3001 \
 *     node scripts/meres-eszkoz-tomeges-idozites.mjs
 *
 * Környezeti változók:
 *   MERES_DARABSZAM       hány eszközt hozzon létre (alapértelmezés 300, min. 100)
 *   MERES_CEL_DARABSZAM   mire extrapoláljon (alapértelmezés 2663, a FANK-szám)
 */

import { prisma } from "@acropora/database";

const TEST_DATABASE_SUFFIXES = ["_test", "_ci"];

function databaseNameOf(url) {
  try {
    return new URL(url).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const dbName = databaseUrl ? databaseNameOf(databaseUrl) : null;
if (
  !dbName ||
  !TEST_DATABASE_SUFFIXES.some((suffix) => dbName.endsWith(suffix))
) {
  console.error(
    `MEGÁLLOK: a DATABASE_URL ("${dbName ?? "ismeretlen"}") neve nem _test vagy ` +
      "_ci végű. Ez a szkript sorokat hoz létre és töröl, ezért kizárólag erre " +
      "a célra dedikált adatbázison futhat.",
  );
  process.exit(2);
}

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
const count = Number(process.env.MERES_DARABSZAM ?? "300");
if (!Number.isInteger(count) || count < 100) {
  console.error(
    "MEGÁLLOK: a MERES_DARABSZAM legalább 100 legyen, hogy a szám ne egy " +
      "kiugrásból jöjjön.",
  );
  process.exit(2);
}
const target = Number(process.env.MERES_CEL_DARABSZAM ?? "2663");

function percentileOf(sorted, p) {
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index];
}

function meanOf(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const customer = await prisma.customer.create({
    data: {
      customerNumber: `MERES-${Date.now()}`,
      type: "COMPANY",
      displayName: "Mérés tesztvevő (törölhető)",
    },
  });
  console.log(
    `Fixtúra vevő létrehozva: ${customer.id} (${customer.customerNumber})`,
  );

  const loginResponse = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "service@acropora.local" }),
  });
  if (!loginResponse.ok) {
    throw new Error(
      `A fejlesztői bejelentkezés ${loginResponse.status}-at adott: ` +
        (await loginResponse.text()),
    );
  }
  const session = await loginResponse.json();
  const token = session.token;
  if (!token) throw new Error("A bejelentkezés válasza nem hordoz tokent.");

  const durations = [];
  let failures = 0;
  const overallStart = process.hrtime.bigint();

  for (let i = 0; i < count; i += 1) {
    const started = process.hrtime.bigint();
    const response = await fetch(`${apiUrl}/service/assets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ownerType: "CUSTOMER",
        ownerId: customer.id,
        kind: "EQUIPMENT",
        name: `Mérés eszköz ${i + 1}`,
      }),
    });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    durations.push(elapsedMs);
    if (!response.ok) {
      failures += 1;
      const body = await response.text();
      console.error(
        `  #${i + 1}: HTTP ${response.status} -- ${body.slice(0, 200)}`,
      );
    }
  }

  const overallMs = Number(process.hrtime.bigint() - overallStart) / 1e6;

  const sorted = [...durations].sort((a, b) => a - b);
  const mean = meanOf(durations);

  const decileSize = Math.max(1, Math.floor(durations.length / 10));
  const firstMean = meanOf(durations.slice(0, decileSize));
  const lastMean = meanOf(durations.slice(-decileSize));
  const trendRatio = lastMean / firstMean;

  console.log("");
  console.log("=== MÉRÉS EREDMÉNYE ===");
  console.log(`Darabszám:              ${durations.length}`);
  console.log(`Sikertelen:             ${failures}`);
  console.log(`Teljes idő:             ${(overallMs / 1000).toFixed(2)} s`);
  console.log(`Átlag / hívás:          ${mean.toFixed(1)} ms`);
  console.log(
    `Medián:                 ${percentileOf(sorted, 50).toFixed(1)} ms`,
  );
  console.log(
    `p95:                    ${percentileOf(sorted, 95).toFixed(1)} ms`,
  );
  console.log(
    `Min / Max:              ${sorted[0].toFixed(1)} / ${sorted[sorted.length - 1].toFixed(1)} ms`,
  );
  console.log(`Első decilis átlaga:    ${firstMean.toFixed(1)} ms`);
  console.log(`Utolsó decilis átlaga:  ${lastMean.toFixed(1)} ms`);
  console.log(`Trend arány (utolsó/első): ${trendRatio.toFixed(2)}x`);
  console.log("");
  console.log(`=== EXTRAPOLÁCIÓ ${target} DARABRA ===`);
  console.log(
    `Átlagból:               ${((mean * target) / 1000 / 60).toFixed(1)} perc`,
  );
  console.log(
    `Teljes-idő rátájából:   ${(((overallMs / durations.length) * target) / 1000 / 60).toFixed(1)} perc`,
  );
  if (trendRatio > 1.3) {
    console.log(
      `FIGYELEM: az utolsó decilis ${trendRatio.toFixed(2)}x lassabb, mint az első -- ` +
        "NEM LINEÁRIS, a fenti extrapoláció ALÁBECSÜLHET.",
    );
  } else {
    console.log(
      "A sebesség a mérés során stabil maradt, nincs erőteljes lassulás.",
    );
  }
  if (failures > 0) {
    console.log(
      `FIGYELEM: ${failures} hívás nem sikerült -- ez önmagában olyan lelet, ` +
        "ami a betöltés előtt tisztázandó (lásd a fenti hibaüzeneteket).",
    );
  }

  await prisma.asset.deleteMany({ where: { customerId: customer.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  console.log("");
  console.log("Fixtúra takarítva (a létrehozott eszközök és a vevő törölve).");
}

main()
  .catch((error) => {
    console.error("HIBA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
