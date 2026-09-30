import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { CustomersRepository } from "./customers.repository.js";

/**
 * A VEVŐ-KERESÉS ÉKEZET NÉLKÜL IS TALÁL, ADATBÁZISON.
 *
 * Balázs a stage-en (2026-09-30): "a partnerekbol nem talal senkit". Mérve
 * ott: a "Főv" megtalálta a partnert, a "Fov" nem; az "Állat" hármat, az
 * "allat" egyet sem. A javítás az `unaccent` kiterjesztésre épül, és azt
 * mock nem méri: a kérdés az, hogy a PostgreSQL mit ad vissza.
 *
 * MI PIROSÍT: ha az ékezet nélkül beírt szó nem találja az ékezeteset (és
 * fordítva); ha a kis-nagybetű újra számítana; ha a `%` vagy a `_` joker
 * lenne; ha a keresés a forrás-szűrőt felülírná ahelyett, hogy szűkítene.
 */
const gate = integrationDatabaseGate(process.env);
const CUSTOMER_PREFIX = "CUST-SEARCH-INT-";

describe(
  "CustomersRepository accent-insensitive search integration",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = String(Date.now() % 1_000_000);
    const repository = new CustomersRepository();
    const ids: Record<"zoo" | "percent" | "plain", string> = {
      zoo: "",
      percent: "",
      plain: "",
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const create = async (key: keyof typeof ids, displayName: string) => {
        const row = await prisma.customer.create({
          data: {
            customerNumber: `${CUSTOMER_PREFIX}${key}-${suffix}`,
            type: "COMPANY",
            displayName,
          },
        });
        ids[key] = row.id;
      };
      await create("zoo", `Fővárosi Állat- és Növénykert ${suffix}`);
      await create("percent", `Árvíztűrő 100% Kft ${suffix}`);
      await create("plain", `Arvizturo 1000 Kft ${suffix}`);
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: CUSTOMER_PREFIX } },
      });
      nincsMaradek([
        {
          nev: "Customer (customerNumber prefix)",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: CUSTOMER_PREFIX } },
          }),
        },
      ]);
    }

    const found = async (
      search: string,
      source?: "UNAS" | "MANUAL",
    ): Promise<string[]> => {
      const result = await repository.list({
        page: 1,
        pageSize: 100,
        search,
        status: "ALL",
        ...(source ? { source } : {}),
      });
      const ours = new Set(Object.values(ids));
      return result.items.map((item) => item.id).filter((id) => ours.has(id));
    };

    // A KONTROLL: a pontos, ékezetes alak a régi úton is talált. Ha ez piros,
    // a többi állítás nem a kereséstől bukik.
    it("the exact accented text finds the row", async () => {
      assert.deepEqual(await found(`Fővárosi Állat- és Növénykert ${suffix}`), [
        ids.zoo,
      ]);
    });

    it("text typed without accents finds the accented row, in any case", async () => {
      assert.deepEqual(await found(`fovarosi allat- es novenykert ${suffix}`), [
        ids.zoo,
      ]);
      assert.deepEqual(await found(`FOVAROSI ALLAT- ES NOVENYKERT ${suffix}`), [
        ids.zoo,
      ]);
    });

    it("accented text finds a row written without accents", async () => {
      assert.deepEqual(await found(`ÁRVÍZTŰRŐ 1000 KFT ${suffix}`), [
        ids.plain,
      ]);
    });

    it("% and _ are literal, not wildcards", async () => {
      assert.deepEqual(await found(`100% Kft ${suffix}`), [ids.percent]);
      assert.deepEqual(await found(`1_00 Kft ${suffix}`), []);
    });

    it("the search narrows the origin filter instead of replacing it", async () => {
      assert.deepEqual(
        await found(`allat- es novenykert ${suffix}`, "MANUAL"),
        [ids.zoo],
      );
      assert.deepEqual(
        await found(`allat- es novenykert ${suffix}`, "UNAS"),
        [],
      );
    });
  },
);
