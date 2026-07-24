import { BadGatewayException, Injectable, Logger } from "@nestjs/common";

// Az Európai Bizottság hivatalos, hitelesítés nélküli VIES REST
// szolgáltatása. Dokumentáció: https://ec.europa.eu/taxation_customs/vies/#/technical-information
const DEFAULT_API_BASE_URL =
  "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const PLACEHOLDER_VALUES = new Set(["---", "-"]);

export type ViesApiErrorCode =
  | "VAT_NUMBER_INVALID"
  | "MS_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "HTTP_OTHER"
  | "NETWORK_FAILED"
  | "TIMEOUT"
  | "RESPONSE_INVALID";

export class ViesApiError extends BadGatewayException {
  constructor(
    readonly code: ViesApiErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ViesApiError";
  }
}

export interface ViesVatCheckResult {
  valid: boolean;
  name?: string;
  address?: string;
  requestDate?: string;
}

interface ViesApiResponseBody {
  countryCode?: string;
  vatNumber?: string;
  requestDate?: string;
  valid?: boolean;
  name?: string;
  address?: string;
  // A teszt-végpont dokumentációja és a mezőnevek publikusan ismert
  // eltérései miatt több lehetséges hiba-mezőnevet is figyelembe veszünk;
  // a tényleges élesalkalmazás pontos hibaformátuma nem hivatalosan
  // dokumentált.
  userError?: string;
  errorWrappers?: Array<{ error?: string; message?: string }>;
}

// A VIES teszt-szolgáltatásának dokumentált hibakódjai (lásd
// https://ec.europa.eu/taxation_customs/vies/#/technical-information),
// Magyarul is olvasható üzenetre fordítva a service rétegben - itt csak a
// technikai kategorizálás történik.
const FAULT_TO_CODE: Record<string, ViesApiErrorCode> = {
  INVALID_INPUT: "VAT_NUMBER_INVALID",
  INVALID_REQUESTER_INFO: "VAT_NUMBER_INVALID",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  MS_UNAVAILABLE: "MS_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  VAT_BLOCKED: "SERVICE_UNAVAILABLE",
  IP_BLOCKED: "SERVICE_UNAVAILABLE",
  GLOBAL_MAX_CONCURRENT_REQ: "SERVICE_UNAVAILABLE",
  GLOBAL_MAX_CONCURRENT_REQ_TIME: "SERVICE_UNAVAILABLE",
  MS_MAX_CONCURRENT_REQ: "MS_UNAVAILABLE",
  MS_MAX_CONCURRENT_REQ_TIME: "MS_UNAVAILABLE",
};

function cleanValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || PLACEHOLDER_VALUES.has(trimmed)) return undefined;
  return trimmed;
}

export function parseViesResponseBody(
  responseText: string,
): ViesVatCheckResult {
  let body: ViesApiResponseBody;
  try {
    body = JSON.parse(responseText) as ViesApiResponseBody;
  } catch {
    throw new ViesApiError("RESPONSE_INVALID");
  }
  const faultCode = body.userError ?? body.errorWrappers?.[0]?.error;
  if (faultCode)
    throw new ViesApiError(
      FAULT_TO_CODE[faultCode] ?? "SERVICE_UNAVAILABLE",
      faultCode,
    );
  if (typeof body.valid !== "boolean")
    throw new ViesApiError("RESPONSE_INVALID");
  return {
    valid: body.valid,
    name: cleanValue(body.name),
    address: cleanValue(body.address),
    requestDate: body.requestDate,
  };
}

@Injectable()
export class ViesVatClient {
  private readonly logger = new Logger(ViesVatClient.name);

  /// countryCode: kétbetűs ISO/VIES-előtag (pl. "DE"); vatNumber: az
  /// országkód nélküli szám/karaktersor rész.
  async checkVat(
    countryCode: string,
    vatNumber: string,
  ): Promise<ViesVatCheckResult> {
    const url = process.env.VIES_API_URL ?? DEFAULT_API_BASE_URL;
    let status: number;
    let responseText: string;
    try {
      const response = await this.request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ countryCode, vatNumber }),
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
      responseText = await response.text();
    } catch (error) {
      const code =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
          ? "TIMEOUT"
          : "NETWORK_FAILED";
      throw new ViesApiError(code);
    }
    if (status >= 400) {
      // A nyers választ csak szerveroldalon naplózzuk, sosem küldjük a
      // böngészőnek - ugyanaz a konvenció, mint az MNB és a NAV klienseknél.
      this.logger.warn(
        `VIES check-vat-number elutasítva (HTTP ${status}): ${responseText.slice(0, 2000)}`,
      );
      throw new ViesApiError(status < 500 ? "HTTP_4XX" : "HTTP_5XX");
    }
    try {
      return parseViesResponseBody(responseText);
    } catch (error) {
      if (error instanceof ViesApiError && error.code === "RESPONSE_INVALID")
        this.logger.warn(
          `VIES check-vat-number válasz nem dolgozható fel: ${responseText.slice(0, 2000)}`,
        );
      throw error;
    }
  }

  protected request(input: string, init: RequestInit) {
    return fetch(input, init);
  }
}
