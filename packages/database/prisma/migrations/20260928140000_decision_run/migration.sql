-- A Jev V1 elotoltes-pilot audit- es meresi tablaja (#1199 P-012, PD-005 ACCEPT).
-- Uj tabla es enumok, a meglevo sorokhoz nem nyul.
-- Az indoklas a schema.prisma-ban all: ez a fajl alkalmazas utan befagy.

-- CreateEnum
CREATE TYPE "DecisionExposure" AS ENUM ('HIDDEN', 'SHOWN');

-- CreateEnum
CREATE TYPE "DecisionResolution" AS ENUM ('ACCEPTED', 'OVERRIDDEN', 'SHADOW_MATCH', 'SHADOW_MISMATCH', 'STALE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DecisionRunStatus" AS ENUM ('OK', 'ERROR');

-- CreateTable
CREATE TABLE "DecisionRun" (
    "id" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "projectionHash" TEXT NOT NULL,
    "projectionPayload" JSONB,
    "optionsHash" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "respondedModel" TEXT,
    "selectedValue" TEXT,
    "probabilities" JSONB,
    "confidence" DOUBLE PRECISION,
    "exposure" "DecisionExposure" NOT NULL,
    "resolution" "DecisionResolution",
    "resolvedValue" TEXT,
    "status" "DecisionRunStatus" NOT NULL,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "errorCode" TEXT,
    "errorMessage" VARCHAR(500),
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "clientOperationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DecisionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionRun_policyKey_policyVersion_createdAt_idx" ON "DecisionRun"("policyKey", "policyVersion", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionRun_clientOperationId_idx" ON "DecisionRun"("clientOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionRun_entityType_entityId_policyKey_policyVersion_pro_key" ON "DecisionRun"("entityType", "entityId", "policyKey", "policyVersion", "projectionHash", "optionsHash", "requestedModel");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionRun_policyKey_policyVersion_clientOperationId_proje_key" ON "DecisionRun"("policyKey", "policyVersion", "clientOperationId", "projectionHash", "optionsHash", "requestedModel");

