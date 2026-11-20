-- Why a supplier rule matched a collected PDF and still left it to a person (card e09190c8, acrobot 58517): the reason code and the rule.

-- AlterTable
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN     "ruleRefusal" TEXT,
ADD COLUMN     "ruleRefusalRuleId" TEXT;
