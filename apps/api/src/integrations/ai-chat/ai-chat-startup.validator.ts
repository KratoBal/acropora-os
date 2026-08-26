import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";

import {
  AI_CHAT_BASE_URL_ENV,
  AI_CHAT_ENVIRONMENT,
  AI_CHAT_TOKEN_ENV,
} from "./ai-chat.config.js";

/**
 * Mit mond a naplo indulaskor, ha az AI integracio fel van konfiguralva.
 *
 * A 2026-08-27 hajnali eles hiba alakja: a belso AI teszt-felulet
 * `ai_not_configured` hibat adott NULLA ezredmasodperccel, mert a ket
 * kornyezeti valtozo kozul az egyik hianyzott. Ket dolog tette dragava, es
 * egyik sem a hiany maga:
 *
 * 1. Csak akkor derult ki, amikor valaki megnyitotta a feluletet. Addig a
 *    rendszer ugy indult el, mintha minden rendben lenne.
 * 2. A hibakod NEM mondta meg, MELYIK fele hianyzik. A ket valtozo egyutt
 *    kell, es ha barmelyik ures, a beallitas egeszben null lesz - a hivo
 *    szamara ez ugyanaz az egy szo.
 *
 * Ez az osztaly mindkettot megszunteti: indulaskor szol, es MEGNEVEZI a
 * hianyzo felet.
 *
 * **Nem allitja meg az indulast, es ez szandekos.** Az AI teszt-felulet egy
 * belso mero-eszkoz; ha a tokene hianyzik, attol a rendeles, a szamlazas es a
 * raktar meg mukodik. Egy olyan valaszto, ami az egesz APIt megfogja egy
 * mellekfunkcio miatt, nagyobb kart okoz, mint amit megelozne.
 */
@Injectable()
export class AiChatStartupValidator implements OnModuleInit {
  private readonly logger = new Logger(AiChatStartupValidator.name);

  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    @Optional()
    @Inject(AI_CHAT_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    /**
     * Ugyanaz az injektalasi jelzo, amit a szolgaltatas hasznal.
     *
     * Nem alapertelmezett konstruktor-parameter: a Nest a kibocsatott TIPUS
     * alapjan old fel, es a `NodeJS.ProcessEnv` olyasmire torlodik, amit a
     * konteneр nem tud eloallitani. Az alapertelmezett ertek NEM ment meg,
     * mert a feloldas HAMARABB bukik el, mint hogy odaerne - ez pontosan az
     * az alak, ami az AiUserContextGuard indulasat megakadalyozta.
     */
    this.environment = environment ?? process.env;
  }

  onModuleInit(): void {
    const baseUrl = this.environment[AI_CHAT_BASE_URL_ENV]?.trim();
    const token = this.environment[AI_CHAT_TOKEN_ENV]?.trim();

    if (baseUrl && token) return;

    const missing = [
      baseUrl ? null : AI_CHAT_BASE_URL_ENV,
      token ? null : AI_CHAT_TOKEN_ENV,
    ].filter((name): name is string => name !== null);

    const lookalikes = missing.flatMap((name) => this.lookalikesFor(name));

    /**
     * A hianyzo valtozok NEVE megy a naploba, az ERTEKUK soha.
     *
     * A cim nem titok, a token az - es egy naplosor, ami "a token X helyett Y"
     * alakban segitene, pontosan azt a titkot vinne ki, amit ez az egesz
     * reteg ovni hivatott. Egy valtozo NEVE viszont nem titok, es epp az a
     * fajta adat, amit 2026-08-27 hajnalban valakinek latnia kellett volna.
     */
    const hint = lookalikes.length
      ? ` A kornyezetben viszont ott van ${lookalikes.join(", ")} - ha a nevet masoltad at egy masik rendszerbol, valoszinuleg ez tortent.`
      : "";

    this.logger.warn(
      `Az AI teszt-felulet nem tud hivni: hianyzik ${missing.join(" es ")}.` +
        hint +
        " A ketto egyutt kell; amig barmelyik ures, a felulet " +
        "ai_not_configured hibat ad. Minden mas funkcio mukodik.",
    );
  }

  /**
   * Van-e a kornyezetben olyan valtozo, ami UGYANARRA VEGZODIK, mint a
   * hianyzo?
   *
   * A 2026-08-27 hajnali eset pontos alakja nem az volt, hogy az ertek
   * hianyzott: MAS NEVEN allt. Az AI oldali API_ACCESS_TOKEN nevet masoltak
   * at oda, ahol ACROPORA_AI_ACCESS_TOKEN a helyes. A "hianyzik
   * ACROPORA_AI_ACCESS_TOKEN" sor ilyenkor IGAZ, es a kereso ember fejeben
   * megis az a kovetkezo mondat, hogy "dehogy hianyzik, felvettem".
   *
   * Az utolso ket nevszakasz alapjan keresunk (ACCESS_TOKEN, BASE_URL), mert
   * az elgepeles es a rossz masolas mindig az ELOTAGOT rontja el: a szerep
   * nevet, amit az ember ismer, jol irja le.
   *
   * Csak NEVEK kerulnek ki, ertek soha, es legfeljebb harom - egy hosszu
   * lista mar nem segit, csak zajt visz a naploba.
   */
  private lookalikesFor(missingName: string): string[] {
    const suffix = missingName.split("_").slice(-2).join("_");

    if (!suffix.includes("_")) return [];

    return Object.keys(this.environment)
      .filter(
        (name) =>
          name !== missingName &&
          name.endsWith(`_${suffix}`) &&
          (this.environment[name]?.trim() ?? "") !== "",
      )
      .sort()
      .slice(0, 3);
  }
}
