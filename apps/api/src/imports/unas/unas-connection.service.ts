import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

import { UnasApiClient, UnasApiError } from "./unas-api.client.js";
import { UnasConnectionRepository } from "./unas-connection.repository.js";
import {
  UNAS_VERIFICATION_STALE_MS,
  UnasConnectionError,
  isUnasConnectionErrorCode,
  type StoredUnasVerificationStatus,
  type UnasConnectionErrorCode,
  type UnasConnectionSettingRecord,
  type UnasConnectionView,
} from "./unas-connection.types.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";
import { assertValidUnasLoginExpiry, UnasClock } from "./unas-login-expiry.js";

interface VerificationResult {
  status: "SUCCESS" | "INDETERMINATE";
  code: UnasConnectionErrorCode | null;
}

function apiErrorCode(error: unknown): UnasConnectionErrorCode {
  if (error instanceof UnasConnectionError) return error.code;
  if (!(error instanceof UnasApiError)) return "UNAS_CONNECTION_FAILED";
  const codes: Record<UnasApiError["code"], UnasConnectionErrorCode> = {
    AUTH_REJECTED: "UNAS_CONNECTION_AUTH_REJECTED",
    RATE_LIMITED: "UNAS_CONNECTION_RATE_LIMITED_UPSTREAM",
    HTTP_4XX: "UNAS_CONNECTION_HTTP_4XX",
    HTTP_5XX: "UNAS_CONNECTION_HTTP_5XX",
    HTTP_OTHER: "UNAS_CONNECTION_FAILED",
    NETWORK_FAILED: "UNAS_CONNECTION_NETWORK_FAILED",
    TIMEOUT: "UNAS_CONNECTION_TIMEOUT",
    API_REJECTED: "UNAS_CONNECTION_API_REJECTED",
    XML_INVALID: "UNAS_CONNECTION_RESPONSE_INVALID",
    XML_TOO_LARGE: "UNAS_CONNECTION_RESPONSE_INVALID",
    XML_FORBIDDEN: "UNAS_CONNECTION_RESPONSE_INVALID",
    RESPONSE_SHAPE_INVALID: "UNAS_CONNECTION_RESPONSE_INVALID",
    FIELD_FORMAT_INVALID: "UNAS_CONNECTION_RESPONSE_INVALID",
    REQUEST_INVALID: "UNAS_CONNECTION_RESPONSE_INVALID",
  };
  return codes[error.code];
}

function httpStatus(code: UnasConnectionErrorCode): HttpStatus {
  if (code === "UNAS_CONNECTION_RATE_LIMITED")
    return HttpStatus.TOO_MANY_REQUESTS;
  if (
    code === "UNAS_CONNECTION_AUTH_REJECTED" ||
    code === "UNAS_CONNECTION_PERMISSION_MISSING" ||
    code === "UNAS_CREDENTIAL_INPUT_INVALID"
  )
    return HttpStatus.UNPROCESSABLE_ENTITY;
  if (
    code === "UNAS_CONNECTION_NOT_CONFIGURED" ||
    code === "UNAS_CONNECTION_DISABLED"
  )
    return HttpStatus.CONFLICT;
  if (
    code === "UNAS_CONNECTION_CONFIGURATION_MISSING" ||
    code.startsWith("UNAS_CREDENTIAL_MASTER_KEY") ||
    code.startsWith("UNAS_CREDENTIAL_KEY_VERSION") ||
    code.startsWith("UNAS_CREDENTIAL_DECRYPT") ||
    code.startsWith("UNAS_CREDENTIAL_ENVELOPE")
  )
    return HttpStatus.SERVICE_UNAVAILABLE;
  return HttpStatus.BAD_GATEWAY;
}

function safeException(error: unknown): HttpException {
  const code = apiErrorCode(error);
  return new HttpException(code, httpStatus(code));
}

@Injectable()
export class UnasConnectionService {
  constructor(
    private readonly repository: UnasConnectionRepository,
    private readonly crypto: UnasCredentialCryptoService,
    private readonly credentials: UnasCredentialProvider,
    private readonly api: UnasApiClient,
    private readonly clock: UnasClock,
  ) {}

  async get(now = new Date()): Promise<UnasConnectionView> {
    try {
      const setting = await this.repository.getSetting();
      if (!setting)
        throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
      return this.view(setting, now);
    } catch (error) {
      throw safeException(error);
    }
  }

