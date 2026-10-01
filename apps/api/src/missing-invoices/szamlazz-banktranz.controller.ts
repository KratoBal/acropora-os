import { Controller, Headers, Post, Req, Res } from "@nestjs/common";

import { Public } from "../auth/decorators/public.decorator.js";
import { BANKTRANZ_MAX_BYTES } from "./szamlazz-banktranz.js";
import { SzamlazzBanktranzService } from "./szamlazz-banktranz.service.js";

/**
 * A SZÁMLÁZZ.HU BANKI TRANZAKCIÓ-TOVÁBBÍTÁS VÉGPONTJA (az `urlbanktranz`).
 *
 * A `@Public()` csak annyit mond, hogy a globális bejelentkezés-őr álljon félre:
 * a hívó nem felhasználó, hanem a Számlázz.hu. Az azonosítás a szolgáltatásban
 * van (az `X-Szamlazzhu-Key` fejléc), és a kapcsoló kikapcsolt állásában a
 * végpont 404.
 *
 * A törzset a vezérlő maga olvassa nyersen, méretkorláttal: a Számlázz.hu
 * `application/xml`-t küld, amit a globális törzs-olvasó nem dolgoz fel, és a
 * globális beállításhoz egy végpont kedvéért nem nyúlunk.
 */
/** Amit a kérésből használunk: a nyers törzs-folyam (a globális olvasó nem nyúlt hozzá). */
export interface RawRequest extends AsyncIterable<Buffer | string> {
  body?: unknown;
}

/** Amit a válaszból használunk (az Express válasza ezt teljesíti). */
export interface XmlResponse {
  status(code: number): XmlResponse;
  type(contentType: string): XmlResponse;
  send(body: string): void;
  end(): void;
}

@Controller("integrations/szamlazz")
@Public()
export class SzamlazzBanktranzController {
  constructor(private readonly service: SzamlazzBanktranzService) {}

  @Post("banktranz")
  async receive(
    @Req() request: RawRequest,
    @Res() response: XmlResponse,
    @Headers("x-szamlazzhu-key") key: string | undefined,
  ): Promise<void> {
    const body = await readBody(request);
    if (body === null) {
      response.status(413).end();
      return;
    }
    const result = await this.service.receive(key, body);
    response.status(result.status);
    if (result.body)
      response.type("application/xml; charset=utf-8").send(result.body);
    else response.end();
  }
}

/** A nyers törzs UTF-8-ként; `null`, ha a korlátnál nagyobb. */
export async function readBody(
  request: RawRequest,
  maxBytes: number = BANKTRANZ_MAX_BYTES,
): Promise<string | null> {
  if (typeof request.body === "string") return request.body;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
