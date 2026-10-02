-- MATERIAL REQUESTS V2 (docs/material-requests/v2-discovery.md, Figma 404:533).
--
-- ADDITIVE ONLY: three statuses and CANCELLED are added, every new column is
-- nullable, two new tables. No existing row changes status or meaning, and no
-- V1 column is dropped or retyped.
--
-- BACKFILL, ONLY FROM STORED VALUES (owner decision, 2026-10-02):
--   * `quantityValue` where the text quantity is a plain number;
--   * a SUBMITTED history row from each stored `submittedAt`;
--   * a RECEIVED history row from each stored `receivedAt`.
-- Nothing is invented: no handler, no order time, no item-level receiving, no
-- deadline or priority. A request without a stored timestamp gets no row for
-- that step.

-- New statuses. Not used anywhere in this migration, so adding them inside
-- the migration's transaction is safe (PostgreSQL 12+).
ALTER TYPE "MaterialRequestStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "MaterialRequestStatus" ADD VALUE 'ORDERED';
ALTER TYPE "MaterialRequestStatus" ADD VALUE 'PARTIALLY_RECEIVED';
ALTER TYPE "MaterialRequestStatus" ADD VALUE 'CANCELLED';

CREATE TYPE "MaterialRequestPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

CREATE TYPE "MaterialRequestEventKind" AS ENUM ('SUBMITTED', 'CLAIMED', 'REASSIGNED', 'ORDERED', 'ITEMS_RECEIVED', 'RECEIVED', 'CANCELLED');

ALTER TABLE "MaterialRequest" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "handlerAssignedAt" TIMESTAMP(3),
ADD COLUMN     "handlerId" TEXT,
ADD COLUMN     "neededBy" DATE,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "orderedAt" TIMESTAMP(3),
ADD COLUMN     "orderedById" TEXT,
ADD COLUMN     "priority" "MaterialRequestPriority";

ALTER TABLE "MaterialRequestItem" ADD COLUMN     "quantityValue" DECIMAL(12,3),
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" TEXT,
ADD COLUMN     "receivedQuantity" DECIMAL(12,3);

CREATE TABLE "MaterialRequestEvent" (
    "id" TEXT NOT NULL,
    "materialRequestId" TEXT NOT NULL,
    "kind" "MaterialRequestEventKind" NOT NULL,
    "fromStatus" "MaterialRequestStatus",
    "toStatus" "MaterialRequestStatus",
    "actorUserId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialRequestEvent_pkey" PRIMARY KEY ("id")
);

-- A status change always names where it went. Only REASSIGNED and
-- ITEMS_RECEIVED (when it does not change the status) may leave it empty.
ALTER TABLE "MaterialRequestEvent" ADD CONSTRAINT "MaterialRequestEvent_status_change_has_to_status"
  CHECK ("kind" IN ('REASSIGNED', 'ITEMS_RECEIVED') OR "toStatus" IS NOT NULL);

CREATE TABLE "MaterialRequestComment" (
    "id" TEXT NOT NULL,
    "materialRequestId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialRequestComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialRequestEvent_materialRequestId_createdAt_idx" ON "MaterialRequestEvent"("materialRequestId", "createdAt");

CREATE INDEX "MaterialRequestComment_materialRequestId_createdAt_idx" ON "MaterialRequestComment"("materialRequestId", "createdAt");

CREATE INDEX "MaterialRequest_handlerId_status_idx" ON "MaterialRequest"("handlerId", "status");

ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_handlerId_fkey" FOREIGN KEY ("handlerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaterialRequestItem" ADD CONSTRAINT "MaterialRequestItem_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaterialRequestEvent" ADD CONSTRAINT "MaterialRequestEvent_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialRequestEvent" ADD CONSTRAINT "MaterialRequestEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaterialRequestComment" ADD CONSTRAINT "MaterialRequestComment_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialRequestComment" ADD CONSTRAINT "MaterialRequestComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BACKFILL 1: the numeric quantity. The SAME rule as `parseQuantityValue` in
-- apps/api/src/material-requests/material-request-workflow.ts: up to 9
-- integer digits and up to 3 decimals (it must fit DECIMAL(12,3) exactly, never
-- rounded), one decimal comma or point. Everything else stays text only.
UPDATE "MaterialRequestItem"
SET "quantityValue" = replace(btrim("quantity"), ',', '.')::numeric
WHERE btrim("quantity") ~ '^[0-9]{1,9}([.,][0-9]{1,3})?$';

-- BACKFILL 2: the history, from stored timestamps and users only. The ids are
-- derived from the request id, so the rows are recognisable as backfilled.
INSERT INTO "MaterialRequestEvent" ("id", "materialRequestId", "kind", "fromStatus", "toStatus", "actorUserId", "createdAt")
SELECT 'backfill-submitted-' || "id", "id", 'SUBMITTED', 'DRAFT', 'OPEN', "requestedById", "submittedAt"
FROM "MaterialRequest"
WHERE "submittedAt" IS NOT NULL;

INSERT INTO "MaterialRequestEvent" ("id", "materialRequestId", "kind", "fromStatus", "toStatus", "actorUserId", "createdAt")
SELECT 'backfill-received-' || "id", "id", 'RECEIVED', 'OPEN', 'RECEIVED', "receivedById", "receivedAt"
FROM "MaterialRequest"
WHERE "receivedAt" IS NOT NULL;
