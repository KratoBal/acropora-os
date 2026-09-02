import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { Public } from "../auth/decorators/public.decorator.js";
import { ContentAgentGuard } from "./content-agent.guard.js";
import { ContentService } from "./content.service.js";
import { ContentCreateDto } from "./dto/content.dto.js";

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
 * UGYANAZT A SZOLGÁLTATÁS-METÓDUST HÍVJA, mint az emberi út. Az ágens-tétel
 * ugyanúgy `DRAFTING` állapotban keletkezik és ugyanúgy a szerzőjére vár --
 * azzal a különbséggel, hogy a szerző az ágens saját fiókja, mert az őrző azt
 * oldotta fel a tokenből.
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
    return this.service.create({ ...input, authorId: user.id });
  }
}
