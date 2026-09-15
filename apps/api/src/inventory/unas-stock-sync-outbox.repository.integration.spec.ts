import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, prisma } from "@acropora/database";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import { UnasStockSyncOutboxRepository } from "./unas-stock-sync-outbox.repository.js";
import { integrationDatabaseGate } from "../common/integration-database.js";

// This suite writes and deletes rows, so it runs only against a database named
// for testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);
const runIntegration = gate.mode !== "skip";

/**
 * A SUITE SAJAT SORAINAK ELOTAGJA -- raktar-kod, termeknev es cikkszam
 * egyarant. Nevet kap, mert a letrehozas ES a takaritas-allitas is olvassa.
 */
const PREFIX = "STOCK-OUTBOX-INT-";

/// These two guarantees are, by construction, not verifiable against an
/// in-memory fake - they depend on real Postgres row-locking semantics
/// (`FOR UPDATE SKIP LOCKED`) and real wall-clock comparisons
/// (`leaseExpiresAt < now()`). This suite is gated behind
/// RUN_DB_INTEGRATION=1 (see apps/api/package.json's test:integration
/// script) exactly like the repo's other *.integration.spec.ts files, and
/// needs a real local Postgres - it could not be executed in the sandbox
/// this change was written in (see project memory on sandbox limitations);
/// it must be run locally (`pnpm --filter @acropora/api test:integration`)
/// before this checkpoint is considered verified end-to-end.
describe(
  "UnasStockSyncOutboxRepository integration",
  { skip: !runIntegration },
  () => {
    const repository = new UnasStockSyncOutboxRepository();
    let warehouseId = "";
    let productId = "";
    let variantIds: string[] = [];

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      const warehouse = await prisma.warehouse.create({
        data: {
          code: `${PREFIX}${Date.now()}`,
          name: `${PREFIX}warehouse`,
        },
      });
      warehouseId = warehouse.id;

      const product = await prisma.product.create({
        data: { name: `${PREFIX}product` },
      });
      productId = product.id;
      const variants = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          prisma.productVariant.create({
            data: {
              productId: product.id,
              sku: `${PREFIX}${Date.now()}-${index}`,
            },
          }),
        ),
      );
      variantIds = variants.map((variant: { id: string }) => variant.id);
    });

    after(async () => {
      /**
       * AZONOSITO SZERINT TORLUNK, ES NEM A VALTOZAT-LISTAN AT.
       *
       * ITT EGY `every` FELTETEL ALLT (`variants: { every: { id: { in:
       * variantIds } } }`), es az URES listara IS illeszkedik -- egy ures
       * halmazra minden allitas igaz --, tehat MINDEN VALTOZAT NELKULI
       * TERMEKRE. Ha a `before` barhol elhasal a valtozatok letrehozasa elott,
       * ez a sor a seedelt katalogus valtozat nelkuli termekeit vitte volna el,
       * csendben. Egy takaritas, ami masok sorait torli, rosszabb annal, mint
       * ha a sajatjait hagyna ott.
       *
       * A KET `Cascade` MIATT KET TORLES ELEG: az `UnasStockSyncOutbox` a
       * raktarrol ES a valtozatrol is `Cascade`, a `ProductVariant` pedig a
       * termekrol -- tehat a raktar es a termek elvisz mindent, ami alattuk all.
       */
      if (warehouseId)
        await prisma.warehouse.delete({ where: { id: warehouseId } });
      if (productId) await prisma.product.delete({ where: { id: productId } });
      /**
       * ES A TAKARITAS EREDMENYET MEG IS MERJUK, ELOTAG SZERINT -- mert a ket
       * torles egy-egy `if` mogott all: ha a `before` elhasalt, egyik sem fut
       * le, es ugyanazokra az azonositokra szamolva az allitas is zold lenne.
       */
      nincsMaradek([
        {
          nev: "a suite termeke bent maradt a takaritas utan",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite raktara bent maradt a takaritas utan",
          darab: await prisma.warehouse.count({
            where: { code: { startsWith: PREFIX } },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    it("never lets two concurrent claimBatch calls return overlapping rows", async () => {
      await prisma.unasStockSyncOutbox.createMany({
        data: variantIds.map((variantId, index) => ({
          variantId,
          warehouseId,
          sku: `sku-${index}`,
          targetOnHand: "10",
          idempotencyKey: `integration-concurrent-${variantId}`,
          sourceProcess: "POS_SALE",
          sourceRecordId: "integration-test",
        })),
      });

      const [batchA, batchB] = await Promise.all([
        repository.claimBatch({
          batchSize: 3,
          leaseSeconds: 60,
          workerId: "worker-a",
        }),
        repository.claimBatch({
          batchSize: 3,
          leaseSeconds: 60,
          workerId: "worker-b",
        }),
      ]);

      const idsA = new Set(batchA.map((row) => row.id));
      const idsB = new Set(batchB.map((row) => row.id));
      const overlap = [...idsA].filter((id) => idsB.has(id));

      assert.equal(overlap.length, 0, "no row may be claimed by both workers");
      assert.equal(
        idsA.size + idsB.size,
        6,
        "all six rows must be claimed exactly once between the two batches",
      );
    });

    it("reclaims a PROCESSING row once its lease has expired (orphan recovery)", async () => {
      const orphan = await prisma.unasStockSyncOutbox.create({
        data: {
          variantId: variantIds[0]!,
          warehouseId,
          sku: "orphan-sku",
          targetOnHand: "1",
          idempotencyKey: `integration-orphan-${Date.now()}`,
          sourceProcess: "POS_SALE",
          sourceRecordId: "integration-test-orphan",
          status: "PROCESSING",
          attempts: 1,
          claimedBy: "crashed-worker",
          leaseExpiresAt: new Date(Date.now() - 60_000), // already expired
        },
      });

      const claimed = await repository.claimBatch({
        batchSize: 10,
        leaseSeconds: 60,
        workerId: "recovering-worker",
      });

      assert.ok(
        claimed.some((row) => row.id === orphan.id),
        "the expired-lease PROCESSING row must be reclaimable",
      );
    });

    it("does not reclaim a PROCESSING row whose lease has not yet expired", async () => {
      const stillAlive = await prisma.unasStockSyncOutbox.create({
        data: {
          variantId: variantIds[1]!,
          warehouseId,
          sku: "alive-sku",
          targetOnHand: "1",
          idempotencyKey: `integration-alive-${Date.now()}`,
          sourceProcess: "POS_SALE",
          sourceRecordId: "integration-test-alive",
          status: "PROCESSING",
          attempts: 1,
          claimedBy: "still-working-worker",
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      const claimed = await repository.claimBatch({
        batchSize: 10,
        leaseSeconds: 60,
        workerId: "another-worker",
      });

      assert.ok(
        !claimed.some((row) => row.id === stillAlive.id),
        "a row still within its lease window must not be reclaimed",
      );
    });

    it("atomically closes a successful publish and refreshes the variant's UNAS snapshot", async () => {
      const publishedAt = new Date();
      const outbox = await prisma.unasStockSyncOutbox.create({
        data: {
          variantId: variantIds[2]!,
          warehouseId,
          sku: "snapshot-sku",
          targetOnHand: "4.5",
          idempotencyKey: `integration-snapshot-${Date.now()}`,
          sourceProcess: "POS_SALE",
          sourceRecordId: "integration-test-snapshot",
          status: "PROCESSING",
          attempts: 1,
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      await repository.markSucceeded({
        id: outbox.id,
        variantId: variantIds[2]!,
        reportedStock: new Prisma.Decimal("4.5"),
        publishedAt,
      });

      const [savedOutbox, savedVariant] = await Promise.all([
        prisma.unasStockSyncOutbox.findUniqueOrThrow({
          where: { id: outbox.id },
        }),
        prisma.productVariant.findUniqueOrThrow({
          where: { id: variantIds[2]! },
        }),
      ]);
      assert.equal(savedOutbox.status, "SUCCEEDED");
      assert.equal(savedOutbox.leaseExpiresAt, null);
      assert.equal(
        savedOutbox.processedAt?.toISOString(),
        publishedAt.toISOString(),
      );
      assert.equal(savedVariant.unasReportedStock?.toString(), "4.5");
      assert.equal(
        savedVariant.unasReportedStockSyncedAt?.toISOString(),
        publishedAt.toISOString(),
      );
    });

    it("closes the outbox row without overwriting a newer UNAS snapshot", async () => {
      const publishedAt = new Date();
      const newerSnapshotAt = new Date(publishedAt.getTime() + 60_000);
      await prisma.productVariant.update({
        where: { id: variantIds[3]! },
        data: {
          unasReportedStock: "9",
          unasReportedStockSyncedAt: newerSnapshotAt,
        },
      });
      const outbox = await prisma.unasStockSyncOutbox.create({
        data: {
          variantId: variantIds[3]!,
          warehouseId,
          sku: "older-snapshot-sku",
          targetOnHand: "4",
          idempotencyKey: `integration-older-snapshot-${Date.now()}`,
          sourceProcess: "POS_SALE",
          sourceRecordId: "integration-test-older-snapshot",
          status: "PROCESSING",
          attempts: 1,
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      await repository.markSucceeded({
        id: outbox.id,
        variantId: variantIds[3]!,
        reportedStock: new Prisma.Decimal("4"),
        publishedAt,
      });

      const [savedOutbox, savedVariant] = await Promise.all([
        prisma.unasStockSyncOutbox.findUniqueOrThrow({
          where: { id: outbox.id },
        }),
        prisma.productVariant.findUniqueOrThrow({
          where: { id: variantIds[3]! },
        }),
      ]);
      assert.equal(savedOutbox.status, "SUCCEEDED");
      assert.equal(savedVariant.unasReportedStock?.toString(), "9");
      assert.equal(
        savedVariant.unasReportedStockSyncedAt?.toISOString(),
        newerSnapshotAt.toISOString(),
      );
    });

    /// The lease comparison used to read its two sides off different
    /// clocks: the columns are `timestamp without time zone` holding UTC,
    /// while bare `now()` is rendered in the SERVER's time zone. This test
    /// forces that time zone to something other than UTC for the duration
    /// of one transaction, which is the only way to make the difference
    /// observable - on a UTC database the broken and the fixed query behave
    /// identically, which is exactly why CI never caught it.
    ///
    /// `SET LOCAL` inside an interactive transaction is what makes this
    /// deterministic: the setting applies to that one connection until the
    /// transaction ends, so the claim below cannot be answered by a pooled
    /// connection that never saw it.
    it("keeps a live lease safe on a database that is not running UTC", async () => {
      const leaseSeconds = 60;
      const stillAlive = await prisma.unasStockSyncOutbox.create({
        data: {
          variantId: variantIds[4]!,
          warehouseId,
          sku: "budapest-alive-sku",
          targetOnHand: "1",
          idempotencyKey: `integration-tz-alive-${Date.now()}`,
          sourceProcess: "POS_SALE",
          sourceRecordId: "integration-test-tz-alive",
          status: "PROCESSING",
          attempts: 1,
          claimedBy: "still-working-worker",
          leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
        },
      });
      const pending = await prisma.unasStockSyncOutbox.create({
        data: {
          variantId: variantIds[5]!,
          warehouseId,
          sku: "budapest-pending-sku",
          targetOnHand: "2",
          idempotencyKey: `integration-tz-pending-${Date.now()}`,
          sourceProcess: "POS_SALE",
          sourceRecordId: "integration-test-tz-pending",
        },
      });

      const claimedAt = Date.now();
      await prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(
          "SET LOCAL TIME ZONE 'Europe/Budapest'",
        );
        const scoped = new UnasStockSyncOutboxRepository(
          transaction as unknown as ConstructorParameters<
            typeof UnasStockSyncOutboxRepository
          >[0],
        );

        const claimed = await scoped.claimBatch({
          batchSize: 50,
          leaseSeconds,
          workerId: "another-worker",
        });

        // The read side: a lease with a full minute left is not expired,
        // whatever time zone the server is set to.
        assert.ok(
          !claimed.some((row) => row.id === stillAlive.id),
          "a row still within its lease window must not be reclaimed on a non-UTC server",
        );
        assert.ok(
          claimed.some((row) => row.id === pending.id),
          "a due PENDING row must still be claimed on a non-UTC server",
        );
      });

      // The write side: the lease this claim just handed out has to land in
      // the column as UTC too. Stored in local time it would sit two hours
      // in the future, and the row would stay unrecoverable for that long
      // after a crash.
      const claimedRow = await prisma.unasStockSyncOutbox.findUniqueOrThrow({
        where: { id: pending.id },
      });
      const driftMs = Math.abs(
        (claimedRow.leaseExpiresAt?.getTime() ?? 0) -
          (claimedAt + leaseSeconds * 1000),
      );
      assert.ok(
        driftMs < 60_000,
        `the new lease must be stored in UTC (drift was ${Math.round(driftMs / 1000)}s)`,
      );
    });
  },
);
