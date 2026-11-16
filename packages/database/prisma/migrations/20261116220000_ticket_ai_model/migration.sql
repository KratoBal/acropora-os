-- A TICKET@ AI HIBAJEGY-VAZLAT ADATMODELLJE (kartya ec7b947b, S1; terv: agents/murena/ticket-ai-terv-2026-11-16.md).
-- Csak szerkezet: meglevo sort nem ervel at (az uj oszlop alapertéke RULE_DRAFT), a kepesseg senkinel nincs
-- bejelolve, az ertesitesi szerep senkinel nincs bejelolve. Levelolvasas, AI-hivas es felulet nem resze.

-- AlterEnum
--
-- Az `ALTER TYPE ... ADD VALUE` ugyanabban a tranzakcioban biztonsagos, mert a migracio az uj ertekeket nem
-- hasznalja DML-ben (a repo eddigi enum-bovitesenek alakja, lasd 20261007000000_webshop_transfer_receipt).
ALTER TYPE "NotificationRole" ADD VALUE 'SERVICE_TICKET_AI_DRAFT';
ALTER TYPE "ServiceCapability" ADD VALUE 'TICKET_MAIL_AI_WATCH';

-- CreateEnum
CREATE TYPE "ServiceDraftIntakeState" AS ENUM ('RULE_DRAFT', 'AI_DRAFT', 'AI_UNAVAILABLE', 'WATCH_OFF', 'UNKNOWN_SENDER');

-- AlterTable
ALTER TABLE "ServiceTicketDraft" ADD COLUMN "intakeState" "ServiceDraftIntakeState" NOT NULL DEFAULT 'RULE_DRAFT';

-- CreateIndex
CREATE INDEX "ServiceTicketDraft_status_intakeState_idx" ON "ServiceTicketDraft"("status", "intakeState");
