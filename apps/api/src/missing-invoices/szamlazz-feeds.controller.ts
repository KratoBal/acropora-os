import { Controller, Headers, Post, Req, Res } from "@nestjs/common";

import { Public } from "../auth/decorators/public.decorator.js";
import {
  readBody,
  type RawRequest,
  type XmlResponse,
} from "./szamlazz-banktranz.controller.js";
import { SZAMLAZZ_FEED_MAX_BYTES } from "./szamlazz-feed-xml.js";
import type { SzamlazzFeedKind } from "./szamlazz-feeds.repository.js";
import { SzamlazzFeedsService } from "./szamlazz-feeds.service.js";

/**
 * A SZÁMLÁZZ.HU SZÁMLA- ÉS NYUGTA-TOVÁBBÍTÁS VÉGPONTJAI (a regisztráció
 * `urlszamlabe`, `urlszamlaki` és `urlnyugta` címe). Ugyanaz a felépítés, mint a
 * banki fogadóé: `@Public()` (a hívó a Számlázz.hu, az azonosítás a kulcs), a
 * törzs nyersen, méretkorláttal, és kikapcsolva 404.
 */
@Controller("integrations/szamlazz")
@Public()
export class SzamlazzFeedsController {
  constructor(private readonly service: SzamlazzFeedsService) {}

  @Post("szamlabe")
  szamlabe(
    @Req() request: RawRequest,
    @Res() response: XmlResponse,
    @Headers("x-szamlazzhu-key") key: string | undefined,
  ) {
    return this.handle("SZAMLABE", request, response, key);
  }

  @Post("szamlaki")
  szamlaki(
    @Req() request: RawRequest,
    @Res() response: XmlResponse,
    @Headers("x-szamlazzhu-key") key: string | undefined,
  ) {
    return this.handle("SZAMLAKI", request, response, key);
  }

  @Post("nyugta")
  nyugta(
    @Req() request: RawRequest,
    @Res() response: XmlResponse,
    @Headers("x-szamlazzhu-key") key: string | undefined,
  ) {
    return this.handle("NYUGTA", request, response, key);
  }

  private async handle(
    kind: SzamlazzFeedKind,
    request: RawRequest,
    response: XmlResponse,
    key: string | undefined,
  ): Promise<void> {
    const body = await readBody(request, SZAMLAZZ_FEED_MAX_BYTES);
    if (body === null) {
      response.status(413).end();
      return;
    }
    const result = await this.service.receive(kind, key, body);
    response.status(result.status);
    if (result.body)
      response.type("application/xml; charset=utf-8").send(result.body);
    else response.end();
  }
}
