-- CreateEnum
CREATE TYPE "UnasCredentialMode" AS ENUM ('ENV_FALLBACK', 'DATABASE', 'DISABLED');

-- CreateEnum
CREATE TYPE "UnasVerificationStatus" AS ENUM ('NEVER', 'SUCCESS', 'FAILED', 'INDETERMINATE');

-- CreateTable
CREATE TABLE "UnasConnectionSetting" (
    "id" TEXT NOT NULL,
    "credentialMode" "UnasCredentialMode" NOT NULL DEFAULT 'ENV_FALLBACK',
    "encryptedApiKey" BYTEA,
    "encryptionIv" BYTEA,
    "authenticationTag" BYTEA,
    "keyVersion" TEXT,
    "credentialRevision" INTEGER NOT NULL DEFAULT 0,
    "credentialUpdatedAt" TIMESTAMP(3),
    "credentialUpdatedByUserId" TEXT,
    "verificationStatus" "UnasVerificationStatus" NOT NULL DEFAULT 'NEVER',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerificationCode" TEXT,
    "credentialAttemptedAt" TIMESTAMP(3),
    "testAttemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnasConnectionSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UnasConnectionSetting_singleton_check" CHECK ("id" = 'unas'),
    CONSTRAINT "UnasConnectionSetting_credential_revision_check" CHECK ("credentialRevision" >= 0),
    CONSTRAINT "UnasConnectionSetting_verification_code_check" CHECK (
      "lastVerificationCode" IS NULL OR "lastVerificationCode" IN (
        'UNAS_CONNECTION_CONFIGURATION_MISSING',
        'UNAS_CONNECTION_NOT_CONFIGURED',
        'UNAS_CONNECTION_DISABLED',
        'UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED',
        'UNAS_CREDENTIAL_MASTER_KEY_INVALID',
        'UNAS_CREDENTIAL_KEY_VERSION_UNKNOWN',
        'UNAS_CREDENTIAL_ENVELOPE_INVALID',
        'UNAS_CREDENTIAL_DECRYPT_FAILED',
        'UNAS_CONNECTION_AUTH_REJECTED',
        'UNAS_CONNECTION_PERMISSION_MISSING',
        'UNAS_CONNECTION_PERMISSION_UNKNOWN',
        'UNAS_CONNECTION_VERIFICATION_STALE',
        'UNAS_CREDENTIAL_INPUT_INVALID',
        'UNAS_CONNECTION_RATE_LIMITED',
        'UNAS_CONNECTION_HTTP_4XX',
        'UNAS_CONNECTION_HTTP_5XX',
        'UNAS_CONNECTION_RATE_LIMITED_UPSTREAM',
        'UNAS_CONNECTION_TIMEOUT',
        'UNAS_CONNECTION_NETWORK_FAILED',
        'UNAS_CONNECTION_API_REJECTED',
        'UNAS_CONNECTION_RESPONSE_INVALID',
        'UNAS_CONNECTION_FAILED'
      )
    ),
    CONSTRAINT "UnasConnectionSetting_envelope_check" CHECK (
      (
        "credentialMode" = 'DATABASE'
        AND "encryptedApiKey" IS NOT NULL
        AND octet_length("encryptedApiKey") > 0
        AND "encryptionIv" IS NOT NULL
        AND octet_length("encryptionIv") = 12
        AND "authenticationTag" IS NOT NULL
        AND octet_length("authenticationTag") = 16
        AND "keyVersion" IS NOT NULL
      ) OR (
        "credentialMode" <> 'DATABASE'
        AND "encryptedApiKey" IS NULL
        AND "encryptionIv" IS NULL
        AND "authenticationTag" IS NULL
        AND "keyVersion" IS NULL
      )
    )
);

-- CreateIndex
CREATE INDEX "UnasConnectionSetting_credentialUpdatedByUserId_idx" ON "UnasConnectionSetting"("credentialUpdatedByUserId");

-- AddForeignKey
ALTER TABLE "UnasConnectionSetting" ADD CONSTRAINT "UnasConnectionSetting_credentialUpdatedByUserId_fkey" FOREIGN KEY ("credentialUpdatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the singleton in explicit migration mode without storing a secret.
INSERT INTO "UnasConnectionSetting" (
  "id",
  "credentialMode",
  "updatedAt"
) VALUES (
  'unas',
  'ENV_FALLBACK',
  CURRENT_TIMESTAMP
);
