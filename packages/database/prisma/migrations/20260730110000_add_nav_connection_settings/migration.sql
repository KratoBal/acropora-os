-- CreateEnum
CREATE TYPE "NavCredentialMode" AS ENUM ('ENV_FALLBACK', 'DATABASE', 'DISABLED');

-- CreateEnum
CREATE TYPE "NavVerificationStatus" AS ENUM ('NEVER', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "NavConnectionSetting" (
    "id" TEXT NOT NULL,
    "credentialMode" "NavCredentialMode" NOT NULL DEFAULT 'ENV_FALLBACK',
    "encryptedCredentials" BYTEA,
    "encryptionIv" BYTEA,
    "authenticationTag" BYTEA,
    "keyVersion" TEXT,
    "credentialRevision" INTEGER NOT NULL DEFAULT 0,
    "credentialUpdatedAt" TIMESTAMP(3),
    "credentialUpdatedByUserId" TEXT,
    "verificationStatus" "NavVerificationStatus" NOT NULL DEFAULT 'NEVER',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerificationCode" TEXT,
    "credentialAttemptedAt" TIMESTAMP(3),
    "testAttemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavConnectionSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NavConnectionSetting_singleton_check" CHECK ("id" = 'nav'),
    CONSTRAINT "NavConnectionSetting_credential_revision_check" CHECK ("credentialRevision" >= 0),
    CONSTRAINT "NavConnectionSetting_envelope_check" CHECK (
      (
        "credentialMode" = 'DATABASE'
        AND "encryptedCredentials" IS NOT NULL
        AND octet_length("encryptedCredentials") > 0
        AND "encryptionIv" IS NOT NULL
        AND octet_length("encryptionIv") = 12
        AND "authenticationTag" IS NOT NULL
        AND octet_length("authenticationTag") = 16
        AND "keyVersion" IS NOT NULL
      ) OR (
        "credentialMode" <> 'DATABASE'
        AND "encryptedCredentials" IS NULL
        AND "encryptionIv" IS NULL
        AND "authenticationTag" IS NULL
        AND "keyVersion" IS NULL
      )
    )
);

-- CreateIndex
CREATE INDEX "NavConnectionSetting_credentialUpdatedByUserId_idx" ON "NavConnectionSetting"("credentialUpdatedByUserId");

-- AddForeignKey
ALTER TABLE "NavConnectionSetting" ADD CONSTRAINT "NavConnectionSetting_credentialUpdatedByUserId_fkey" FOREIGN KEY ("credentialUpdatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep current deployments working from NAV_* environment variables until
-- an owner saves and verifies a database-backed credential set in the UI.
INSERT INTO "NavConnectionSetting" (
  "id",
  "credentialMode",
  "updatedAt"
) VALUES (
  'nav',
  'ENV_FALLBACK',
  CURRENT_TIMESTAMP
);
