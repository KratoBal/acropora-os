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
 * összesített, de CSAK az érvényes aláírású kéréseket számolja (az aláírás-ellenőrzés olcsó): a hamis kérések nem fogyasztják a
 * plafont, így nem lehet vele kizárni a commerce szerver valódi kéréseit. A 429 nem árul el semmit.
 *
 * A TOKEN AZ ÚTVONALBAN VAN, tehát a proxy és az API hozzáférési naplójába is bekerül (barracuda, #2201 review). Ezt az egyszer
 * használat és a 14 perc semlegesíti: a naplót olvasó a lejárat előtt, a vendég letöltése nélkül használhatna fel egy tokent. Az
 * útvonal maszkolása a naplózásban üzemeltetési kérdés, nem ennek a PR-nak a tárgya.
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
    const input =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    // a kérés CSAK az aláírás-ellenőrzés UTÁN számít a korlátba: a szemét (hamis aláírás, lejárt ts) nem tudja elfogyasztani az
    // összesített plafont, amit a commerce szerver valódi kérései használnak (barracuda, #2201 review)
    const result = await this.service.link(input, Date.now(), () =>
      WebshopInvoiceController.links.check(callerAddress(request)),
    );
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
    // ugyanígy: csak az érvényes aláírású, nem lejárt token számít a korlátba
    const result = await this.service.download(token, Date.now(), () =>
      WebshopInvoiceController.downloads.check(callerAddress(request)),
    );
    if (!result) throw new NotFoundException();
    return new StreamableFile(Buffer.from(result.bytes), {
      type: "application/pdf",
      length: result.bytes.byteLength,
      disposition: `attachment; filename="${result.filename}"`,
    });
  }
}
