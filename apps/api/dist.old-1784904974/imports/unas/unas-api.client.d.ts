import { BadGatewayException } from "@nestjs/common";
import type { UnasApiCategory, UnasApiCustomer, UnasApiOrder, UnasApiProduct } from "@acropora/types";
export interface UnasProductPageRequest {
    timeStart?: number;
    timeEnd?: number;
    limitStart: number;
    limitNum: number;
    state?: "live" | "deleted";
    contentType?: "minimal" | "short" | "normal" | "full";
}
export interface UnasCategoryPageRequest {
    timeStart?: number;
    timeEnd?: number;
    limitStart: number;
    limitNum: number;
    contentType?: "minimal" | "normal" | "full";
}
export interface UnasGetOrderRequest {
    timeModStart?: number;
    timeModEnd?: number;
    limitStart: number;
    limitNum: number;
}
export interface UnasGetCustomerRequest {
    modTimeStart?: number;
    modTimeEnd?: number;
    limitStart: number;
    limitNum: number;
}
export interface UnasSetStockRequest {
    sku: string;
    qty: string;
    comment?: string;
}
export interface UnasSetStockResult {
    externalId: string | null;
    sku: string;
}
export interface UnasLoginResult {
    token: string;
    expireTime: number;
    permissions?: readonly string[] | null;
}
export type UnasApiErrorCode = "AUTH_REJECTED" | "RATE_LIMITED" | "HTTP_4XX" | "HTTP_5XX" | "HTTP_OTHER" | "NETWORK_FAILED" | "TIMEOUT" | "API_REJECTED" | "XML_INVALID" | "XML_TOO_LARGE" | "XML_FORBIDDEN" | "RESPONSE_SHAPE_INVALID" | "FIELD_FORMAT_INVALID" | "REQUEST_INVALID";
export declare class UnasApiError extends BadGatewayException {
    readonly code: UnasApiErrorCode;
    constructor(code: UnasApiErrorCode);
}
export declare function unasRetryDelayMs(attempt: number, retryAfter: string | null, random?: () => number): number;
export declare function parseUnasProductResponse(xml: string): UnasApiProduct[];
export declare function buildUnasProductPageXml(request: UnasProductPageRequest): string;
export declare function buildUnasCategoryPageXml(request: UnasCategoryPageRequest): string;
export declare function buildUnasGetOrderXml(request: UnasGetOrderRequest): string;
export declare function parseUnasOrderResponse(xml: string): UnasApiOrder[];
export declare function buildUnasGetCustomerXml(request: UnasGetCustomerRequest): string;
export declare function parseUnasCustomerResponse(xml: string): UnasApiCustomer[];
export declare function buildUnasSetStockXml(request: UnasSetStockRequest): string;
export declare function parseUnasSetStockResponse(xml: string): UnasSetStockResult;
export declare function parseUnasCategoryResponse(xml: string): UnasApiCategory[];
export declare class UnasApiClient {
    login(apiKey: string): Promise<UnasLoginResult>;
    getProductPage(token: string, request: UnasProductPageRequest): Promise<UnasApiProduct[]>;
    getCategoryPage(token: string, request: UnasCategoryPageRequest): Promise<UnasApiCategory[]>;
    getOrderPage(token: string, request: UnasGetOrderRequest): Promise<UnasApiOrder[]>;
    getCustomerPage(token: string, request: UnasGetCustomerRequest): Promise<UnasApiCustomer[]>;
    setStock(token: string, request: UnasSetStockRequest): Promise<UnasSetStockResult>;
    private post;
    protected wait(milliseconds: number): Promise<void>;
    protected request(input: string, init: RequestInit): Promise<Response>;
}
