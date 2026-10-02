-- A felhasználó saját vezérlőpult-elrendezése (docs/dashboard/v1-discovery.md).
-- Sor nélkül a szerepkör ajánlott elrendezése érvényes.
-- CreateTable
CREATE TABLE "UserDashboardLayout" (
    "userId" TEXT NOT NULL,
    "widgets" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDashboardLayout_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserDashboardLayout" ADD CONSTRAINT "UserDashboardLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
