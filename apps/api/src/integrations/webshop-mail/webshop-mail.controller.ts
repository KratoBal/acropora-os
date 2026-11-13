import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Optional,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import {
  WEBSHOP_MAIL_KEYS,
  parseWebshopMailFacts,
  webshopLegalSendRefusal,
  webshopMailKey,
} from "@acropora/types";

import { Public } from "../../auth/decorators/public.decorator.js";
import { webshopDefaultTemplate } from "../../notifications/mail/webshop-mail.content.js";
import { renderWebshopMail } from "../../notifications/mail/webshop-mail.render.js";
import { TicketMailRepository } from "../../notifications/mail/ticket-mail.repository.js";
import {
  WEBSHOP_MAIL_ENVIRONMENT,
  WEBSHOP_MAIL_FACTS_VERSION,
  webshopMailUsageGuidesOn,
} from "./webshop-mail.config.js";
import { WebshopMailGuard } from "./webshop-mail.guard.js";

/**
 * THE WEBSHOP ASKS, THE OS RENDERS (Balazs, 2026-10-05 20:11 UTC).
 *
 * The webshop posts `{ template, facts_version, facts }` with the facts it
 * builds for the mail; the answer is the mail as the customer gets it. The
 * webshop sends the HTML unchanged: sanitizing happens here, in one place.
 *
 * THE STATUS CODES TELL THE WEBSHOP WHAT TO DO (murena 26552):
 *   400  the request is wrong (template, version, a fact)  -> raise, do not retry
 *   422  the stored template cannot be rendered           -> raise, do not retry
 *   401  the token                                        -> raise
 *   5xx  anything else                                    -> retry
 * Every refusal carries a one-sentence Hungarian `message`; the OS shows it
 * next to the stuck mail.
 *
 * Read-only: it renders, it does not send and does not store anything.
 */
@Controller("integrations/webshop-mail")
@Public()
@UseGuards(WebshopMailGuard)
export class WebshopMailController {
  private readonly logger = new Logger(WebshopMailController.name);

  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly templates: TicketMailRepository,
    @Optional()
    @Inject(WEBSHOP_MAIL_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  @Post("render")
  @HttpCode(200)
  async render(@Body() body: unknown) {
    const request =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    if (request.facts_version !== WEBSHOP_MAIL_FACTS_VERSION)
      throw new BadRequestException(
        `A facts_version ${WEBSHOP_MAIL_FACTS_VERSION} kell, a kérésben ${JSON.stringify(request.facts_version ?? null)} áll.`,
      );
    const parsed = parseWebshopMailFacts(request.template, request.facts);
    if (!parsed.ok)
      throw new BadRequestException(`Hibás kérés: ${parsed.error}.`);

    /*
      NO CONFIRMATION WITH PLACEHOLDER LEGAL TEXTS (card d3ccef2e): a 422, so
      the shop holds the mail and raises it instead of retrying. Logged here
      with the version only, no customer data: the shop's queue has the order.
    */
    if (parsed.facts.template === "order-placed") {
      const refusal = webshopLegalSendRefusal(parsed.facts.legal_version);
      if (refusal) {
        this.logger.warn(
          `order-placed held: legal version ${JSON.stringify(parsed.facts.legal_version)} still has placeholders`,
        );
        throw new UnprocessableEntityException(refusal);
      }
    }

    /*
      THE LANGUAGE PICKS THE KEY (card d5c6befd): an English order reads the
      English twin (`<KEY>_EN`), stored text first, then its English default.
      With neither, the Hungarian mail is rendered (a missing English text must
      not hold a customer's mail back), but then the facts are rendered as
      Hungarian too, so the page language and the words agree.
    */
    const lookup = async (key: string) => {
      const stored = await this.templates.template(key);
      return { stored, template: stored ?? webshopDefaultTemplate(key) };
    };
    const hungarianKey = WEBSHOP_MAIL_KEYS[parsed.facts.template];
    const englishKey = webshopMailKey(
      parsed.facts.template,
      parsed.facts.locale,
    );
    const english =
      englishKey === hungarianKey ? null : await lookup(englishKey);
    const useEnglish = english !== null && english.template !== null;
    const key = useEnglish ? englishKey : hungarianKey;
    const found = useEnglish && english ? english : await lookup(hungarianKey);
    const rendered = useEnglish
      ? parsed.facts
      : { ...parsed.facts, locale: "hu" as const };
    /*
      THE USAGE GUIDES (V3.3): only behind the switch, and only for an order
      placed in Hungarian. The ORDER's language decides, read before the
      fallback above: an English order rendered with the Hungarian template
      must not get the Hungarian-only section.
    */
    const facts =
      rendered.template === "order-shipped" &&
      rendered.shipped.usage_guides !== undefined &&
      !(
        webshopMailUsageGuidesOn(this.environment) &&
        parsed.facts.locale !== "en"
      )
        ? {
            ...rendered,
            shipped: { ...rendered.shipped, usage_guides: undefined },
          }
        : rendered;
    const { stored, template } = found;
    /* every webshop key has a default; a missing one is a code error, a 500 */
    if (!template) throw new Error(`No default template for ${key}`);

    const mail = renderWebshopMail(template, facts);
    if (!mail.ok) throw new UnprocessableEntityException(mail.reason);
    return {
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      customized: stored !== null,
    };
  }
}
