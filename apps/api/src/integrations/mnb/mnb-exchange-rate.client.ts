import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { SaxesParser } from "saxes";

// Nyilvános, hitelesítés nélküli MNB SOAP webszolgáltatás; a végpont és a
// GetExchangeRates(startDate, endDate, currencyNames) művelet neve/formátuma
// évek óta változatlan, lásd az MNB hivatalos dokumentációját:
// https://www.mnb.hu/letoltes/documentation-on-the-mnb-s-web-service-on-current-and-historic-exchange-rates.pdf
const DEFAULT_API_BASE_URL = "https://www.mnb.hu/arfolyamok.asmx";
const SOAP_NAMESPACE = "http://www.mnb.hu/webservices/";
const MAX_XML_BYTES = 512 * 1024;

export type MnbApiErrorCode =
  | "REQUEST_INVALID"
  | "NO_RATE_IN_RANGE"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "HTTP_OTHER"
  | "NETWORK_FAILED"
  | "TIMEOUT"
  | "XML_INVALID"
  | "XML_TOO_LARGE";

export class MnbApiError extends BadGatewayException {
  constructor(
    readonly code: MnbApiErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "MnbApiError";
  }
}

export interface MnbDailyRate {
  /// A ténylegesen jegyzett nap (YYYY-MM-DD); eltérhet a kért dátumtól, ha
  /// arra a napra nem volt jegyzés (hétvége, ünnepnap).
  date: string;
  /// HUF/deviza árfolyam, egy devizaegységre vetítve (a "unit" attribútummal
  /// már osztva), tizedespont-tizedesvessző konverzióval, stringként.
  rate: string;
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

interface XmlNode {
  name: string;
  text: string;
  attributes: Record<string, string>;
  children: XmlNode[];
}

function parseXml(xml: string): XmlNode {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES)
    throw new MnbApiError("XML_TOO_LARGE");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new MnbApiError("XML_INVALID");
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    const node: XmlNode = {
      name: tag.name,
      text: "",
      attributes: tag.attributes as Record<string, string>,
      children: [],
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  parser.on("text", (text) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch {
    throw new MnbApiError("XML_INVALID");
  }
  if (roots.length !== 1) throw new MnbApiError("XML_INVALID");
  return roots[0]!;
}

/// SOAP 1.1 kérés (schemas.xmlsoap.org boríték, SOAPAction fejléc külön).
function buildGetExchangeRatesXmlSoap11(
  startDate: string,
  endDate: string,
  currencyNames: string,
): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>` +
    `<GetExchangeRates xmlns="${SOAP_NAMESPACE}">` +
    `<startDate>${escapeXml(startDate)}</startDate>` +
    `<endDate>${escapeXml(endDate)}</endDate>` +
    `<currencyNames>${escapeXml(currencyNames)}</currencyNames>` +
    `</GetExchangeRates>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}

/// SOAP 1.2 kérés (w3.org/2003/05 boríték, az action a Content-Type-ban utazik,
/// nincs külön SOAPAction fejléc). Az MNB szolgáltatás a generikus WCF
/// "help page"-et adja böngészőből, ami mindkét kötést kiszolgáló hosztra utal,
/// ezért a kliens mindkettőt megpróbálja, ha az első elutasításra fut.
function buildGetExchangeRatesXmlSoap12(
  startDate: string,
  endDate: string,
  currencyNames: string,
): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<GetExchangeRates xmlns="${SOAP_NAMESPACE}">` +
    `<startDate>${escapeXml(startDate)}</startDate>` +
    `<endDate>${escapeXml(endDate)}</endDate>` +
    `<currencyNames>${escapeXml(currencyNames)}</currencyNames>` +
    `</GetExchangeRates>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/// A GetExchangeRatesResult maga is egy XML-dokumentum forráskódja
/// (SOAP-on belüli string, nem beágyazott elem), pl.:
/// <MNBExchangeRates><Day date="2026-07-20"><Rate unit="1" curr="EUR">402,15</Rate></Day></MNBExchangeRates>
/// Üres eredmény (nincs <Day>) azt jelenti, hogy nem volt jegyzés a kért
/// intervallumban az adott devizára.
export function parseGetExchangeRatesResponse(
  soapXml: string,
  currency: string,
): MnbDailyRate[] {
  const envelope = parseXml(soapXml);
  const body =
    envelope.children.find((node) => node.name.endsWith("Body")) ?? envelope;
  const resultElement = body.children
    .find((node) => node.name.endsWith("GetExchangeRatesResponse"))
    ?.children.find((node) => node.name.endsWith("GetExchangeRatesResult"));
  const innerXml = resultElement?.text.trim();
  if (!innerXml) return [];

  const inner = parseXml(innerXml);
  const days = inner.children.filter((node) => node.name === "Day");
  const rates: MnbDailyRate[] = [];
  for (const day of days) {
    const date = day.attributes.date;
    if (!date) continue;
    const rateNode = day.children.find(
      (node) => node.name === "Rate" && node.attributes.curr === currency,
    );
    if (!rateNode) continue;
    const unit = Number(rateNode.attributes.unit ?? "1") || 1;
    const rawValue = Number(rateNode.text.trim().replace(",", "."));
    if (!Number.isFinite(rawValue)) continue;
    rates.push({ date, rate: (rawValue / unit).toString() });
  }
  return rates;
}

interface SoapAttempt {
  label: "SOAP 1.1" | "SOAP 1.2";
  body: string;
  headers: Record<string, string>;
}

@Injectable()
export class MnbExchangeRateClient {
  private readonly logger = new Logger(MnbExchangeRateClient.name);

