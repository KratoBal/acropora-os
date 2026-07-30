import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  NavConnectionCredentialInput,
  NavConnectionView,
} from "@acropora/types";

import { NavConnectionRepository } from "./nav-connection.repository.js";
import {
  NAV_VERIFICATION_STALE_MS,
  NavConnectionError,
  isNavConnectionErrorCode,
  type NavConnectionErrorCode,
  type NavConnectionSettingRecord,
} from "./nav-connection.types.js";
import { NavCredentialCryptoService } from "./nav-credential-crypto.service.js";
import { NavCredentialsService } from "./nav-credentials.service.js";
import {
  NavApiError,
  NavOnlineInvoiceClient,
} from "./nav-online-invoice.client.js";

function apiErrorCode(error: unknown): NavConnectionErrorCode {
  if (error instanceof NavConnectionError) return error.code;
  if (error instanceof ServiceUnavailableException) {
    const response = error.getResponse();
    if (typeof response === "string" && isNavConnectionErrorCode(response))
      return response;
  }
  if (!(error instanceof NavApiError)) return "NAV_CONNECTION_FAILED";
  const codes: Record<NavApiError["code"], NavConnectionErrorCode> = {
    NOT_CONFIGURED: "NAV_CONNECTION_NOT_CONFIGURED",
    REQUEST_INVALID: "NAV_CONNECTION_RESPONSE_INVALID",
    AUTH_REJECTED: "NAV_CONNECTION_AUTH_REJECTED",
    API_REJECTED: "NAV_CONNECTION_API_REJECTED",
    HTTP_4XX: "NAV_CONNECTION_HTTP_4XX",
    HTTP_5XX: "NAV_CONNECTION_HTTP_5XX",
    HTTP_OTHER: "NAV_CONNECTION_FAILED",
    NETWORK_FAILED: "NAV_CONNECTION_NETWORK_FAILED",
    TIMEOUT: "NAV_CONNECTION_TIMEOUT",
    XML_INVALID: "NAV_CONNECTION_RESPONSE_INVALID",
    XML_TOO_LARGE: "NAV_CONNECTION_RESPONSE_INVALID",
    RESPONSE_SHAPE_INVALID: "NAV_CONNECTION_RESPONSE_INVALID",
    GZIP_INVALID: "NAV_CONNECTION_RESPONSE_INVALID",
  };
  return codes[error.code];
}

function httpStatus(code: NavConnectionErrorCode): HttpStatus {
  if (code === "NAV_CONNECTION_RATE_LIMITED")
    return HttpStatus.TOO_MANY_REQUESTS;
  if (
    code === "NAV_CONNECTION_AUTH_REJECTED" ||
    code === "NAV_CONNECTION_API_REJECTED" ||
    code === "NAV_CREDENTIAL_INPUT_INVALID"
  )
    return HttpStatus.UNPROCESSABLE_ENTITY;
  if (
    code === "NAV_CONNECTION_NOT_CONFIGURED" ||
    code === "NAV_CONNECTION_DISABLED"
  )
    return HttpStatus.CONFLICT;
  if (
    code === "NAV_CONNECTION_CONFIGURATION_MISSING" ||
    code.startsWith("NAV_CREDENTIAL_MASTER_KEY") ||
    code.startsWith("NAV_CREDENTIAL_KEY_VERSION") ||
    code.startsWith("NAV_CREDENTIAL_DECRYPT") ||
    code.startsWith("NAV_CREDENTIAL_ENVELOPE")
  )
    return HttpStatus.SERVICE_UNAVAILABLE;
  return HttpStatus.BAD_GATEWAY;
}

function safeException(error: unknown): HttpException {
  const code = apiErrorCode(error);
  return new HttpException(code, httpStatus(code));
}

@Injectable()
export class NavConnectionService {
  constructor(
    private readonly repository: NavConnectionRepository,
    private readonly crypto: NavCredentialCryptoService,
    private readonly credentials: NavCredentialsService,
    private readonly client: NavOnlineInvoiceClient,
  ) {}

  async get(now = new Date()): Promise<NavConnectionView> {
    try {
      const setting = await this.repository.getSetting();
      if (!setting)
        throw new NavConnectionError("NAV_CONNECTION_CONFIGURATION_MISSING");
      return this.view(setting, now);
    } catch (error) {
      throw safeException(error);
    }
  }

