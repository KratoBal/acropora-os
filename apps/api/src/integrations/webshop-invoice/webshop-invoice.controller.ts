import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  StreamableFile,
} from "@nestjs/common";

import { Public } from "../../auth/decorators/public.decorator.js";
import { callerAddress, IpRateLimiter } from "../../common/ip-rate-limit.js";
import { WebshopInvoiceService } from "./webshop-invoice.service.js";

interface CallerRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

/**
 * A VENDÉG SZÁMLA-LETÖLTÉSE (V1.1). KÉT PUBLIKUS VÉGPONT, mindkettő a saját aláírásával védve (nincs bejelentkezés):
 *  - `POST link`: a commerce szerver kérése (HMAC, 60 másodperces ablak) a rendelés azonosítójára; a válasz a rendelés számláihoz
 *    egy-egy letöltő hivatkozás, vagy üres lista.
 *  - `GET download/:token`: a vendég böngészője a hivatkozással; PDF vagy EGYFORMA 404.
 * Az üzenetek közös tulajdonsága: minden hiba (titok nélküli beállítás, rossz aláírás, lejárt vagy használt token, nincs számla)
 * ugyanaz a 404, tehát a végpont nem használható arra, hogy megtudjuk, melyik rendelés létezik. A kérésszám-korlát cím szerinti és
 * összesített; az 429 nem árul el semmit.
 */
@Controller("integrations/webshop-invoice")
export class WebshopInvoiceController {
  /** a link-kéréseket egyetlen szerver (a commerce) küldi, az összes vendég nevében: a címenkénti korlát ezért nagyvonalú */
  static readonly links = new IpRateLimiter(120, 600);
  /** a letöltéseket a vendégek böngészői hozzák: szigorú, címenkénti korlát */
  static readonly downloads = new IpRateLimiter(20, 600);

  constructor(private readonly service: WebshopInvoiceService) {}

  @Public()
  @Post("link")
  @HttpCode(200)
  async link(@Body() body: unknown, @Req() request: CallerRequest) {
    WebshopInvoiceController.links.check(callerAddress(request));
    const input =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const result = await this.service.link(input);
    if (!result) throw new NotFoundException();
    return result;
  }

  @Public()
  @Get("download/:token")
  @Header("Cache-Control", "no-store")
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Content-Security-Policy", "default-src 'none'; sandbox")
  async download(
    @Param("token") token: string,
    @Req() request: CallerRequest,
  ): Promise<StreamableFile> {
    WebshopInvoiceController.downloads.check(callerAddress(request));
    const result = await this.service.download(token);
    if (!result) throw new NotFoundException();
    return new StreamableFile(Buffer.from(result.bytes), {
      type: "application/pdf",
      length: result.bytes.byteLength,
      disposition: `attachment; filename="${result.filename}"`,
    });
  }
}
