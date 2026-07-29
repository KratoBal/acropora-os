import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { UnasStockSyncOutboxRepository } from "./unas-stock-sync-outbox.repository.js";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";

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
  "UnasStockSyncOutboxRepository.claimBatch integration",
  { skip: !runIntegration },
  () => {
    const repository = new UnasStockSyncOutboxRepository();
    let warehouseId = "";
    let variantIds: string[] = [];

    before(async () => {
      const warehouse = await prisma.warehouse.create({
        data: {
          code: `TEST-${Date.now()}`,
          name: "Integration test warehouse",
        },
      });
      warehouseId = warehouse.id;

      const product = await prisma.product.create({
        data: { name: "Integration test product" },
      });
      const variants = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          prisma.productVariant.create({
            data: {
              productId: product.id,
              sku: `INTEGRATION-SKU-${Date.now()}-${index}`,
            },
          }),
        ),
      );
      variantIds = variants.map((variant: { id: string }) => variant.id);
    });

    after(async () => {
      await prisma.unasStockSyncOutbox.deleteMany({
        where: { warehouseId },
      });
      await prisma.productVariant.deleteMany({
        where: { id: { in: variantIds } },
      });
      await prisma.product.deleteMany({
        where: { variants: { every: { id: { in: variantIds } } } },
      });
      await prisma.warehouse.delete({ where: { id: warehouseId } });
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
      assert.equal(idsA.size + idsB.size, 6, "all six rows must be claimed exactly once between the two batches");
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
  },
);
