/**
 * BIZONYÍTJA, HOGY UGYANAZ A clientOperationId NEM HOZ LÉTRE MÁSODIK SORT.
 *
 * Acrobot kérése (5b83142e kártya, 2026-09-23): nem elég azt állítani, hogy a
 * `clientOperationId` ALKALMAS idempotencia-kulcsnak (a séma egyedi megkötést
 * visel rajta) -- meg is kell mutatni, hogy a MÁSODIK, azonos kulcsú hívás
 * ténylegesen a meglévő sort adja vissza, nem hoz létre újat. Éles adaton a
 * mező addig még soha nem volt kitöltve (acrobot mérése), tehát ez a szkript
 * az első valódi próba rajta.
 *
 * HOL FUTHAT: KIZÁRÓLAG teszt-adatbázison, ugyanaz a védelem, mint a
 * `meres-eszkoz-tomeges-idozites.mjs`-ben.
 *
 * FUTTATÁS (apps/api könyvtárból, egy már FUTÓ API-val szemben):
 *   DATABASE_URL=postgresql://.../acropora_ci API_URL=http://127.0.0.1:3001 \
 *     node scripts/meres-eszkoz-idempotencia-proba.mjs
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
const operationId = `proba-idempotencia:${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(`ÁLLÍTÁS ELBUKOTT: ${message}`);
}

async function main() {
  const customer = await prisma.customer.create({
    data: {
      customerNumber: `IDEMP-${Date.now()}`,
      type: "COMPANY",
      displayName: "Idempotencia-próba vevő (törölhető)",
    },
  });
  console.log(`Fixtúra vevő létrehozva: ${customer.id}`);

  const loginResponse = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "service@acropora.local" }),
  });
  assert(loginResponse.ok, `a bejelentkezés ${loginResponse.status}-at adott`);
  const { token } = await loginResponse.json();
  assert(Boolean(token), "a bejelentkezés válasza nem hordoz tokent");

  const payload = {
    clientOperationId: operationId,
    ownerType: "CUSTOMER",
    ownerId: customer.id,
    kind: "EQUIPMENT",
    name: "Idempotencia-próba eszköz",
  };

  async function post() {
    const response = await fetch(`${apiUrl}/service/assets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    return { status: response.status, body };
  }

  console.log(`Első hívás, clientOperationId=${operationId} ...`);
  const first = await post();
  console.log(`  HTTP ${first.status}, id=${first.body.id}`);
  assert(
    first.status >= 200 && first.status < 300,
    `az első hívás ${first.status}-at adott: ${JSON.stringify(first.body)}`,
  );

  console.log("Második hívás, UGYANAZZAL a clientOperationId-vel ...");
  const second = await post();
  console.log(`  HTTP ${second.status}, id=${second.body.id}`);
  assert(
    second.status >= 200 && second.status < 300,
    `a második hívás ${second.status}-at adott: ${JSON.stringify(second.body)}`,
  );

  assert(
    first.body.id === second.body.id,
    `a két hívás KÜLÖNBÖZŐ id-t adott (${first.body.id} vs ${second.body.id}) -- ` +
      "ez azt jelentené, hogy a dedup-logika NEM sült el.",
  );

  const count = await prisma.asset.count({
    where: { clientOperationId: operationId },
  });
  assert(
    count === 1,
    `az adatbázisban ${count} sor áll ezzel a clientOperationId-vel, 1 helyett`,
  );

  console.log("");
  console.log("=== EREDMÉNY ===");
  console.log(
    "SIKERES: a második, azonos clientOperationId-jű hívás NEM hozott létre " +
      `második sort -- mindkét válasz ugyanazt az id-t adta (${first.body.id}), ` +
      "és az adatbázisban pontosan egy sor áll ezzel a kulccsal.",
  );

  await prisma.asset.deleteMany({ where: { customerId: customer.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  console.log("Fixtúra takarítva.");
}

main()
  .catch((error) => {
    console.error("HIBA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