  async replaceCredential(
    apiKeyInput: string,
    actorUserId: string,
    now = new Date(),
  ): Promise<UnasConnectionView> {
    const apiKey = apiKeyInput.trim();
    if (!apiKey)
      throw safeException(
        new UnasConnectionError("UNAS_CREDENTIAL_INPUT_INVALID"),
      );
    let claimed: UnasConnectionSettingRecord | null;
    try {
      claimed = await this.repository.claimCooldown("credential");
    } catch (error) {
      throw safeException(error);
    }
    if (!claimed)
      throw safeException(
        new UnasConnectionError("UNAS_CONNECTION_RATE_LIMITED"),
      );

    let verification: VerificationResult;
    try {
      verification = await this.verify(apiKey);
    } catch (error) {
      const code = apiErrorCode(error);
      try {
        await this.repository.auditCredentialValidationFailure(
          actorUserId,
          code,
        );
      } catch {
        throw safeException(new UnasConnectionError("UNAS_CONNECTION_FAILED"));
      }
      throw safeException(new UnasConnectionError(code));
    }

    try {
      const revision = claimed.credentialRevision + 1;
      const envelope = this.crypto.encrypt(apiKey, revision);
      const setting = await this.repository.replaceCredential({
        envelope,
        revision,
        actorUserId,
        verifiedAt: now,
        verificationStatus: verification.status,
        verificationCode: verification.code,
      });
      return this.view(setting, now);
    } catch (error) {
      throw safeException(error);
    }
  }

  async testStoredCredential(
    actorUserId: string,
    now = new Date(),
  ): Promise<UnasConnectionView> {
    let claimed: UnasConnectionSettingRecord | null;
    try {
      claimed = await this.repository.claimCooldown("test");
    } catch (error) {
      throw safeException(error);
    }
    if (!claimed)
      throw safeException(
        new UnasConnectionError("UNAS_CONNECTION_RATE_LIMITED"),
      );

    let status: Exclude<StoredUnasVerificationStatus, "NEVER">;
    let code: UnasConnectionErrorCode | null;
    try {
      const credential = this.credentials.resolveRecord(claimed);
      const verification = await this.verify(credential.apiKey);
      status = verification.status;
      code = verification.code;
    } catch (error) {
      status = "FAILED";
      code = apiErrorCode(error);
    }
    try {
      const persisted = await this.repository.recordManualTest({
        actorUserId,
        checkedAt: now,
        status,
        code,
        expectedCredentialMode: claimed.credentialMode,
        expectedCredentialRevision: claimed.credentialRevision,
      });
      return this.view(persisted.setting, now);
    } catch (error) {
      throw safeException(error);
    }
  }

  async disable(
    actorUserId: string,
    now = new Date(),
  ): Promise<UnasConnectionView> {
    let claimed: UnasConnectionSettingRecord | null;
    try {
      claimed = await this.repository.claimCooldown("credential");
    } catch (error) {
      throw safeException(error);
    }
    if (!claimed)
      throw safeException(
        new UnasConnectionError("UNAS_CONNECTION_RATE_LIMITED"),
      );
    try {
      return this.view(await this.repository.disable(actorUserId, now), now);
    } catch (error) {
      throw safeException(error);
    }
  }

  private async verify(apiKey: string): Promise<VerificationResult> {
    const login = await this.api.login(apiKey);
    assertValidUnasLoginExpiry(login.expireTime, this.clock.nowMs());
    if (login.permissions == null)
      return {
        status: "INDETERMINATE",
        code: "UNAS_CONNECTION_PERMISSION_UNKNOWN",
      };
    if (
      !login.permissions.includes("getProduct") ||
      !login.permissions.includes("getCategory")
    )
      throw new UnasConnectionError("UNAS_CONNECTION_PERMISSION_MISSING");
    return { status: "SUCCESS", code: null };
  }

  private view(
    setting: UnasConnectionSettingRecord,
    now: Date,
  ): UnasConnectionView {
    const configured =
      setting.credentialMode === "DATABASE"
        ? Boolean(
            setting.encryptedApiKey &&
            setting.encryptionIv &&
            setting.authenticationTag &&
            setting.keyVersion,
          )
        : setting.credentialMode === "ENV_FALLBACK"
          ? Boolean(process.env.UNAS_API_KEY?.trim())
          : false;
    const checkedAt = setting.lastVerifiedAt;
    const stale = Boolean(
      checkedAt &&
      setting.verificationStatus !== "NEVER" &&
      now.getTime() - checkedAt.getTime() > UNAS_VERIFICATION_STALE_MS,
    );
    return {
      configured,
      masked: configured ? "••••••••" : null,
      modifiedAt: setting.credentialUpdatedAt?.toISOString() ?? null,
      verification: {
        status: stale ? "STALE" : setting.verificationStatus,
        checkedAt: checkedAt?.toISOString() ?? null,
        code: stale
          ? "UNAS_CONNECTION_VERIFICATION_STALE"
          : isUnasConnectionErrorCode(setting.lastVerificationCode)
            ? setting.lastVerificationCode
            : setting.lastVerificationCode === null
              ? null
              : "UNAS_CONNECTION_FAILED",
      },
    };
  }
}
