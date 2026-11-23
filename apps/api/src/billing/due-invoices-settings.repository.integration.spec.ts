import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  DUE_INVOICES_SETTING_ID,
  DueInvoicesSettingsRepository,
} from "./due-invoices-settings.repository.js";

const gate = integrationDatabaseGate(process.env);

/*
  A LEJÁRÓ SZÁMLÁK LEVELÉNEK BEÁLLÍTÁSA AZ ADATBÁZISBAN (acrobot 58274; barracuda 58276, 3. megjegyzés). MI PIROSÍT: ha a nap két hívásból is lefoglalható (a
  levél kétszer menne); ha a nap másnap nem foglalható le újra; ha a felszabadítás nem állítja vissza az előző napot; ha a mentés az utolsó küldés
  nyomát törli; ha a sor nélküli állapot nem az alapérték üres címzettel. A saját sorát (azonosító `due-invoices`) előtte és utána törli.
*/
describe(
  "the due-invoices mail setting row",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new DueInvoicesSettingsRepository();
    const wipe = () =>
      prisma.dueInvoicesMailSetting.deleteMany({
        where: { id: DUE_INVOICES_SETTING_ID },
      });
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await wipe();
    });
    after(async () => {
      if (gate.mode === "run") await wipe();
    });

    it("without a row it reads the defaults, with no recipients", async () => {
      const row = await repository.get();
      assert.deepEqual(row.recipients, []);
      assert.equal(row.weekday, 1);
      assert.equal(row.earliest, "07:00");
      assert.equal(row.lastSentDay, null);
    });

    it("a day is claimed once; a concurrent second claim of the same day loses; the next day can be claimed", async () => {
      const [first, second] = await Promise.all([
        repository.claimDay("2026-11-23"),
        repository.claimDay("2026-11-23"),
      ]);
      assert.deepEqual([first, second].sort(), [false, true]);
      assert.equal(await repository.claimDay("2026-11-23"), false);
      assert.equal(await repository.claimDay("2026-11-30"), true);
    });

    it("releasing puts the previous day back, and only if that day is still the claimed one", async () => {
      await repository.releaseDay("2026-11-30", "2026-11-23");
      assert.equal((await repository.get()).lastSentDay, "2026-11-23");
      // a release of a day that is not the current one changes nothing
      await repository.releaseDay("2026-12-07", null);
      assert.equal((await repository.get()).lastSentDay, "2026-11-23");
      assert.equal(await repository.claimDay("2026-11-30"), true);
    });

    it("saving keeps the trace of the last send, and the trace is written after a send", async () => {
      await repository.markSent(new Date("2026-11-30T07:15:00Z"), 2);
      await repository.save(
        {
          enabled: false,
          recipients: ["a@acropora.hu", "b@acropora.hu"],
          fromAddress: "info@acropora.hu",
          weekday: 2,
          earliest: "08:00",
          latest: "11:00",
        },
        null,
      );
      const row = await repository.get();
      assert.deepEqual(
        [
          row.enabled,
          row.recipients,
          row.fromAddress,
          row.weekday,
          row.earliest,
          row.latest,
        ],
        [
          false,
          ["a@acropora.hu", "b@acropora.hu"],
          "info@acropora.hu",
          2,
          "08:00",
          "11:00",
        ],
      );
      assert.equal(row.lastSentDay, "2026-11-30");
      assert.equal(row.lastSentRecipients, 2);
      assert.equal(row.lastSentAt?.toISOString(), "2026-11-30T07:15:00.000Z");
    });
  },
);
