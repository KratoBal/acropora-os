import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { base64Url, buildMimeMessage } from "./mime.js";
import type { MailSender, OutgoingMail } from "./mail.port.js";

/**
 * A GMAIL MOGOTT -- ES A HIVO NEM TUD ROLA.
 *
 * Ez az EGYETLEN fajl, ami a Gmail letezeserol tud. A hivo a `MailSender`
 * interfeszt latja (acrobot masodik kikotese, 2026-09-21: "az egyetlen dolog,
 * amit biztosan tudunk egy kulso szolgaltatorol, hogy egyszer lecsereljuk").
 *
 * A HITELESITES ALAKJA A HAZE, nem talaltam ki ujat: ugyanaz a
 * refresh-token -> access-token csere, ugyanazzal a gyorsitotarral, mint a
 * `foxpost-gmail.client.ts`-ben. Ha az az ut valaha javul, ez is ugyanugy
 * javithato.
 */

const DEFAULT_GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 15_000;

export const TICKET_MAIL_FETCH = Symbol("TICKET_MAIL_FETCH");

/**
 * A KORNYEZET IS TOKENEN AT JON, ES EZ NEM DISZ.
 *
 * Elso valtozatomban sima `NodeJS.ProcessEnv` parameter allt itt. A Nest azt
 * NEM TUDJA FELOLDANI (interfesz, nincs token), es az egesz alkalmazas-graf
 * osszeallitasa elbukott rajta. Nem egyseg-teszt fogta meg, hanem a haz
 * `app.bootstrap.spec` fajlja, ami a TELJES futasideju grafot leforditja --
 * egy olyan halo, amit nem en irtam, es az en uj kodomat is latta.
 */
export const TICKET_MAIL_ENV = Symbol("TICKET_MAIL_ENV");

export class TicketMailError extends Error {
  /*
    A `cause` AZERT KELL, mert a bizonytalan agon a VALODI ok (idokorlat kontra
    halozati szakadas) csak ott latszik -- a kod maga csak a CSOPORTOT nevezi meg.
    Enelkul a diagnozis egy szinttel durvabb lenne, mint amit tudunk.
  */
  constructor(
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "TicketMailError";
  }
}

export interface TicketMailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  user: string;
  apiUrl: string;
  tokenUrl: string;
}

/**
 * A HIANYZO BEALLITAS NEM HIBA, HANEM ALLAPOT -- ES A KULONBSEG SZAMIT.
 *
 * acrobot idozitese (2026-09-21): a titkok akkor kerulnek ki, amikor a kod
 * telepitesre kesz. Addig az API-nak EL KELL INDULNIA, es NEM kuldhet. Ezert
 * ez a fuggveny `null`-t ad vissza, nem dob: a hianyzo kulcs a rendes allapot,
 * nem kivetel.
 */
export function ticketMailConfig(
  environment: NodeJS.ProcessEnv = process.env,
): TicketMailConfig | null {
  const clientId = environment.GMAIL_TICKET_CLIENT_ID?.trim();
  const clientSecret = environment.GMAIL_TICKET_CLIENT_SECRET?.trim();
  const refreshToken = environment.GMAIL_TICKET_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    user: environment.GMAIL_TICKET_USER?.trim() || "ticket@acropora.hu",
    apiUrl: (environment.GMAIL_API_URL || DEFAULT_GMAIL_API_URL).replace(
      /\/+$/,
      "",
    ),
    tokenUrl: environment.GOOGLE_OAUTH_TOKEN_URL || DEFAULT_TOKEN_URL,
  };
}

@Injectable()
export class GmailMailSender implements MailSender {
  private readonly logger = new Logger(GmailMailSender.name);
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    @Optional()
    @Inject(TICKET_MAIL_FETCH)
    private readonly fetchImpl: typeof fetch = fetch,
    @Optional()
    @Inject(TICKET_MAIL_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const config = ticketMailConfig(this.environment);
    if (!config) throw new TicketMailError("TICKET_MAIL_NOT_CONFIGURED");

    /*
      A NYERS LEVEL ITT EPUL, ES ITT DOB, HA FEJLEC-INJEKCIOT TALAL. A
      `buildMimeMessage` a masodik reteg: az elso az osszeallitonal all.
    */
    const raw = base64Url(buildMimeMessage(mail, config.user));
    const token = await this.token(config);

    /*
      A KULDES-KERES KULON BURKOT KAP, ES EZ A KARTYA LENYEGE (79649b43).

      === A MERES: MELYIK KIVETELROL TUDJUK, HOGY A KERES EL SEM INDULT ===

      A `send()` OT helyen dobhat, es HAROM csoportba esnek:

        a keres EL SEM INDULT (tudjuk, hogy semmi nem ment ki)
          TICKET_MAIL_NOT_CONFIGURED     a beallitas hianyzik
          a `buildMimeMessage` dobasa    fejlec-injekcio, ures cimzett-lista
          TICKET_MAIL_TOKEN_FAILED       a TOKEN-keres hasalt el
          TICKET_MAIL_TOKEN_INVALID      a token-valasz ertelmezhetetlen
          (es a TOKEN-keres megszakitasa is ide tartozik: ha az esik ki, a
           kuldes-keres el sem indul)

        a keres ELINDULT, es VALASZ JOTT (tudjuk, hogy NEM vettek at)
          TICKET_MAIL_SEND_FAILED_<status>

        a keres ELINDULT, es NEM JOTT VALASZ (NEM TUDJUK)   <- EZ AZ UJ AG
          idokorlat (`AbortController`) vagy halozati szakadas a kuldesen

      A harmadik csoportot eddig SEMMI nem kulonboztette meg: a szolgaltatas
      egy csupasz `DOMException`-t latott, amirol nem tudta megmondani, a
      TOKEN-keresen tortent-e (ott a bukas BIZTOS) vagy a KULDESEN (ott nem).

      Ezert all a burok CSAK ITT, es nem a `request` belsejeben: a hely maga a
      megkulonbozteto jel.
    */
    let response: Response;
    try {
      response = await this.request(`${config.apiUrl}/users/me/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      });
    } catch (cause) {
      /*
        NEM "SIKERTELEN", HANEM "NEM TUDJUK". A megszakitas a MI oldalunkon
        tortenik, es a tavoli feldolgozasrol semmit nem mond -- a Gmail MAR
        atvehette a levelet.
      */
      this.logger.warn(
        "A levél kiküldésének kimenetele BIZONYTALAN: válasz nem érkezett.",
      );
      throw new TicketMailError("TICKET_MAIL_SEND_INDETERMINATE", {
        cause,
      });
    }

    if (!response.ok) {
      /*
        A VALASZ TORZSE NEM KERUL A NAPLOBA VALTOZATLANUL: egy Google-hiba
        visszaidezheti a cimzettet. A statusz es a kodunk eleg a diagnozishoz.
      */
      this.logger.warn(
        `A levél kiküldése nem sikerült (HTTP ${response.status}).`,
      );
      throw new TicketMailError(`TICKET_MAIL_SEND_FAILED_${response.status}`);
    }
  }

  private async token(config: TicketMailConfig): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000)
      return this.accessToken.value;
    const response = await this.request(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) throw new TicketMailError("TICKET_MAIL_TOKEN_FAILED");
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token)
      throw new TicketMailError("TICKET_MAIL_TOKEN_INVALID");
    this.accessToken = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
