import { BadGatewayException } from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { SaxesParser } from "saxes";
export const MAX_XML_BYTES = 2 * 1024 * 1024;
export const REQUEST_VERSION = "3.0";
export const HEADER_VERSION = "1.0";
export const API_NS = "http://schemas.nav.gov.hu/OSA/3.0/api";
export const COMMON_NS = "http://schemas.nav.gov.hu/NTCA/1.0/common";
export class NavApiError extends BadGatewayException {
    code;
    detail;
    constructor(code, detail) {
        super(detail ? `${code}: ${detail}` : code);
        this.code = code;
        this.detail = detail;
        this.name = "NavApiError";
    }
}
export const child = (node, name) => node?.children.find((item) => item.name === name);
export const children = (node, name) => node?.children.filter((item) => item.name === name) ?? [];
export const value = (node, name) => child(node, name)?.text.trim();
export function escapeXml(input) {
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
export function stripNamespacePrefixes(xml) {
    return xml.replace(/<\/?ns\d+:/g, (match) => match.startsWith("</") ? "</" : "<");
}
export function parseXml(xml) {
    if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES)
        throw new NavApiError("XML_TOO_LARGE");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new NavApiError("XML_INVALID");
    const roots = [];
    const stack = [];
    const parser = new SaxesParser({ xmlns: false });
    parser.on("opentag", (tag) => {
        const node = { name: tag.name, text: "", children: [] };
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
        parser.write(stripNamespacePrefixes(xml)).close();
    }
    catch {
        throw new NavApiError("XML_INVALID");
    }
    if (roots.length !== 1)
        throw new NavApiError("XML_INVALID");
    return roots[0];
}
export function decodeInvoiceDataXml(base64Data, compressed) {
    let bytes;
    try {
        bytes = Buffer.from(base64Data, "base64");
        if (compressed)
            bytes = gunzipSync(bytes);
    }
    catch {
        throw new NavApiError("GZIP_INVALID");
    }
    return parseXml(bytes.toString("utf8"));
}
export function requestId() {
    return `RID${randomBytes(9).toString("hex")}`;
}
export function compactTimestamp(date) {
    return date.toISOString().split(".")[0].replace(/[-:T]/g, "");
}
export function requestSignature(id, timestamp, signKey) {
    return createHash("sha3-512")
        .update(`${id}${timestamp}${signKey}`)
        .digest("hex")
        .toUpperCase();
}
export function passwordHash(password) {
    return createHash("sha512").update(password).digest("hex").toUpperCase();
}
export function buildEnvelopeXml(rootName, bodyXml, user, software, now) {
    const id = requestId();
    const timestamp = now.toISOString();
    const signature = requestSignature(id, compactTimestamp(now), user.signKey);
    return (`<?xml version="1.0" encoding="UTF-8"?>` +
        `<${rootName} xmlns:common="${COMMON_NS}" xmlns="${API_NS}">` +
        `<common:header>` +
        `<common:requestId>${escapeXml(id)}</common:requestId>` +
        `<common:timestamp>${timestamp}</common:timestamp>` +
        `<common:requestVersion>${REQUEST_VERSION}</common:requestVersion>` +
        `<common:headerVersion>${HEADER_VERSION}</common:headerVersion>` +
        `</common:header>` +
        `<common:user>` +
        `<common:login>${escapeXml(user.login)}</common:login>` +
        `<common:passwordHash cryptoType="SHA-512">${passwordHash(user.password)}</common:passwordHash>` +
        `<common:taxNumber>${escapeXml(user.taxNumber)}</common:taxNumber>` +
        `<common:requestSignature cryptoType="SHA3-512">${signature}</common:requestSignature>` +
        `</common:user>` +
        `<software>` +
        `<softwareId>${escapeXml(software.softwareId)}</softwareId>` +
        `<softwareName>${escapeXml(software.softwareName)}</softwareName>` +
        `<softwareOperation>${software.softwareOperation}</softwareOperation>` +
        `<softwareMainVersion>${escapeXml(software.softwareMainVersion)}</softwareMainVersion>` +
        `<softwareDevName>${escapeXml(software.softwareDevName)}</softwareDevName>` +
        `<softwareDevContact>${escapeXml(software.softwareDevContact)}</softwareDevContact>` +
        `<softwareDevCountryCode>${escapeXml(software.softwareDevCountryCode)}</softwareDevCountryCode>` +
        `<softwareDevTaxNumber>${escapeXml(software.softwareDevTaxNumber)}</softwareDevTaxNumber>` +
        `</software>` +
        bodyXml +
        `</${rootName}>`);
}
export function errorMessageFromResponse(root) {
    if (root.name === "GeneralExceptionResponse")
        return value(root, "message") ?? value(root, "errorCode") ?? root.name;
    const result = child(root, "result");
    const resultMessage = result ? value(result, "message") : undefined;
    const resultErrorCode = result ? value(result, "errorCode") : undefined;
    const technicalDetails = children(root, "technicalValidationMessages")
        .map((node) => value(node, "message") ?? value(node, "validationErrorCode"))
        .filter((item) => Boolean(item));
    const parts = [resultMessage ?? resultErrorCode, ...technicalDetails].filter((item) => Boolean(item));
    return parts.length > 0 ? parts.join(" | ") : root.name;
}
//# sourceMappingURL=nav-xml.util.js.map