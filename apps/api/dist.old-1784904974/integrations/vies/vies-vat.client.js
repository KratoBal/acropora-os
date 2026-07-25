var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ViesVatClient_1;
import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
const DEFAULT_API_BASE_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const PLACEHOLDER_VALUES = new Set(["---", "-"]);
export class ViesApiError extends BadGatewayException {
    code;
    detail;
    constructor(code, detail) {
        super(detail ? `${code}: ${detail}` : code);
        this.code = code;
        this.detail = detail;
        this.name = "ViesApiError";
    }
}
const FAULT_TO_CODE = {
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
function cleanValue(value) {
    const trimmed = value?.trim();
    if (!trimmed || PLACEHOLDER_VALUES.has(trimmed))
        return undefined;
    return trimmed;
}
export function parseViesResponseBody(responseText) {
    let body;
    try {
        body = JSON.parse(responseText);
    }
    catch {
        throw new ViesApiError("RESPONSE_INVALID");
    }
    const faultCode = body.userError ?? body.errorWrappers?.[0]?.error;
    if (faultCode)
        throw new ViesApiError(FAULT_TO_CODE[faultCode] ?? "SERVICE_UNAVAILABLE", faultCode);
    if (typeof body.valid !== "boolean")
        throw new ViesApiError("RESPONSE_INVALID");
    return {
        valid: body.valid,
        name: cleanValue(body.name),
        address: cleanValue(body.address),
        requestDate: body.requestDate,
    };
}
let ViesVatClient = ViesVatClient_1 = class ViesVatClient {
    logger = new Logger(ViesVatClient_1.name);
    async checkVat(countryCode, vatNumber) {
        const url = process.env.VIES_API_URL ?? DEFAULT_API_BASE_URL;
        let status;
        let responseText;
        try {
            const response = await this.request(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ countryCode, vatNumber }),
                signal: AbortSignal.timeout(10_000),
            });
            status = response.status;
            responseText = await response.text();
        }
        catch (error) {
            const code = error instanceof Error &&
                (error.name === "TimeoutError" || error.name === "AbortError")
                ? "TIMEOUT"
                : "NETWORK_FAILED";
            throw new ViesApiError(code);
        }
        if (status >= 400) {
            this.logger.warn(`VIES check-vat-number elutasítva (HTTP ${status}): ${responseText.slice(0, 2000)}`);
            throw new ViesApiError(status < 500 ? "HTTP_4XX" : "HTTP_5XX");
        }
        try {
            return parseViesResponseBody(responseText);
        }
        catch (error) {
            if (error instanceof ViesApiError && error.code === "RESPONSE_INVALID")
                this.logger.warn(`VIES check-vat-number válasz nem dolgozható fel: ${responseText.slice(0, 2000)}`);
            throw error;
        }
    }
    request(input, init) {
        return fetch(input, init);
    }
};
ViesVatClient = ViesVatClient_1 = __decorate([
    Injectable()
], ViesVatClient);
export { ViesVatClient };
//# sourceMappingURL=vies-vat.client.js.map