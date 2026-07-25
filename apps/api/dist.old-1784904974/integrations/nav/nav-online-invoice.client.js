var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var NavOnlineInvoiceClient_1;
import { Injectable, Logger } from "@nestjs/common";
import { buildEnvelopeXml, child, children, errorMessageFromResponse, escapeXml, NavApiError, parseXml, value, } from "./nav-xml.util.js";
export { NavApiError, } from "./nav-xml.util.js";
const DEFAULT_API_BASE_URL = "https://api.onlineszamla.nav.gov.hu/invoiceService/v3";
function addressFromNode(node) {
    if (!node)
        return null;
    const postalCode = value(node, "postalCode");
    const city = value(node, "city");
    if (!postalCode || !city)
        return null;
    const streetName = value(node, "streetName");
    const publicPlaceCategory = value(node, "publicPlaceCategory");
    const houseNumber = value(node, "number");
    const line1 = [streetName, publicPlaceCategory, houseNumber].filter(Boolean).join(" ") ||
        city;
    return {
        postalCode,
        city,
        line1,
        country: value(node, "countryCode") ?? "HU",
    };
}
function buildQueryTaxpayerXml(targetTaxNumber, user, software, now) {
    const body = `<taxNumber>${escapeXml(targetTaxNumber)}</taxNumber>`;
    return buildEnvelopeXml("QueryTaxpayerRequest", body, user, software, now);
}
function parseQueryTaxpayerResponse(xml) {
    const root = parseXml(xml);
    if (root.name === "GeneralExceptionResponse" ||
        root.name === "GeneralErrorResponse")
        throw new NavApiError("API_REJECTED", errorMessageFromResponse(root));
    if (root.name !== "QueryTaxpayerResponse")
        throw new NavApiError("RESPONSE_SHAPE_INVALID");
    const result = child(root, "result");
    const funcCode = result ? value(result, "funcCode") : undefined;
    if (funcCode && funcCode !== "OK") {
        const message = value(result, "message") ?? value(result, "errorCode");
        throw new NavApiError("API_REJECTED", message);
    }
    const validity = value(root, "taxpayerValidity");
    if (validity !== "true")
        return { valid: false, data: null };
    const taxpayerData = child(root, "taxpayerData");
    if (!taxpayerData)
        return { valid: true, data: null };
    const name = value(taxpayerData, "taxpayerName") ?? "";
    const detail = child(taxpayerData, "taxNumberDetail");
    const taxpayerId = detail ? value(detail, "taxpayerId") : undefined;
    const vatCode = detail ? value(detail, "vatCode") : undefined;
    const countyCode = detail ? value(detail, "countyCode") : undefined;
    const taxNumber = taxpayerId && vatCode && countyCode
        ? `${taxpayerId}-${vatCode}-${countyCode}`
        : (taxpayerId ?? "");
    const addressList = child(taxpayerData, "taxpayerAddressList");
    const items = children(addressList, "taxpayerAddressItem");
    const headquarters = items.find((item) => value(item, "taxpayerAddressType") === "HQ") ??
        items[0];
    const address = headquarters
        ? addressFromNode(child(headquarters, "taxpayerAddress"))
        : null;
    return { valid: true, data: { name, taxNumber, address } };
}
function buildQueryInvoiceDigestXml(page, direction, insDateFrom, insDateTo, user, software, now) {
    const body = `<page>${page}</page>` +
        `<invoiceDirection>${direction}</invoiceDirection>` +
        `<invoiceQueryParams>` +
        `<mandatoryQueryParams>` +
        `<insDate>` +
        `<dateTimeFrom>${insDateFrom.toISOString()}</dateTimeFrom>` +
        `<dateTimeTo>${insDateTo.toISOString()}</dateTimeTo>` +
        `</insDate>` +
        `</mandatoryQueryParams>` +
        `</invoiceQueryParams>`;
    return buildEnvelopeXml("QueryInvoiceDigestRequest", body, user, software, now);
}
export function parseQueryInvoiceDigestResponse(xml) {
    const root = parseXml(xml);
    if (root.name === "GeneralExceptionResponse" ||
        root.name === "GeneralErrorResponse")
        throw new NavApiError("API_REJECTED", errorMessageFromResponse(root));
    if (root.name !== "QueryInvoiceDigestResponse")
        throw new NavApiError("RESPONSE_SHAPE_INVALID");
    const result = child(root, "result");
    const funcCode = result ? value(result, "funcCode") : undefined;
    if (funcCode && funcCode !== "OK") {
        const message = value(result, "message") ?? value(result, "errorCode");
        throw new NavApiError("API_REJECTED", message);
    }
    const digestResult = child(root, "invoiceDigestResult");
    const currentPage = Number(value(digestResult, "currentPage") ?? "1");
    const availablePage = Number(value(digestResult, "availablePage") ?? "1");
    const items = children(digestResult, "invoiceDigest")
        .map((node) => {
        const invoiceNumber = value(node, "invoiceNumber");
        const invoiceIssueDate = value(node, "invoiceIssueDate");
        const insDate = value(node, "insDate");
        if (!invoiceNumber || !invoiceIssueDate || !insDate)
            return null;
        return {
            invoiceNumber,
            invoiceOperation: value(node, "invoiceOperation") ?? "CREATE",
            invoiceIssueDate,
            invoiceDeliveryDate: value(node, "invoiceDeliveryDate"),
            paymentDate: value(node, "paymentDate"),
            supplierTaxNumber: value(node, "supplierTaxNumber"),
            supplierName: value(node, "supplierName"),
            currency: value(node, "currency"),
            invoiceNetAmount: value(node, "invoiceNetAmount"),
            invoiceVatAmount: value(node, "invoiceVatAmount"),
            insDate,
        };
    })
        .filter((item) => item !== null);
    return { currentPage, availablePage, items };
}
function buildQueryInvoiceDataXml(invoiceNumber, direction, supplierTaxNumber, user, software, now) {
    const body = `<invoiceNumberQuery>` +
        `<invoiceNumber>${escapeXml(invoiceNumber)}</invoiceNumber>` +
        `<invoiceDirection>${direction}</invoiceDirection>` +
        (direction === "INBOUND" && supplierTaxNumber
            ? `<supplierTaxNumber>${escapeXml(supplierTaxNumber)}</supplierTaxNumber>`
            : "") +
        `</invoiceNumberQuery>`;
    return buildEnvelopeXml("QueryInvoiceDataRequest", body, user, software, now);
}
export function parseQueryInvoiceDataResponse(xml) {
    const root = parseXml(xml);
    if (root.name === "GeneralExceptionResponse" ||
        root.name === "GeneralErrorResponse")
        throw new NavApiError("API_REJECTED", errorMessageFromResponse(root));
    if (root.name !== "QueryInvoiceDataResponse")
        throw new NavApiError("RESPONSE_SHAPE_INVALID");
    const result = child(root, "result");
    const funcCode = result ? value(result, "funcCode") : undefined;
    if (funcCode && funcCode !== "OK") {
        const message = value(result, "message") ?? value(result, "errorCode");
        throw new NavApiError("API_REJECTED", message);
    }
    const dataResult = child(root, "invoiceDataResult");
    const invoiceDataBase64 = value(dataResult, "invoiceData");
    const compressed = value(dataResult, "compressedContentIndicator") === "true";
    return { invoiceDataBase64, compressed };
}
let NavOnlineInvoiceClient = NavOnlineInvoiceClient_1 = class NavOnlineInvoiceClient {
    logger = new Logger(NavOnlineInvoiceClient_1.name);
    async queryTaxpayer(targetTaxNumber, user, software) {
        return this.call("/queryTaxpayer", buildQueryTaxpayerXml(targetTaxNumber, user, software, new Date()), parseQueryTaxpayerResponse);
    }
    async queryInvoiceDigest(page, direction, insDateFrom, insDateTo, user, software) {
        return this.call("/queryInvoiceDigest", buildQueryInvoiceDigestXml(page, direction, insDateFrom, insDateTo, user, software, new Date()), parseQueryInvoiceDigestResponse);
    }
    async queryInvoiceData(invoiceNumber, direction, supplierTaxNumber, user, software) {
        return this.call("/queryInvoiceData", buildQueryInvoiceDataXml(invoiceNumber, direction, supplierTaxNumber, user, software, new Date()), parseQueryInvoiceDataResponse);
    }
    async call(path, body, parse) {
        const baseUrl = (process.env.NAV_API_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
        let responseText;
        let status;
        try {
            const response = await this.request(`${baseUrl}${path}`, {
                method: "POST",
                headers: { "content-type": "application/xml; charset=utf-8" },
                body,
                signal: AbortSignal.timeout(20_000),
            });
            status = response.status;
            responseText = await response.text();
        }
        catch (error) {
            throw new NavApiError(error instanceof Error &&
                (error.name === "TimeoutError" || error.name === "AbortError")
                ? "TIMEOUT"
                : "NETWORK_FAILED");
        }
        try {
            return parse(responseText);
        }
        catch (error) {
            this.logger.warn(`NAV ${path} rejected (HTTP ${status}): ${responseText}`);
            if (error instanceof NavApiError && error.code === "API_REJECTED")
                throw error;
            if (status >= 200 && status < 300)
                throw error;
            if (status === 401 || status === 403)
                throw new NavApiError("AUTH_REJECTED");
            if (status >= 400 && status < 500)
                throw new NavApiError("HTTP_4XX");
            if (status >= 500)
                throw new NavApiError("HTTP_5XX");
            throw new NavApiError("HTTP_OTHER");
        }
    }
    request(input, init) {
        return fetch(input, init);
    }
};
NavOnlineInvoiceClient = NavOnlineInvoiceClient_1 = __decorate([
    Injectable()
], NavOnlineInvoiceClient);
export { NavOnlineInvoiceClient };
//# sourceMappingURL=nav-online-invoice.client.js.map