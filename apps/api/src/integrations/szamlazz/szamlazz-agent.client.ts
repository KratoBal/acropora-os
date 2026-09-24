import {
  parseSzamlazzAgentXmlResponse,
  type SzamlazzAgentResponse,
} from "./szamlazz-agent-xml.js";

/**
 * A Számlázz.hu Agent API vékony klienese.
 *
 * ELSŐDLEGES FORRÁS (acrobot, 23127): docs.szamlazz.hu/agent/generating_invoice/request,
 * letöltve 2026-09-24. A cím, a metódus és a mezőnév ott áll, nem találgatás:
 *
 *   POST https://www.szamlazz.hu/szamla/, multipart/form-data,
 *   mező: action-xmlagentxmlfile (az XML mint FÁJL, nem sima form-mező).
 *
 * A `fetch` azért konstruktor-paraméter, hogy a hívás ALAKJA hálózat nélkül
 * mérhető legyen -- a Medusa admin kliens mintája
 * (medusa-admin.client.ts HttpMedusaAdminClient).
 */

export const SZAMLAZZ_AGENT_URL = "https://www.szamlazz.hu/szamla/";

export class SzamlazzAgentHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`SZAMLAZZ_AGENT_HTTP_${status}: ${body.slice(0, 500)}`);
    this.name = "SzamlazzAgentHttpError";
  }
}

export interface SzamlazzAgentClient {
  /**
   * Egyetlen számla-XML beküldése. A HTTP réteg csak a SZÁLLÍTÁSRÓL felel:
   * egy 2xx válasz XML törzsét adja tovább elemzésre -- a Számlázz.hu saját
   * üzleti elutasítása (`<sikeres>false</sikeres>`) NEM dob kivételt itt,
   * mert az egy VÁLASZ, nem szállítási hiba (lásd
   * generating_invoice_response.txt "Unsuccessful request" példáját).
   */
  generateInvoice(xml: string): Promise<SzamlazzAgentResponse>;
}

export class HttpSzamlazzAgentClient implements SzamlazzAgentClient {
  constructor(
    private readonly url: string = SZAMLAZZ_AGENT_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateInvoice(xml: string): Promise<SzamlazzAgentResponse> {
    const form = new FormData();
    form.append(
      "action-xmlagentxmlfile",
      new Blob([xml], { type: "text/xml" }),
      "szamla.xml",
    );
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      body: form,
    });
    const body = await response.text();
    if (!response.ok) throw new SzamlazzAgentHttpError(response.status, body);
    return parseSzamlazzAgentXmlResponse(body);
  }
}
