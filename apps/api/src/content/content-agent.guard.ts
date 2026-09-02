import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import type { AuthenticatedUser } from "@acropora/types";

import { AuthUserResolver } from "../auth/auth-user-resolver.js";
import { ServiceTokenRepository } from "../tasks/service-token.repository.js";
import {
  CONTENT_AGENT_ENVIRONMENT,
  contentAgentTokenIds,
} from "./content-agent.config.js";

export interface ContentAgentRequest {
  headers: { authorization?: string };
  user?: AuthenticatedUser;
}

/**
 * A GÉPI ÁGENSEK BEJÁRATA A TARTALOM-SORBA, és semmi máshoz.
 *
 * KÜLÖN OSZTÁLY, NEM A GLOBÁLIS ŐRZŐ BŐVÍTÉSE, és ez nem ízlés: a repó
 * háziredje kétszer leírva és kétszer megépítve mondja ki, hogy egy második
 * használati esetnek SAJÁT mechanizmust kell nyitnia. Ha a globális `AuthGuard`
 * megtanulna szolgáltatás-tokent olvasni, onnantól MINDEN végpont elfogadná
 * egyet, és a hatókör a token jogain múlna, nem az őrzőn.
 *
 * AMIT ÚJRAHASZNÁL: a KERESÉST (`ServiceTokenRepository`), hogy a SHA-256
 * hasításnak egy helye legyen. Amit NEM: a jogosultságot.
 *
 * ÖT ELLENŐRZÉS, ÉS MINDEGYIK UGYANAZT A HIBÁT ADJA VISSZA. A hívó azt tudja
 * meg, hogy EZT a végpontot használhatja-e, és semmit arról, hogy az érték
 * máshol érvényes-e.
 *
 *   1. Van beállított engedélylista. Nélküle MINDEN elutasításra kerül.
 *   2. Van Bearer token.
 *   3. A token létezik és nincs visszavonva.
 *   4. A token AZ engedélylistán szereplő rekordok egyike.
 *   5. A tokenhez TARTOZIK FELHASZNÁLÓ, az a fiók AKTÍV, és van `content.manage`
 *      joga.
 *
 * AZ ÖTÖDIK KÉT RÉSZE KÜLÖN FONTOS.
 *
 * A FELHASZNÁLÓ NÉLKÜLI TOKEN ELUTASÍTÁSRA KERÜL, és NEM esik vissza semmilyen
 * alapértelmezett fiókra. A `ServiceToken.userId` nullázható, mert a korábban
 * kiadott tokeneknek nincs ilyenjük -- egy csendes visszaesés itt azt jelentené,
 * hogy egy régi token hirtelen valaki nevében ír, és a soron semmi nem mutatná.
 *
 * A JOGOSULTSÁG-ELLENŐRZÉS UGYANAZ, mint embernél. A `@Public()` csak a
 * globális `AuthGuard`-ot állítja félre; vele együtt a `PermissionGuard` is
 * kimarad, tehát ha ez az őrző nem nézné meg a jogot, a gépi út MEGKERÜLNÉ azt,
 * amit az emberi út betart. Ezért áll itt, és ezért `content.manage` -- a
 * `content.approve` szándékosan nincs benne: egy ágens nem hagyhatja jóvá a
 * saját vázlatát, és ezt a szerep tartja, nem a jómodor.
 */
@Injectable()
export class ContentAgentGuard implements CanActivate {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly tokens: ServiceTokenRepository,
    private readonly users: AuthUserResolver,
    @Optional()
    @Inject(CONTENT_AGENT_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const engedettek = contentAgentTokenIds(this.environment);

    if (engedettek.length === 0)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const request = context.switchToHttp().getRequest<ContentAgentRequest>();
    const [scheme, rawToken] = request.headers.authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !rawToken)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const token = await this.tokens.findActive(rawToken);

    if (!token || !engedettek.includes(token.id))
      throw new UnauthorizedException("Érvénytelen token.");

    if (!token.userId) throw new UnauthorizedException("Érvénytelen token.");

    // A FELOLDAS SAJAT HIBAT DOB, ha a fiok nem letezik vagy nem aktiv, es azt
    // ITT KELL EGYSEGESITENI. Enelkul a valasz elarulna, hogy a token EGY
    // LETEZO, de kikapcsolt fiokra mutat -- a tobbi negy ellenorzes pedig
    // szandekosan megkulonboztethetetlen. Egy inaktiv agens-fiok igy nem
    // valik felismerheto allapotta a hivo szamara.
    let user: AuthenticatedUser;
    try {
      user = await this.users.resolveById(token.userId);
    } catch {
      throw new UnauthorizedException("Érvénytelen token.");
    }

    if (!hasPermission(user, PERMISSIONS.CONTENT_MANAGE))
      throw new UnauthorizedException("Érvénytelen token.");

    // A FELOLDOTT FELHASZNALO A KERESRE KERUL, hogy a `@CurrentUser()` ugyanugy
    // mukodjon, mint az emberi uton -- es hogy a letrehozott tetel SZERZOJE az
    // AGENS sajat fiokja legyen, ne egy kozos.
    request.user = user;
    return true;
  }
}
