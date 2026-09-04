import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { Public } from "../auth/decorators/public.decorator.js";
import { ContentAgentGuard } from "./content-agent.guard.js";
import { ContentService } from "./content.service.js";
import { ContentAgentReviseDto, ContentCreateDto } from "./dto/content.dto.js";

/**
 * A GÉPI ÁGENSEK BEJÁRATA. Külön vezérlő, külön őrző, ugyanaz a szolgáltatás.
 *
 * A `@Public()` CSAK annyit mond, hogy a globális `AuthGuard` álljon félre -- az
 * útvonal nem nyilvános. A `ContentAgentGuard` őrzi, és az ellenőrzést ő végzi,
 * beleértve a jogosultságot is, mert a `@Public()` a `PermissionGuard`-ot is
 * kiveszi az útból.
 *
 * MIÉRT KÜLÖN VEZÉRLŐ, ÉS NEM EGY ÚJABB METÓDUS A MEGLÉVŐBEN: a `@Public()` és
 * a `@UseGuards()` az egész osztályra szól. Egy vegyes vezérlőben egyetlen
 * elgépelés az emberi végpontokat is nyilvánossá tenné -- és a hiba
 * pontosan olyan csendes lenne, mint amilyen súlyos.
 *
 * MÁS SZOLGÁLTATÁS-METÓDUST HÍV, MINT AZ EMBERI ÚT, ÉS EZ A KÜLÖNBSÉG A LÉNYEG.
 * Az emberi űrlap `DRAFTING` állapotba teszi a tételt, és az helyes: egy ember
 * tényleg dolgozik még rajta. A gépi úton viszont a szerző maga a gép, tehát a
 * "vár a szerzőjére" állapot zsákutca -- a tétel az ágens listájában állna, és
 * a szerkesztőség képernyője üres maradna. Mérve 2026-09-02 este: a bejárat
 * HTTP 201-et adott, a tétel létrejött, és a gazda képernyője nullát mutatott.
 * Helyesen: a kézbesítés hiányzott, nem a bejárat.
 *
 * Ezért a gépi út `createForReview`-t hív, ami `AWAITING_REVIEW` állapotba tesz.
 * Balázs jóváhagyása erre, szó szerint: "jovahagyom" (2026-09-02 22:51, Discord),
 * acrobot közvetítésével.
 *
 * A szerző továbbra is a hívó -- az ágens saját fiókja --, mert az őrző azt
 * oldotta fel a tokenből, és egy tétel, aminek a szerzője valaki más, azonnal
 * az Ő listájában állna anélkül, hogy tudna róla.
 */
@Public()
@UseGuards(ContentAgentGuard)
@Controller("content/agent")
export class ContentAgentController {
  constructor(private readonly service: ContentService) {}

  @Post()
  create(
    @Body() input: ContentCreateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createForReview({ ...input, authorId: user.id });
  }

  /**
   * EGY MAR BEADOTT TETEL SZOVEGENEK JAVITASA.
   *
   * MIERT `PATCH` ES NEM UJABB `POST`: a mai allapot pontosan azert fajt, mert
   * az egyetlen gepi ut LETREHOZ. Egy javitas, ami uj tetelt szul, duplikatumot
   * csinal -- es arrol mar kulon kartya all. A `PATCH` a szerzodesben is
   * kimondja, hogy ugyanazt a tetelt irjuk at, nem ujat keszitunk.
   *
   * A SZERZO ITT IS A HIVO, ugyanabbol az okbol, mint a letrehozasnal: az orzo
   * a tokenbol oldotta fel, es a nyom-hozzaszolas az O neveben all -- a
   * jovahagyo igy latja, KI irta at a szoveget.
   */
  @Patch(":id")
  revise(
    @Param("id") id: string,
    @Body() input: ContentAgentReviseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reviseFromAgent({
      ...input,
      contentId: id,
      authorId: user.id,
    });
  }
}
