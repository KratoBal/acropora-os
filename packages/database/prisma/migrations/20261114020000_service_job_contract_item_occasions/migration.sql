-- A megrendelőlap nélküli lap tételének alkalomszáma (Luca, 2026-11-13). A régi sorok 1 alkalmat vittek: az alap 1.
ALTER TABLE "ServiceJobContractItem" ADD COLUMN "occasions" INTEGER NOT NULL DEFAULT 1;
