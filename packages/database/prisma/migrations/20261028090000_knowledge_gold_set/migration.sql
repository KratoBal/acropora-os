-- Kutatasi tudastar, T3 arany-keszlet (terv v4, 10. pont, T3; research-t3-jelolt-keszlet, acrobot
-- 37324 es 37327): a szerkeszto soronkent biralja tiz forras gepi kiolvasasat. Ket uj tabla: a keszlet
-- forrasai (a rogziteskor a forras gepi allitasainak id-jeivel) es a kimaradt allitasok. A pontossagot
-- a meglevo mezonkenti dontesek adjak, ehhez nem kell uj oszlop.
--
-- Csak uj tablak, meglevo sor nem valtozik: visszafele kompatibilis.
-- Visszaallitas: DROP TABLE "KnowledgeGoldMissedClaim"; DROP TABLE "KnowledgeGoldSource";

-- CreateTable
CREATE TABLE "KnowledgeGoldSource" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "claimIds" TEXT[],
    "position" INTEGER NOT NULL,
    "frozenById" TEXT NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completenessCheckedById" TEXT,
    "completenessCheckedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeGoldSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGoldMissedClaim" (
    "id" TEXT NOT NULL,
    "goldSourceId" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "locator" VARCHAR(128),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGoldMissedClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGoldSource_sourceId_key" ON "KnowledgeGoldSource"("sourceId");

-- CreateIndex
CREATE INDEX "KnowledgeGoldMissedClaim_goldSourceId_idx" ON "KnowledgeGoldMissedClaim"("goldSourceId");

-- AddForeignKey
ALTER TABLE "KnowledgeGoldSource" ADD CONSTRAINT "KnowledgeGoldSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGoldSource" ADD CONSTRAINT "KnowledgeGoldSource_frozenById_fkey" FOREIGN KEY ("frozenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGoldSource" ADD CONSTRAINT "KnowledgeGoldSource_completenessCheckedById_fkey" FOREIGN KEY ("completenessCheckedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGoldMissedClaim" ADD CONSTRAINT "KnowledgeGoldMissedClaim_goldSourceId_fkey" FOREIGN KEY ("goldSourceId") REFERENCES "KnowledgeGoldSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGoldMissedClaim" ADD CONSTRAINT "KnowledgeGoldMissedClaim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- a keszlet sorrendje 1-tol (az egyediseg a semaban all: KnowledgeGoldSource_position_key)
ALTER TABLE "KnowledgeGoldSource" ADD CONSTRAINT "KnowledgeGoldSource_position_check" CHECK ("position" >= 1);

-- a "kesz" kimondasa: ki es mikor, egyutt vagy egyik sem
ALTER TABLE "KnowledgeGoldSource" ADD CONSTRAINT "KnowledgeGoldSource_completeness_check"
  CHECK (("completenessCheckedById" IS NULL) = ("completenessCheckedAt" IS NULL));

-- egy kimaradt allitas nem ures
ALTER TABLE "KnowledgeGoldMissedClaim" ADD CONSTRAINT "KnowledgeGoldMissedClaim_text_check" CHECK (length(btrim("text")) > 0);