  async replaceCredential(
    input: NavConnectionCredentialInput,
    actorUserId: string,
    now = new Date(),
  ): Promise<NavConnectionView> {
    let claimed: NavConnectionSettingRecord | null;
    try {
      claimed = await this.repository.claimCooldown("credential");
    } catch (error) {
      throw safeException(error);
    }
    if (!claimed)
      throw safeException(
        new NavConnectionError("NAV_CONNECTION_RATE_LIMITED"),
      );

    const candidate = {
      technicalUser: {
        login: input.technicalUserLogin,
        password: input.technicalUserPassword,
        taxNumber: input.technicalUserTaxNumber,
        signKey: input.technicalUserSignKey,
      },
      software: {
        softwareId: input.softwareId,
        softwareName: process.env.NAV_SOFTWARE_NAME?.trim() || "Acropora OS",
        softwareOperation: "ONLINE_SERVICE" as const,
        softwareMainVersion: process.env.NAV_SOFTWARE_VERSION?.trim() || "1.0",
        softwareDevName: input.softwareDevName,
        softwareDevContact: input.softwareDevContact,
        softwareDevCountryCode:
          process.env.NAV_SOFTWARE_DEV_COUNTRY_CODE?.trim() || "HU",
        softwareDevTaxNumber: input.softwareDevTaxNumber,
      },
    };
    try {
      await this.verify(candidate.technicalUser, candidate.software, now);
    } catch (error) {
      const code = apiErrorCode(error);
      try {
        await this.repository.auditCredentialValidationFailure(
          actorUserId,
          code,
        );
      } catch {
        throw safeException(new NavConnectionError("NAV_CONNECTION_FAILED"));
      }
      throw safeException(new NavConnectionError(code));
    }

    try {
      this.crypto.validateActiveKey();
      const revision = claimed.credentialRevision + 1;
      const envelope = this.crypto.encrypt(
        this.credentials.serialize(input),
        revision,
      );
      return this.view(
        await this.repository.replaceCredential({
          envelope,
          revision,
          actorUserId,
          verifiedAt: now,
        }),
        now,
      );
    } catch (error) {
      throw safeException(error);
    }
  }

  async testStoredCredential(
    actorUserId: string,
    now = new Date(),
  ): Promise<NavConnectionView> {
    let claimed: NavConnectionSettingRecord | null;
    try {
      claimed = await this.repository.claimCooldown("test");
    } catch (error) {
      throw safeException(error);
    }
    if (!claimed)
      throw safeException(
        new NavConnectionError("NAV_CONNECTION_RATE_LIMITED"),
      );

    let status: "SUCCESS" | "FAILED";
    let code: NavConnectionErrorCode | null;
    try {
      const resolved = this.credentials.resolveRecord(claimed);
      await this.verify(resolved.technicalUser, resolved.software, now);
      status = "SUCCESS";
      code = null;
    } catch (error) {
      status = "FAILED";
      code = apiErrorCode(error);
    }
    try {
      return this.view(
        await this.repository.recordManualTest({
          actorUserId,
          checkedAt: now,
          status,
          code,
          expectedCredentialMode: claimed.credentialMode,
          expectedCredentialRevision: claimed.credentialRevision,
        }),
        now,
      );
    } catch (error) {
      throw safeException(error);
    }
  }

  async disable(
    actorUserId: string,
    now = new Date(),
  ): Promise<NavConnectionView> {
    let claimed: NavConnectionSettingRecord | null;
    try {
      claimed = await this.repository.claimCooldown("credential");
    } catch (error) {
      throw safeException(error);
    }
    if (!claimed)
      throw safeException(
        new NavConnectionError("NAV_CONNECTION_RATE_LIMITED"),
      );
    try {
      return this.view(await this.repository.disable(actorUserId, now), now);
    } catch (error) {
      throw safeException(error);
    }
  }

  private async verify(
    technicalUser: Parameters<NavOnlineInvoiceClient["queryInvoiceDigest"]>[4],
    software: Parameters<NavOnlineInvoiceClient["queryInvoiceDigest"]>[5],
    now: Date,
  ): Promise<void> {
    await this.client.queryInvoiceDigest(
      1,
      "INBOUND",
      new Date(now.getTime() - 5 * 60_000),
      now,
      technicalUser,
      software,
    );
  }

  private view(
    setting: NavConnectionSettingRecord,
    now: Date,
  ): NavConnectionView {
    const configured =
      setting.credentialMode === "DATABASE"
        ? Boolean(
            setting.encryptedCredentials &&
            setting.encryptionIv &&
            setting.authenticationTag &&
            setting.keyVersion,
          )
        : setting.credentialMode === "ENV_FALLBACK"
          ? [
              "NAV_TECHNICAL_USER_LOGIN",
              "NAV_TECHNICAL_USER_PASSWORD",
              "NAV_TECHNICAL_USER_TAX_NUMBER",
              "NAV_TECHNICAL_USER_SIGN_KEY",
              "NAV_SOFTWARE_ID",
              "NAV_SOFTWARE_DEV_NAME",
              "NAV_SOFTWARE_DEV_CONTACT",
              "NAV_SOFTWARE_DEV_TAX_NUMBER",
            ].every((key) => Boolean(process.env[key]?.trim()))
          : false;
    const checkedAt = setting.lastVerifiedAt;
    const stale = Boolean(
      checkedAt &&
      setting.verificationStatus !== "NEVER" &&
      now.getTime() - checkedAt.getTime() > NAV_VERIFICATION_STALE_MS,
    );
    return {
      configured,
      masked: configured ? "••••••••" : null,
      modifiedAt: setting.credentialUpdatedAt?.toISOString() ?? null,
      verification: {
        status: stale ? "STALE" : setting.verificationStatus,
        checkedAt: checkedAt?.toISOString() ?? null,
        code: stale
          ? "NAV_CONNECTION_VERIFICATION_STALE"
          : isNavConnectionErrorCode(setting.lastVerificationCode)
            ? setting.lastVerificationCode
            : setting.lastVerificationCode === null
              ? null
              : "NAV_CONNECTION_FAILED",
      },
    };
  }
}
