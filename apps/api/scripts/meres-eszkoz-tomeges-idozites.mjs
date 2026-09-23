/**
 * MERI, MENNYI IDEIG TART N ESZKÖZ LÉTREHOZÁSA A VALÓDI ÍRÓ ÚTON.
 *
 * Ezt a szkriptet acrobot kérte (5b83142e / 42bb920f kártya, 2026-09-23): a
 * FANK-import kb. 2663 eszközt hozna létre, egyenként, a meglévő
 * `POST /service/assets` végponton keresztül (nincs tömeges végpont, és ez a
 * szkript sem ír ilyet). A kérdés az volt, hogy ez időben belefér-e, és van-e
 * olyan darabszám, ahol a görbe megváltozik (időtúllépés, kapcsolat-korlát,
 * sorszám-generátor újrapróbálkozás).
 *
 * ALAPÉRTELMEZÉSBEN A VALÓDI CÉLSZÁMOT FUTTATJA (2663), NEM EGY KISEBB MINTÁT.
 * Egy extrapolált szám nem mérés -- lásd a ház saját tanulságát erről
 * (nautilus CLAUDE.md, "EGY ELŐREJELZÉS, AMI KIVONÁSBÓL KELETKEZIK, NEM
 * MÉRÉS"). A régebbi, N=300-as futás extrapolációja is ELLENŐRIZHETŐ marad:
 * ha valaki kisebb MERES_DARABSZAM-ot ad meg, a szkript kimondja, hogy az
 * eredmény extrapoláció, nem valódi teljes futás.
 *
 * A KAPCSOLAT-KORLÁT RÉSZE A JELENTÉSNEK, NEM CSAK A KÖRNYEZETNEK. Acrobot
 * kérése (2026-09-23 15:07): a szám csak akkor vihető át egy másik
 * környezetbe, ha tudjuk, MILYEN connection_limit/pool_timeout mellett
 * született. A szkript ezt a DATABASE_URL query-részéből olvassa ki és
 * kiírja -- hitelesítő adat nélkül.
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
 *   MERES_DARABSZAM       hány eszközt hozzon létre (alapértelmezés 2663, min. 100)
 *   MERES_CEL_DARABSZAM   mire extrapoláljon, ha a darabszám ennél kisebb (alapért. 2663)
 *   MERES_KORNYEZET       szabad szöveg, MELYIK környezetben fut ez a mérés
 *                         (pl. "CI efemer Postgres, nem staging") -- a
 *                         szkript kiírja, hogy ne kelljen kitalálni utólag
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

/** Csak a connection_limit/pool_timeout query-paramétereket olvassa ki -- hitelesítő adat nem kerül a kimenetbe. */
function poolParamsOf(url) {
  try {
    const parsed = new URL(url);
    return {
      connectionLimit: parsed.searchParams.get("connection_limit"),
      poolTimeout: parsed.searchParams.get("pool_timeout"),
    };
  } catch {
    return { connectionLimit: null, poolTimeout: null };
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
const target = Number(process.env.MERES_CEL_DARABSZAM ?? "2663");
const count = Number(process.env.MERES_DARABSZAM ?? String(target));
if (!Number.isInteger(count) || count < 100) {
  console.error(
    "MEGÁLLOK: a MERES_DARABSZAM legalább 100 legyen, hogy a szám ne egy " +
      "kiugrásból jöjjön.",
  );
  process.exit(2);
}
const environmentLabel =
  process.env.MERES_KORNYEZET ?? "(nincs megadva -- MERES_KORNYEZET hiányzik)";
const pool = poolParamsOf(databaseUrl);

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
  console.log("=== KÖRNYEZET ===");
  console.log(`Címke:                  ${environmentLabel}`);
  console.log(`Adatbázis neve:         ${dbName}`);
  console.log(
    `connection_limit:       ${pool.connectionLimit ?? "(nincs megadva a DATABASE_URL-ben -- Prisma alapérték érvényes)"}`,
  );
  console.log(
    `pool_timeout:           ${pool.poolTimeout ?? "(nincs megadva a DATABASE_URL-ben -- Prisma alapérték érvényes)"}`,
  );
  console.log("");

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
  const failureSamples = [];
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
      if (failureSamples.length < 10) {
        failureSamples.push(
          `  #${i + 1}: HTTP ${response.status} -- ${body.slice(0, 200)}`,
        );
      }
    }
    // Előrehaladás, hogy egy hosszú futás naplója ne legyen néma percekig.
    if ((i + 1) % 500 === 0 || i + 1 === count) {
      console.log(`  ... ${i + 1}/${count} kész`);
    }
  }

  const overallMs = Number(process.hrtime.bigint() - overallStart) / 1e6;

  const sorted = [...durations].sort((a, b) => a - b);
  const mean = meanOf(durations);
  const isRealRun = count >= target;

  // TÍZ SZELET A TELJES FUTÁSON, NEM CSAK KÉT DECILIS -- ez adja meg, HOL
  // TÖRIK MEG a görbe, ha megtörik, nem csak azt, hogy az eleje és a vége
  // különbözik-e.
  const bucketCount = Math.min(10, durations.length);
  const bucketSize = Math.ceil(durations.length / bucketCount);
  const buckets = [];
  for (let start = 0; start < durations.length; start += bucketSize) {
    buckets.push(durations.slice(start, start + bucketSize));
  }
  const bucketMeans = buckets.map(meanOf);
  const firstMean = bucketMeans[0];
  const worstMean = Math.max(...bucketMeans);
  const worstBucketIndex = bucketMeans.indexOf(worstMean);
  const trendRatio = worstMean / firstMean;

  console.log("");
  console.log("=== MÉRÉS EREDMÉNYE ===");
  console.log(
    `Típus:                  ${isRealRun ? "VALÓDI FUTÁS (nem extrapoláció)" : `MINTA (${count} db, a ${target}-re extrapolálva lent)`}`,
  );
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
    `p99:                    ${percentileOf(sorted, 99).toFixed(1)} ms`,
  );
  console.log(
    `Min / Max:              ${sorted[0].toFixed(1)} / ${sorted[sorted.length - 1].toFixed(1)} ms`,
  );
  console.log("");
  console.log(
    `Szeletenkénti átlag (${bucketCount} egyenlő szelet, sorrendben):`,
  );
  bucketMeans.forEach((value, index) => {
    const marker = index === worstBucketIndex ? "  <- legnehezebb szelet" : "";
    console.log(`  ${index + 1}. szelet: ${value.toFixed(1)} ms${marker}`);
  });
  console.log(
    `Legrosszabb/legjobb szelet aránya: ${(worstMean / Math.min(...bucketMeans)).toFixed(2)}x`,
  );

  if (!isRealRun) {
    console.log("");
    console.log(`=== EXTRAPOLÁCIÓ ${target} DARABRA (BECSLÉS, NEM MÉRÉS) ===`);
    console.log(
      `Átlagból:               ${((mean * target) / 1000 / 60).toFixed(1)} perc`,
    );
    console.log(
      `Teljes-idő rátájából:   ${(((overallMs / durations.length) * target) / 1000 / 60).toFixed(1)} perc`,
    );
  }

  console.log("");
  if (trendRatio > 1.3) {
    console.log(
      `FIGYELEM: a legnehezebb szelet (${worstBucketIndex + 1}.) ${trendRatio.toFixed(2)}x lassabb, mint a leggyorsabb -- ` +
        "NEM LINEÁRIS. Nézd meg, a legnehezebb szelet a futás melyik szakaszába esik (eleje = bemelegedés, vége = valódi romlás).",
    );
  } else {
    console.log(
      "A sebesség a mérés során stabil maradt, nincs erőteljes lassulás vagy törés.",
    );
  }
  if (failures > 0) {
    console.log(
      `FIGYELEM: ${failures} hívás nem sikerült -- ez önmagában olyan lelet, ` +
        "ami a betöltés előtt tisztázandó. Minta a hibákból:",
    );
    for (const line of failureSamples) console.log(line);
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
