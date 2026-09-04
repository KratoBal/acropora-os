CREATE TYPE "OrderBusinessStatus" AS ENUM ('PENDING_FULFILLMENT', 'CONFIRMED', 'STOCKING', 'SHIPPING', 'READY_FOR_PICKUP', 'CLOSED', 'CLOSED_UNSUCCESSFULLY');
CREATE TYPE "OrderBusinessStatusEventSource" AS ENUM ('MIGRATION', 'USER', 'UNAS_SYNC', 'CARRIER');

ALTER TABLE "SalesOrder" ADD COLUMN "businessStatus" "OrderBusinessStatus";

-- The detailed UNAS label is the primary source. StatusType only settles the
-- two terminal states because it deliberately merges the open fulfilment ones.
UPDATE "SalesOrder" AS o
SET "businessStatus" = CASE
  WHEN er."metadata"->>'unasStatus' IN ('Feldolgozásra vár', 'Feldolgozás alatt') THEN 'PENDING_FULFILLMENT'::"OrderBusinessStatus"
  WHEN er."metadata"->>'unasStatus' = 'Visszaigazolva' THEN 'CONFIRMED'::"OrderBusinessStatus"
  WHEN er."metadata"->>'unasStatus' IN ('Készletezés alatt', 'Csomagolás alatt') THEN 'STOCKING'::"OrderBusinessStatus"
  WHEN er."metadata"->>'unasStatus' = 'Kiszállítás' THEN 'SHIPPING'::"OrderBusinessStatus"
  WHEN er."metadata"->>'unasStatus' = 'Átvehető' THEN 'READY_FOR_PICKUP'::"OrderBusinessStatus"
  WHEN er."metadata"->>'unasStatus' IN ('Megrendelés lezárva', 'Lezárva') THEN 'CLOSED'::"OrderBusinessStatus"
  WHEN er."metadata"->>'unasStatus' IN ('Sikertelenül lezárt rendelés', 'Sztornó') THEN 'CLOSED_UNSUCCESSFULLY'::"OrderBusinessStatus"
  WHEN er."metadata"->>'unasStatusType' = 'close_ok' THEN 'CLOSED'::"OrderBusinessStatus"
  WHEN er."metadata"->>'unasStatusType' = 'close_fault' THEN 'CLOSED_UNSUCCESSFULLY'::"OrderBusinessStatus"
  WHEN o."status" = 'COMPLETED' THEN 'CLOSED'::"OrderBusinessStatus"
  WHEN o."status" = 'CANCELLED' THEN 'CLOSED_UNSUCCESSFULLY'::"OrderBusinessStatus"
  WHEN o."status" IN ('PICKING', 'PACKED') THEN 'STOCKING'::"OrderBusinessStatus"
  WHEN o."status" = 'SHIPPED' THEN 'SHIPPING'::"OrderBusinessStatus"
  ELSE 'PENDING_FULFILLMENT'::"OrderBusinessStatus"
END
FROM "ExternalReference" er
WHERE er."system" = 'UNAS' AND er."entityType" = 'SalesOrder' AND er."entityId" = o."id";

UPDATE "SalesOrder"
SET "businessStatus" = CASE
  WHEN "status" = 'COMPLETED' THEN 'CLOSED'::"OrderBusinessStatus"
  WHEN "status" = 'CANCELLED' THEN 'CLOSED_UNSUCCESSFULLY'::"OrderBusinessStatus"
  WHEN "status" IN ('PICKING', 'PACKED') THEN 'STOCKING'::"OrderBusinessStatus"
  WHEN "status" = 'SHIPPED' THEN 'SHIPPING'::"OrderBusinessStatus"
  ELSE 'PENDING_FULFILLMENT'::"OrderBusinessStatus"
END
WHERE "businessStatus" IS NULL;

ALTER TABLE "SalesOrder" ALTER COLUMN "businessStatus" SET NOT NULL, ALTER COLUMN "businessStatus" SET DEFAULT 'PENDING_FULFILLMENT';
CREATE INDEX "SalesOrder_businessStatus_createdAt_idx" ON "SalesOrder"("businessStatus", "createdAt");

CREATE TABLE "OrderBusinessStatusEvent" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "fromStatus" "OrderBusinessStatus",
  "toStatus" "OrderBusinessStatus" NOT NULL,
  "source" "OrderBusinessStatusEventSource" NOT NULL,
  "actorUserId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderBusinessStatusEvent_pkey" PRIMARY KEY ("id")
);

INSERT INTO "OrderBusinessStatusEvent" ("id", "orderId", "fromStatus", "toStatus", "source")
SELECT 'migration-' || md5(o."id"), o."id", NULL, o."businessStatus", 'MIGRATION'::"OrderBusinessStatusEventSource"
FROM "SalesOrder" o;

CREATE INDEX "OrderBusinessStatusEvent_orderId_createdAt_idx" ON "OrderBusinessStatusEvent"("orderId", "createdAt");
CREATE INDEX "OrderBusinessStatusEvent_actorUserId_createdAt_idx" ON "OrderBusinessStatusEvent"("actorUserId", "createdAt");
ALTER TABLE "OrderBusinessStatusEvent" ADD CONSTRAINT "OrderBusinessStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderBusinessStatusEvent" ADD CONSTRAINT "OrderBusinessStatusEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
