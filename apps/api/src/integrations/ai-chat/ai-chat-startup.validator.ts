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

    /**
     * Az alak-ellenorzes arra fut, ami JELEN VAN - fuggetlenul attol, hogy a
     * masik hianyzik-e.
     *
     * Elsore csak akkor futott, ha MINDKETTO megvolt, es murena talalta meg,
     * mi a baj vele: ha az egyik hianyzik ES a masik idezojelek koze van
     * zarva, akkor az idezojelrol egy szo sem esik. A kollega potolja a
     * hianyzot, ujraindit, es CSAK AKKOR kapja meg a masodik figyelmeztetest
     * - ket kor egy helyett, pontosan az a lassitas, ami ellen ez az egesz
     * valaszto keszult.
     */
    this.warnAboutSuspiciousValues({ baseUrl, token });

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
  /**
   * A masik hiba, amit ez a valaszto NEM latna: a valtozo ott van, a HELYES
   * neven, de az ERTEKE hasznalhatatlan.
   *
   * A tipikus alak az, hogy a beallitas idezojelekkel EGYUTT lett elmentve.
   * A beallitas-olvaso trimmel, tehat a szokoz nem gond, de egy idezojelek
   * koze zart erteket JELENLEVONEK lat -- es akkor a hivas nem
   * ai_not_configured-del bukik, hanem 401-gyel. **Ez masik kepernyo, es epp
   * ezert dragabb**: aki a mai eset alapjan keres, a hianyzo beallitast fogja
   * nezni, es az rendben lesz.
   *
   * Murena vette eszre, a mai eset visszaolvasasabol.
   *
   * Csak JELEZ, nem allitja meg az indulast, es nem is utasitja el az
   * erteket: egy valodi ertek elvben kezdodhet idezojellel, es egy or, ami
   * hamis riasztast ad, elobb-utobb kikapcsolodik. A NEV megy a naploba, az
   * ertek soha - meg reszletben sem, mert egy 'igy kezdodik' reszlet is a
   * titok darabja.
   */
  private warnAboutSuspiciousValues(values: {
    baseUrl: string | undefined;
    token: string | undefined;
  }): void {
    const quoted = [
      values.baseUrl && isWrappedInQuotes(values.baseUrl)
        ? AI_CHAT_BASE_URL_ENV
        : null,
      values.token && isWrappedInQuotes(values.token)
        ? AI_CHAT_TOKEN_ENV
        : null,
    ].filter((name): name is string => name !== null);

    if (!quoted.length) return;

    this.logger.warn(
      `Az AI beallitas megvan, de gyanus alaku: ${quoted.join(" es ")} erteke idezojelek koze van zarva. ` +
        "Ha a beallitast idezojelekkel egyutt mentettek el, a hivas nem " +
        "ai_not_configured hibat ad, hanem 401-et - mas kepernyo, mas ok.",
    );
  }

  private lookalikesFor(missingName: string): string[] {
    const suffix = missingName.split("_").slice(-2).join("_");

    if (!suffix.includes("_")) return [];

    return Object.keys(this.environment)
      .filter(
        (name) =>
          name !== missingName &&
          /*
            Az elotagos alak a motivalo eset (mas rendszerbol atmasolt nev),
            de a CSUPASZ nev is illeszkedjen: aki egy 'ACCESS_TOKEN' nevu
            valtozot masol be, ugyanabba a hibaba fut, es a valaszto
            kulonben hallgatna. Murena vette eszre.
          */
          (name.endsWith(`_${suffix}`) || name === suffix) &&
          (this.environment[name]?.trim() ?? "") !== "",
      )
      .sort()
      .slice(0, 3);
  }
}

/**
 * Idezojelek koze van-e zarva az ertek?
 *
 * Szandekosan szuk: csak akkor mond igazat, ha az ertek UGYANAZZAL az
 * idezojellel kezdodik es vegzodik, es legalabb ket karakter. Egy valodi
 * ertek, ami veletlenul idezojelre vegzodik, igy nem ad hamis riasztast.
 */
export function isWrappedInQuotes(value: string): boolean {
  if (value.length < 2) return false;

  const first = value[0];
  const last = value[value.length - 1];

  return (first === '"' || first === "'") && first === last;
}