  /// startDate/endDate: "YYYY-MM-DD"; currency: ISO 4217 kód (pl. "EUR").
  async getExchangeRates(
    startDate: string,
    endDate: string,
    currency: string,
  ): Promise<MnbDailyRate[]> {
    const baseUrl = (process.env.MNB_API_URL ?? DEFAULT_API_BASE_URL).replace(
      /\/$/,
      "",
    );
    const attempts: SoapAttempt[] = [
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

    let lastError: MnbApiError | undefined;
    for (const [index, attempt] of attempts.entries()) {
      const isLastAttempt = index === attempts.length - 1;
      let responseText: string;
      let status: number;
      try {
        const response = await this.request(baseUrl, {
          method: "POST",
          headers: attempt.headers,
          body: attempt.body,
          signal: AbortSignal.timeout(15_000),
        });
        status = response.status;
        responseText = await response.text();
      } catch (error) {
        const code =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
            ? "TIMEOUT"
            : "NETWORK_FAILED";
        if (isLastAttempt) throw new MnbApiError(code);
        lastError = new MnbApiError(code);
        continue;
      }
      if (status >= 400) {
        // A nyers választ (jellemzően egy SOAP Fault, ami a tényleges okot
        // is tartalmazza) csak szerveroldalon naplózzuk - sosem küldjük a
        // böngészőnek -, ugyanúgy, ahogy a NAV kliens is teszi.
        this.logger.warn(
          `MNB GetExchangeRates (${attempt.label}) elutasítva (HTTP ${status}): ${responseText.slice(0, 2000)}`,
        );
        const code =
          status >= 400 && status < 500
            ? "HTTP_4XX"
            : status >= 500
              ? "HTTP_5XX"
              : "HTTP_OTHER";
        if (isLastAttempt) throw new MnbApiError(code);
        lastError = new MnbApiError(code);
        continue;
      }
      return parseGetExchangeRatesResponse(responseText, currency);
    }
    // Elméletileg elérhetetlen (az attempts tömb sosem üres), de a
    // típusrendszernek kell egy visszatérési/dobási ág a ciklus után.
    throw lastError ?? new MnbApiError("HTTP_OTHER");
  }

  protected request(input: string, init: RequestInit) {
    return fetch(input, init);
  }
}
