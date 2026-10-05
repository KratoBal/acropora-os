import { Injectable } from "@nestjs/common";
import {
  compactTimestamp,
  escapeXml,
  passwordHash,
  requestId,
  requestSignature,
} from "../integrations/nav/nav-xml.util.js";
import type { ResolvedNavCredentials } from "../integrations/nav/nav-credentials.service.js";
import { archivePayload } from "./opg-archive.js";
import {
  element,
  elements,
  text,
  parseOpgXml,
  unsignedInteger,
  OpgError,
  SOAP_NS,
  OPG_API_NS,
  XOP_NS,
} from "./opg-xml.js";
const COMMON = "http://schemas.nav.gov.hu/NTCA/1.0/common";
const BASE =
  "https://api-onlinepenztargep.nav.gov.hu/queryCashRegisterFile/v1/";
export interface RegisterStatus {
  apNumber: string;
  min: number;
  max: number;
}
export interface OpgFile {
  apNumber: string;
  number: number;
  name: string;
  validation: string;
  xml: Buffer;
}
export interface FilePage {
  files: OpgFile[];
  allFilesSent: boolean;
  reason?: string;
  min: number;
  max: number;
}
export function opgEnvelope(
  operation: "Status" | "FileData",
  credentials: ResolvedNavCredentials,
  body: string,
): string {
  const id = requestId(),
    now = new Date(),
    timestamp = now.toISOString(),
    user = credentials.technicalUser;
  return `<s:Envelope xmlns:s="${SOAP_NS}" xmlns:api="${OPG_API_NS}" xmlns:com="${COMMON}"><s:Header/><s:Body><api:QueryCashRegister${operation}Request><com:header><com:requestId>${id}</com:requestId><com:timestamp>${timestamp}</com:timestamp><com:requestVersion>1.0</com:requestVersion><com:headerVersion>1.0</com:headerVersion></com:header><com:user><com:login>${escapeXml(user.login)}</com:login><com:passwordHash cryptoType="SHA-512">${passwordHash(user.password)}</com:passwordHash><com:taxNumber>${escapeXml(user.taxNumber)}</com:taxNumber><com:requestSignature cryptoType="SHA3-512">${requestSignature(id, compactTimestamp(now), user.signKey)}</com:requestSignature></com:user><api:software>${Object.entries(
    credentials.software,
  )
    .map(([key, value]) => `<api:${key}>${escapeXml(value)}</api:${key}>`)
    .join(
      "",
    )}</api:software>${body}</api:QueryCashRegister${operation}Request></s:Body></s:Envelope>`;
}
/** Binary-safe MIME splitting, no prefix assumptions and no content logging. */
export function soapParts(
  buffer: Buffer,
  contentType: string,
): { xml: string; attachments: Map<string, Buffer> } {
  const attachments = new Map<string, Buffer>();
  if (!/^multipart\//i.test(contentType))
    return { xml: buffer.toString("utf8"), attachments };
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const value = boundary?.[1] ?? boundary?.[2];
  if (!value || value.length > 200) throw new OpgError("OPG_MIME_INVALID");
  const delimiter = Buffer.from(`--${value}`);
  let pos = buffer.indexOf(delimiter),
    xml: string | undefined;
  while (pos >= 0) {
    const start = pos + delimiter.length;
    if (buffer.subarray(start, start + 2).toString() === "--") break;
    if (buffer.subarray(start, start + 2).toString() !== "\r\n")
      throw new OpgError("OPG_MIME_INVALID");
    const headerEnd = buffer.indexOf("\r\n\r\n", start + 2),
      next = buffer.indexOf(Buffer.from(`\r\n--${value}`), headerEnd + 4);
    if (headerEnd < 0 || headerEnd - start > 16384 || next < 0)
      throw new OpgError("OPG_MIME_INVALID");
    const headers = buffer.subarray(start + 2, headerEnd).toString("ascii");
    let data = buffer.subarray(headerEnd + 4, next);
    const encoding = /^content-transfer-encoding:\s*(\S+)/im
      .exec(headers)?.[1]
      ?.toLowerCase();
    if (encoding === "base64")
      data = Buffer.from(data.toString("ascii"), "base64");
    else if (encoding && !["binary", "8bit"].includes(encoding))
      throw new OpgError("OPG_MIME_INVALID");
    if (xml === undefined) xml = data.toString("utf8");
    else {
      const cid = /^content-id:\s*<?([^>\r\n]+)>?/im.exec(headers)?.[1];
      if (!cid) throw new OpgError("OPG_MIME_INVALID");
      let key: string;
      try {
        key = decodeURIComponent(cid.trim());
      } catch {
        throw new OpgError("OPG_MIME_INVALID");
      }
      if (attachments.has(key)) throw new OpgError("OPG_MIME_INVALID");
      attachments.set(key, data);
    }
    pos = next + 2;
  }
  if (xml === undefined) throw new OpgError("OPG_MIME_INVALID");
  return { xml, attachments };
}
@Injectable()
export class OpgClient {
  constructor(private readonly transport: typeof fetch = fetch) {}
  private async request(
    operation: "Status" | "FileData",
    credentials: ResolvedNavCredentials,
    body: string,
  ) {
    const action =
      operation === "Status"
        ? "queryCashRegisterStatus"
        : "queryCashRegisterFile";
    let response: Response;
    try {
      response = await this.transport(BASE + action, {
        method: "POST",
        headers: {
          "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`,
        },
        body: opgEnvelope(operation, credentials, body),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new OpgError("OPG_TRANSPORT_FAILED");
    }
    if (!response.ok || !response.body)
      throw new OpgError("OPG_TRANSPORT_FAILED");
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 32 * 1024 * 1024) {
          await reader.cancel();
          throw new OpgError("OPG_RESPONSE_TOO_LARGE");
        }
        chunks.push(part.value);
      }
    } catch (e) {
      if (e instanceof OpgError) throw e;
      throw new OpgError("OPG_TRANSPORT_FAILED");
    }
    const parts = soapParts(
      Buffer.concat(chunks),
      response.headers.get("content-type") ?? "",
    );
    const envelope = parseOpgXml(parts.xml),
      soapBody = element(envelope, "Body", SOAP_NS);
    if (envelope.name !== "Envelope" || envelope.uri !== SOAP_NS)
      throw new OpgError("OPG_RESPONSE_INVALID");
    const result = element(
      soapBody,
      `QueryCashRegister${operation}Response`,
      OPG_API_NS,
    );
    if (
      !result ||
      text(element(result, "result", COMMON), "funcCode", COMMON) !== "OK"
    )
      throw new OpgError("OPG_API_REJECTED");
    return { result, attachments: parts.attachments };
  }
  async status(credentials: ResolvedNavCredentials): Promise<RegisterStatus[]> {
    const { result } = await this.request(
      "Status",
      credentials,
      "<api:cashRegisterStatusQuery/>",
    );
    const list = element(
      element(result, "cashRegisterStatusResult"),
      "cashRegisterStatusList",
    );
    if (!list) throw new OpgError("OPG_RESPONSE_INVALID");
    const rows = elements(list, "cashRegisterStatus").map((n) => ({
      apNumber: text(n, "APNumber") ?? "",
      min: unsignedInteger(text(n, "minAvailableFileNumber")),
      max: unsignedInteger(text(n, "maxAvailableFileNumber")),
    }));
    if (
      rows.some(
        (r) =>
          !/^A\d{8}$/.test(r.apNumber) || r.min > r.max || r.max > 2147483647,
      ) ||
      new Set(rows.map((r) => r.apNumber)).size !== rows.length
    )
      throw new OpgError("OPG_RESPONSE_INVALID");
    return rows;
  }
  async files(
    credentials: ResolvedNavCredentials,
    apNumber: string,
    start: number,
    end: number,
  ): Promise<FilePage> {
    if (!/^A\d{8}$/.test(apNumber) || start < 1 || end < start)
      throw new OpgError("OPG_QUERY_INVALID");
    const { result, attachments } = await this.request(
      "FileData",
      credentials,
      `<api:cashRegisterFileDataQuery><api:APNumber>${apNumber}</api:APNumber><api:fileNumberStart>${start}</api:fileNumberStart><api:fileNumberEnd>${end}</api:fileNumberEnd></api:cashRegisterFileDataQuery>`,
    );
    const data = element(result, "cashRegisterFileDataResult");
    if (!data) throw new OpgError("OPG_RESPONSE_INVALID");
    const files = elements(
      element(data, "cashRegisterFileDataList"),
      "cashRegisterFileData",
    ).map((n) => {
      const name = text(n, "cashRegisterFileName") ?? "",
        m = /^(A\d{8})_\d{8}_\d{14}_(\d+)\.p7b$/.exec(name),
        validation = text(n, "fileValidationResultCode") ?? "";
      if (!m || m[1] !== apNumber || !["OK", "WARN"].includes(validation))
        throw new OpgError("OPG_FILE_VALIDATION_ERROR");
      const number = unsignedInteger(m[2]);
      if (number < start || number > end)
        throw new OpgError("OPG_RESPONSE_INVALID");
      const include = element(
        element(n, "cashRegisterFile"),
        "Include",
        XOP_NS,
      );
      let cid: string;
      try {
        cid = decodeURIComponent(
          include?.attributes.href?.replace(/^cid:/, "") ?? "",
        );
      } catch {
        throw new OpgError("OPG_ATTACHMENT_MISSING");
      }
      const attachment = attachments.get(cid);
      if (!attachment) throw new OpgError("OPG_ATTACHMENT_MISSING");
      return {
        apNumber,
        number,
        name,
        validation,
        xml: archivePayload(attachment),
      };
    });
    const sent = text(data, "allFilesSent");
    if (sent !== "true" && sent !== "false")
      throw new OpgError("OPG_RESPONSE_INVALID");
    return {
      files,
      allFilesSent: sent === "true",
      reason: text(data, "filesNotSentReason"),
      min: unsignedInteger(text(data, "minAvailableFileNumber")),
      max: unsignedInteger(text(data, "maxAvailableFileNumber")),
    };
  }
}
