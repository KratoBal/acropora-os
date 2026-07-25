import { BadGatewayException } from "@nestjs/common";
export type MnbApiErrorCode = "REQUEST_INVALID" | "NO_RATE_IN_RANGE" | "HTTP_4XX" | "HTTP_5XX" | "HTTP_OTHER" | "NETWORK_FAILED" | "TIMEOUT" | "XML_INVALID" | "XML_TOO_LARGE";
export declare class MnbApiError extends BadGatewayException {
    readonly code: MnbApiErrorCode;
    readonly detail?: string | undefined;
    constructor(code: MnbApiErrorCode, detail?: string | undefined);
}
export interface MnbDailyRate {
    date: string;
    rate: string;
}
export declare function parseGetExchangeRatesResponse(soapXml: string, currency: string): MnbDailyRate[];
export declare class MnbExchangeRateClient {
    private readonly logger;
    getExchangeRates(startDate: string, endDate: string, currency: string): Promise<MnbDailyRate[]>;
    protected request(input: string, init: RequestInit): Promise<Response>;
}
