import { BadGatewayException } from "@nestjs/common";
export declare const MAX_XML_BYTES: number;
export declare const REQUEST_VERSION = "3.0";
export declare const HEADER_VERSION = "1.0";
export declare const API_NS = "http://schemas.nav.gov.hu/OSA/3.0/api";
export declare const COMMON_NS = "http://schemas.nav.gov.hu/NTCA/1.0/common";
export interface NavTechnicalUser {
    login: string;
    password: string;
    taxNumber: string;
    signKey: string;
}
export interface NavSoftwareData {
    softwareId: string;
    softwareName: string;
    softwareOperation: "LOCAL_SOFTWARE" | "ONLINE_SERVICE";
    softwareMainVersion: string;
    softwareDevName: string;
    softwareDevContact: string;
    softwareDevCountryCode: string;
    softwareDevTaxNumber: string;
}
export type NavApiErrorCode = "NOT_CONFIGURED" | "REQUEST_INVALID" | "AUTH_REJECTED" | "API_REJECTED" | "HTTP_4XX" | "HTTP_5XX" | "HTTP_OTHER" | "NETWORK_FAILED" | "TIMEOUT" | "XML_INVALID" | "XML_TOO_LARGE" | "RESPONSE_SHAPE_INVALID" | "GZIP_INVALID";
export declare class NavApiError extends BadGatewayException {
    readonly code: NavApiErrorCode;
    readonly detail?: string | undefined;
    constructor(code: NavApiErrorCode, detail?: string | undefined);
}
export interface XmlNode {
    name: string;
    text: string;
    children: XmlNode[];
}
export declare const child: (node: XmlNode | undefined, name: string) => XmlNode | undefined;
export declare const children: (node: XmlNode | undefined, name: string) => XmlNode[];
export declare const value: (node: XmlNode | undefined, name: string) => string | undefined;
export declare function escapeXml(input: string): string;
export declare function stripNamespacePrefixes(xml: string): string;
export declare function parseXml(xml: string): XmlNode;
export declare function decodeInvoiceDataXml(base64Data: string, compressed: boolean): XmlNode;
export declare function requestId(): string;
export declare function compactTimestamp(date: Date): string;
export declare function requestSignature(id: string, timestamp: string, signKey: string): string;
export declare function passwordHash(password: string): string;
export declare function buildEnvelopeXml(rootName: string, bodyXml: string, user: NavTechnicalUser, software: NavSoftwareData, now: Date): string;
export declare function errorMessageFromResponse(root: XmlNode): string;
