import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { prismaFeedBackfillStore } from "./feed-backfill.service.js";

const gate = integrationDatabaseGate(process.env);

/*
  A "NEM A MI FIÓKUNK" ÍTÉLET TÖRLÉSE A TÁBLÁBÓL (acrobot 58207). MI PIROSÍT: ha a törlés a sorozat más válaszait is viszi (a "ismeri" és
  a "nem ismeri" számok elvesznek); ha másik sorozat ítéletét is törli; ha a sorozat ítéletét nem törli; ha a törölt sorok száma nem a
  tényleges. Saját, kitalált sorozat-nevekkel dolgozik (ZZTEST-2099, ZZOTHER-2099), és csak azokat takarítja.
*/
describe(
  "the foreign-series verdict in the backfill table",
  { skip: gate.mode === "skip" },
  () => {
    const mine = {
      in: ["ZZTEST-2099/00004", "ZZTEST-2099/00002", "ZZOTHER-2099/00004"],
    };
    before(() => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
    });
    after(async () => {
      if (gate.mode !== "run") return;
      await prisma.szamlazzFeedBackfillNumber.deleteMany({
        where: { number: mine },
      });
    });

    it("clears only the NOT_OUR_ACCOUNT rows of the named series, and counts them", async () => {
      const at = new Date();
      const row = (number: string, series: string, outcome: string) =>
        prismaFeedBackfillStore.record({
          number,
          series,
          line: { outcome, detail: "integration test" },
          userId: "integration-test",
          at,
        });
      await row("ZZTEST-2099/00004", "ZZTEST-2099", "NOT_OUR_ACCOUNT");
      await row("ZZTEST-2099/00002", "ZZTEST-2099", "WOULD_STORE");
      await row("ZZOTHER-2099/00004", "ZZOTHER-2099", "NOT_OUR_ACCOUNT");

      assert.equal(
        await prismaFeedBackfillStore.clearForeign("ZZTEST-2099"),
        1,
      );
      const left = await prisma.szamlazzFeedBackfillNumber.findMany({
        where: { number: mine },
        select: { number: true, outcome: true },
        orderBy: { number: "asc" },
      });
      assert.deepEqual(left, [
        { number: "ZZOTHER-2099/00004", outcome: "NOT_OUR_ACCOUNT" },
        { number: "ZZTEST-2099/00002", outcome: "WOULD_STORE" },
      ]);
      // a second call finds nothing to clear
      assert.equal(
        await prismaFeedBackfillStore.clearForeign("ZZTEST-2099"),
        0,
      );
    });
  },
);
