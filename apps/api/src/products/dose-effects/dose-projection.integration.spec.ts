import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { DoseEffectsService } from "./dose-effects.service.js";
import {
  DOSE_PROJECTION_LOCK_KEY,
  DoseProjectionService,
} from "./dose-projection.service.js";

/**
 * THE PROJECTION OF THE PRODUCT DOSE LIST FOR THE REEFCLUB (plan v6.1, 6.2;
 * slice 8; path B), with the conditions barracuda set on 2026-10-20:
 *
 *   - the whole set is REPLACED on every build: a source row that is gone
 *     leaves the projection, an archived one stays with its refusal;
 *   - the row version is the SOURCE's;
 *   - the age comes from the run record of the last SUCCESSFUL build;
 *   - a failed build changes nothing in the projection and is a FAILED record
 *     with the text; a later success closes it.
 *
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "VETITES-PROBA ";

describe(
  "termék-adag lista vetítése (ReefClub 8. szelet, (B) út)",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const suiteStartedAt = new Date();
    const doseEffects = new DoseEffectsService();
    const projection = new DoseProjectionService(doseEffects);
    let product: string;
    let keptId: string;
    let goneId: string;
    let archivedId: string;

    const source = (productId: string, parameterCode: string, over = {}) => ({
      productId,
      parameterCode,
      direction: "EMEL" as const,
      effectPer100L: 0.5,
      doseUnit: "ML" as const,
      doseStep: 1,
      maxDailyDosePer100L: 10,
      effectHours: 24,
      source: "https://gyarto.example.invalid/termek",
      recordedAt: new Date(),
      ...over,
    });

    async function removeLeftovers(): Promise<void> {
      // only the runs this suite made (the integration-gate guard allows no unfiltered deleteMany)
      await prisma.reefClubDoseProjectionRun.deleteMany({
        where: { startedAt: { gte: suiteStartedAt } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      product = (
        await prisma.product.create({
          data: {
            name: `${PREFIX}${suffix}`,
            channelListings: {
              create: [{ channel: "UNAS", externalStatus: "1" }],
            },
          },
        })
      ).id;
      keptId = (
        await prisma.productDoseEffect.create({
          data: source(product, "KH", { version: 3 }),
        })
      ).id;
      goneId = (
        await prisma.productDoseEffect.create({
          data: source(product, "KALCIUM"),
        })
      ).id;
      archivedId = (
        await prisma.productDoseEffect.create({
          data: source(product, "MAGNEZIUM", { archivedAt: new Date() }),
        })
      ).id;
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "Product (a suite előtagja)",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "vetítési futás",
          darab: await prisma.reefClubDoseProjectionRun.count({
            where: { startedAt: { gte: suiteStartedAt } },
          }),
        },
      ]);
    });

    it("az építés a teljes listát vetíti, a FORRÁS verziójával, és egy SUCCEEDED rekordot ír", async () => {
      const outcome = await projection.rebuild("SCHEDULE");
      assert.equal(outcome.ok, true, outcome.errorMessage ?? "");

      const rows = await prisma.reefClubDoseRow.findMany();
      const all = await doseEffects.list({ includeArchived: true });
      assert.equal(rows.length, all.length);
      const kept = rows.find((row) => row.sourceId === keptId)!;
      assert.equal(kept.sourceVersion, 3, "a forrás verziója, nem a vetítésé");
      assert.ok(kept.refusals.includes("NOT_VERIFIED"));
      assert.equal(kept.inStock, null);
      assert.ok(
        rows
          .find((row) => row.sourceId === archivedId)!
          .refusals.includes("ARCHIVED"),
        "az archivált sor a visszautasításával benne van",
      );

      const run = await prisma.reefClubDoseProjectionRun.findFirstOrThrow({
        where: { status: "SUCCEEDED" },
        orderBy: { finishedAt: "desc" },
      });
      assert.equal(run.rowCount, rows.length);
      assert.ok(
        rows.every((row) => row.runId === run.id),
        "minden sor az utolsó futásé",
      );
    });

    it("ami a forrásból eltűnt, a következő építéssel a vetítésből is eltűnik (teljes csere)", async () => {
      await prisma.productDoseEffect.delete({ where: { id: goneId } });
      assert.equal(
        await prisma.reefClubDoseRow.count({ where: { sourceId: goneId } }),
        1,
        "építés előtt még ott van",
      );
      assert.equal((await projection.rebuild("EDIT")).ok, true);
      assert.equal(
        await prisma.reefClubDoseRow.count({ where: { sourceId: goneId } }),
        0,
      );
      const run = await prisma.reefClubDoseProjectionRun.findFirstOrThrow({
        where: { status: "SUCCEEDED" },
        orderBy: { finishedAt: "desc" },
      });
      assert.ok(
        (await prisma.reefClubDoseRow.findMany()).every(
          (row) => row.runId === run.id,
        ),
      );
    });

    it("a bukott építés semmit nem változtat a vetítésen, FAILED rekordot ír, és a következő siker lezárja", async () => {
      const before = (
        await prisma.reefClubDoseRow.findMany({ orderBy: { sourceId: "asc" } })
      ).map((row) => `${row.sourceId}:${row.runId}`);
      const lastSuccess =
        await prisma.reefClubDoseProjectionRun.findFirstOrThrow({
          where: { status: "SUCCEEDED" },
          orderBy: { finishedAt: "desc" },
        });

      const failing = new DoseProjectionService({
        list: async () => {
          throw new Error("a lista nem olvasható (próba)");
        },
      } as unknown as DoseEffectsService);
      const outcome = await failing.rebuild("SCHEDULE");
      assert.equal(outcome.ok, false);

      const after = (
        await prisma.reefClubDoseRow.findMany({ orderBy: { sourceId: "asc" } })
      ).map((row) => `${row.sourceId}:${row.runId}`);
      assert.deepEqual(
        after,
        before,
        "a sorok és a futásuk azonosítója változatlan",
      );
      const stillLast = await prisma.reefClubDoseProjectionRun.findFirstOrThrow(
        {
          where: { status: "SUCCEEDED" },
          orderBy: { finishedAt: "desc" },
        },
      );
      assert.equal(
        stillLast.id,
        lastSuccess.id,
        "a sikertelen futás nem lett a „legutóbbi siker”",
      );

      const status = await projection.status();
      assert.equal(status.failingSinceLastSuccess, true);
      assert.match(status.lastFailure?.errorMessage ?? "", /nem olvasható/);

      assert.equal((await projection.rebuild("EDIT")).ok, true);
      const closed = await projection.status();
      assert.equal(closed.failingSinceLastSuccess, false);
      assert.ok(closed.lastFailure, "a hiba utólag is látszik");
    });

    it("az állapot kora az utolsó SIKERES futásból jön: egy 27 órás siker elavult, a friss nem", async () => {
      assert.equal((await projection.status()).stale, false);
      await prisma.reefClubDoseProjectionRun.updateMany({
        where: { status: "SUCCEEDED" },
        data: { finishedAt: new Date(Date.now() - 27 * 3_600_000) },
      });
      const old = await projection.status();
      assert.equal(old.stale, true);
      assert.ok((old.ageHours ?? 0) >= 27);
      // the rows' own content did not age: only the run record says it
      assert.ok(old.rowCount > 0);
    });

    it("a forrást a zár UTÁN olvassa (barracuda, #1754): amíg másik példány tartja a zárat, a lista olvasása nem indul el", async () => {
      let listCalls = 0;
      const counting = new DoseProjectionService({
        list: (query: Parameters<DoseEffectsService["list"]>[0]) => {
          listCalls += 1;
          return doseEffects.list(query);
        },
      } as unknown as DoseEffectsService);

      let running: Promise<{ ok: boolean }> | null = null;
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DOSE_PROJECTION_LOCK_KEY})`;
          running = counting.rebuild("EDIT");
          await new Promise((resolve) => setTimeout(resolve, 600));
          assert.equal(
            listCalls,
            0,
            "a másik példány tartja a zárat: a forrás olvasása nem kezdődhetett el",
          );
        },
        { timeout: 20_000 },
      );
      const outcome = await running!;
      assert.equal(outcome.ok, true);
      assert.equal(listCalls, 1, "a zár elengedése után olvasott");
    });

    it("párhuzamos kérések egy várakozó építésbe olvadnak, és az építések sorban futnak", async () => {
      const [a, b, c] = await Promise.all([
        projection.rebuild("EDIT"),
        projection.rebuild("EDIT"),
        projection.rebuild("EDIT"),
      ]);
      assert.equal(a.ok && b.ok && c.ok, true);
      const runs = await prisma.reefClubDoseProjectionRun.count({
        where: { status: "SUCCEEDED", trigger: "EDIT" },
      });
      assert.ok(runs >= 1);
      const rows = await prisma.reefClubDoseRow.findMany({
        select: { runId: true },
      });
      assert.equal(
        new Set(rows.map((row) => row.runId)).size,
        1,
        "egyetlen futás sorai",
      );
    });
  },
);
