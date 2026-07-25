import { BadGatewayException } from "@nestjs/common";
export type ViesApiErrorCode = "VAT_NUMBER_INVALID" | "MS_UNAVAILABLE" | "SERVICE_UNAVAILABLE" | "HTTP_4XX" | "HTTP_5XX" | "HTTP_OTHER" | "NETWORK_FAILED" | "TIMEOUT" | "RESPONSE_INVALID";
export declare class ViesApiError extends BadGatewayException {
    readonly code: ViesApiErrorCode;
    readonly detail?: string | undefined;
    constructor(code: ViesApiErrorCode, detail?: string | undefined);
}
export interface ViesVatCheckResult {
    valid: boolean;
    name?: string;
    address?: string;
    requestDate?: string;
}
export declare function parseViesResponseBody(responseText: string): ViesVatCheckResult;
export declare class ViesVatClient {
    private readonly logger;
    checkVat(countryCode: string, vatNumber: string): Promise<ViesVatCheckResult>;
    protected request(input: string, init: RequestInit): Promise<Response>;
}
