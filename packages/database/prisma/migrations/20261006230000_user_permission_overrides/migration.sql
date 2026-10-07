-- FELHASZNALONKENTI JOG-ELTERES (Balazs dontese, 2026-10-06: szerepkor-sablon + egyeni elteres).
-- Csak uj tabla es enum; meglevo adathoz nem nyul. Ures tablaval a viselkedes valtozatlan.
-- CreateEnum
CREATE TYPE "PermissionOverrideEffect" AS ENUM ('GRANT', 'REVOKE');

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "userId" TEXT NOT NULL,
    "permission" VARCHAR(64) NOT NULL,
    "effect" "PermissionOverrideEffect" NOT NULL,
    "setById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("userId","permission")
);

-- CreateIndex
CREATE INDEX "UserPermissionOverride_permission_effect_idx" ON "UserPermissionOverride"("permission", "effect");

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

