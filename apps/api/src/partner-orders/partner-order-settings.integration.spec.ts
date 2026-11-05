import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  PARTNER_ORDER_SETTING_ID,
  PartnerOrdersRepository,
} from "./partner-orders.repository.js";

/**
 * A MEGRENDELESEK BEALLITASA ADATBAZISON (S4b, 38caeac2). MI PIROSIT: ha sor nelkul nem null jon vissza (az alapertek a
 * service dolga, a sor hianyat a repository mondja ki); ha a 0 napos kuszob elveszik (`0 ?? 14` helyes, `0 || 14`
 * nem: a sor a 0-t eltarolja es visszaadja); ha a masodik mentes MASODIK sort hoz letre a beallitas helyett; ha a
 * mento felhasznalo azonositoja nem tarolodik.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "the orders' settings, on a real database",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new PartnerOrdersRepository();
    const remove = () =>
      prisma.partnerOrderSetting.deleteMany({
        where: { id: PARTNER_ORDER_SETTING_ID },
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await remove();
    });
    after(async () => {
      if (gate.mode === "run") await remove();
    });

    it("has no row before anybody saved one", async () => {
      assert.equal(await repository.settings(), null);
    });

    it("keeps a zero, and a second save updates the one row instead of adding another", async () => {
      await repository.saveSettings(0, null);
      assert.equal((await repository.settings())?.backlogDays, 0);
      await repository.saveSettings(30, "user-1");
      const row = await repository.settings();
      assert.equal(row?.backlogDays, 30);
      assert.equal(row?.updatedById, "user-1");
      assert.equal(await prisma.partnerOrderSetting.count(), 1);
    });
  },
);
