var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var MnbExchangeRateClient_1;
import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { SaxesParser } from "saxes";
const DEFAULT_API_BASE_URL = "https://www.mnb.hu/arfolyamok.asmx";
const SOAP_NAMESPACE = "http://www.mnb.hu/webservices/";
const MAX_XML_BYTES = 512 * 1024;
export class MnbApiError extends BadGatewayException {
    code;
    detail;
    constructor(code, detail) {
        super(detail ? `${code}: ${detail}` : code);
        this.code = code;
        this.detail = detail;
        this.name = "MnbApiError";
    }
}
function escapeXml(input) {
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
function parseXml(xml) {
    if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES)
        throw new MnbApiError("XML_TOO_LARGE");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new MnbApiError("XML_INVALID");
    const roots = [];
    const stack = [];
    const parser = new SaxesParser({ xmlns: false });
    parser.on("opentag", (tag) => {
        const node = {
            name: tag.name,
            text: "",
            attributes: tag.attributes,
            children: [],
        };
        const parent = stack.at(-1);
        if (parent)
            parent.children.push(node);
        else
            roots.push(node);
        stack.push(node);
    });
    parser.on("text", (text) => {
        const current = stack.at(-1);
        if (current)
            current.text += text;
    });
    parser.on("closetag", () => {
        stack.pop();
    });
    try {
        parser.write(xml).close();
    }
    catch {
        throw new MnbApiError("XML_INVALID");
    }
    if (roots.length !== 1)
        throw new MnbApiError("XML_INVALID");
    return roots[0];
}
function buildGetExchangeRatesXmlSoap11(startDate, endDate, currencyNames) {
    return (`<?xml version="1.0" encoding="utf-8"?>` +
        `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
        `<soap:Body>` +
        `<GetExchangeRates xmlns="${SOAP_NAMESPACE}">` +
        `<startDate>${escapeXml(startDate)}</startDate>` +
        `<endDate>${escapeXml(endDate)}</endDate>` +
        `<currencyNames>${escapeXml(currencyNames)}</currencyNames>` +
        `</GetExchangeRates>` +
        `</soap:Body>` +
        `</soap:Envelope>`);
}
function buildGetExchangeRatesXmlSoap12(startDate, endDate, currencyNames) {
    return (`<?xml version="1.0" encoding="utf-8"?>` +
        `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
        `<soap12:Body>` +
        `<GetExchangeRates xmlns="${SOAP_NAMESPACE}">` +
        `<startDate>${escapeXml(startDate)}</startDate>` +
        `<endDate>${escapeXml(endDate)}</endDate>` +
        `<currencyNames>${escapeXml(currencyNames)}</currencyNames>` +
        `</GetExchangeRates>` +
        `</soap12:Body>` +
        `</soap12:Envelope>`);
}
export function parseGetExchangeRatesResponse(soapXml, currency) {
    const envelope = parseXml(soapXml);
    const body = envelope.children.find((node) => node.name.endsWith("Body")) ?? envelope;
    const resultElement = body.children
        .find((node) => node.name.endsWith("GetExchangeRatesResponse"))
        ?.children.find((node) => node.name.endsWith("GetExchangeRatesResult"));
    const innerXml = resultElement?.text.trim();
    if (!innerXml)
        return [];
    const inner = parseXml(innerXml);
    const days = inner.children.filter((node) => node.name === "Day");
    const rates = [];
    for (const day of days) {
        const date = day.attributes.date;
        if (!date)
            continue;
        const rateNode = day.children.find((node) => node.name === "Rate" && node.attributes.curr === currency);
        if (!rateNode)
            continue;
        const unit = Number(rateNode.attributes.unit ?? "1") || 1;
        const rawValue = Number(rateNode.text.trim().replace(",", "."));
        if (!Number.isFinite(rawValue))
            continue;
        rates.push({ date, rate: (rawValue / unit).toString() });
    }
    return rates;
}
let MnbExchangeRateClient = MnbExchangeRateClient_1 = class MnbExchangeRateClient {
    logger = new Logger(MnbExchangeRateClient_1.name);
    async getExchangeRates(startDate, endDate, currency) {
        const baseUrl = (process.env.MNB_API_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
        const attempts = [
            {
                label: "SOAP 1.1",
                body: buildGetExchangeRatesXmlSoap11(startDate, endDate, currency),
                headers: {
                    "content-type": "text/xml; charset=utf-8",
                    soapaction: `"${SOAP_NAMESPACE}GetExchangeRates"`,
                },
            },
            {
                label: "SOAP 1.2",
                body: buildGetExchangeRatesXmlSoap12(startDate, endDate, currency),
                headers: {
                    "content-type": `application/soap+xml; charset=utf-8; action="${SOAP_NAMESPACE}GetExchangeRates"`,
                },
            },
        ];
        let lastError;
        for (const [index, attempt] of attempts.entries()) {
            const isLastAttempt = index === attempts.length - 1;
            let responseText;
            let status;
            try {
                const response = await this.request(baseUrl, {
                    method: "POST",
                    headers: attempt.headers,
                    body: attempt.body,
                    signal: AbortSignal.timeout(15_000),
                });
                status = response.status;
                responseText = await response.text();
            }
            catch (error) {
                const code = error instanceof Error &&
                    (error.name === "TimeoutError" || error.name === "AbortError")
                    ? "TIMEOUT"
                    : "NETWORK_FAILED";
                if (isLastAttempt)
                    throw new MnbApiError(code);
                lastError = new MnbApiError(code);
                continue;
            }
            if (status >= 400) {
                this.logger.warn(`MNB GetExchangeRates (${attempt.label}) elutasítva (HTTP ${status}): ${responseText.slice(0, 2000)}`);
                const code = status >= 400 && status < 500
                    ? "HTTP_4XX"
                    : status >= 500
                        ? "HTTP_5XX"
                        : "HTTP_OTHER";
                if (isLastAttempt)
                    throw new MnbApiError(code);
                lastError = new MnbApiError(code);
                continue;
            }
            return parseGetExchangeRatesResponse(responseText, currency);
        }
        throw lastError ?? new MnbApiError("HTTP_OTHER");
    }
    request(input, init) {
        return fetch(input, init);
    }
};
MnbExchangeRateClient = MnbExchangeRateClient_1 = __decorate([
    Injectable()
], MnbExchangeRateClient);
export { MnbExchangeRateClient };
//# sourceMappingURL=mnb-exchange-rate.client.js.map