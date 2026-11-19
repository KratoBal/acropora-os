import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  parseWebshopGiftCardIssueInput,
  type WebshopGiftCard,
  type WebshopGiftCardDetail,
  type WebshopGiftCardIssued,
} from "@acropora/types";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../integrations/medusa/medusa-connection.types.js";
import { describeCredentialFailure } from "../integrations/medusa/medusa-projection.credentials.js";
import { medusaMessage } from "../webshop-coupons/webshop-coupons.service.js";
import type { MedusaGiftCardClient } from "./webshop-gift-cards.client.js";
import {
  toWebshopGiftCard,
  toWebshopGiftCardTransaction,
} from "./webshop-gift-cards.rules.js";

export const GIFT_CARD_CLIENT = Symbol("GIFT_CARD_CLIENT");
export const GIFT_CARD_ENVIRONMENT = Symbol("GIFT_CARD_ENVIRONMENT");

export type GiftCardClientFactory = () => Promise<MedusaGiftCardClient>;

/**
 * EBBEN A KÖRNYEZETBEN SZABAD-E AJÁNDÉKKÁRTYÁT KIADNI A WEBSHOPBAN (kártya 495c0007; a commerce a teszt kirakatig megy). A
 * kártya pénzt ér, tehát a kiadása írás a boltba: csak ott megy, ahol a `MEDUSA_WEBSHOP_GIFT_CARDS=true` áll (a teszt
 * OS-ben). Saját kapcsoló, mint a díjaké: egy kapcsoló ne jelentsen két dolgot. Ahol nincs, a végpontok 404-et adnak.
 */
export function giftCardsAllowed(
  env: Record<string, string | undefined>,
): boolean {
  return env.MEDUSA_WEBSHOP_GIFT_CARDS === "true";
}

@Injectable()
export class WebshopGiftCardsService {
  constructor(
    @Inject(GIFT_CARD_CLIENT) private readonly client: GiftCardClientFactory,
    @Inject(GIFT_CARD_ENVIRONMENT)
    private readonly environment: Record<string, string | undefined>,
  ) {}

  private requireAllowed() {
    if (!giftCardsAllowed(this.environment)) throw new NotFoundException();
  }

  /** A webshop hibája az ember nyelvén; a kulcs és a fejlécek sosem kerülnek a válaszba. */
  private async call<T>(
    fn: (client: MedusaGiftCardClient) => Promise<T>,
  ): Promise<T> {
    let client: MedusaGiftCardClient;
    try {
      client = await this.client();
    } catch (error) {
      if (error instanceof MedusaConnectionError)
        throw new ServiceUnavailableException(describeCredentialFailure(error));
      throw error;
    }
    try {
      return await fn(client);
    } catch (error) {
      if (error instanceof MedusaAdminHttpError) {
        if (error.status === 404)
          throw new NotFoundException(
            "Nincs ilyen ajándékkártya a webshopban.",
          );
        if (error.status === 400)
          throw new BadRequestException(
            `A webshop elutasította: ${medusaMessage(error.body)}`,
          );
        throw new ServiceUnavailableException(
          `A webshop most nem érhető el (HTTP ${error.status}).`,
        );
      }
      throw error;
    }
  }

  async list(): Promise<{ giftCards: WebshopGiftCard[]; truncated: boolean }> {
    this.requireAllowed();
    return this.call(async (client) => {
      const answer = await client.list();
      return {
        giftCards: (answer.gift_cards ?? []).map(toWebshopGiftCard),
        truncated: !!answer.truncated,
      };
    });
  }

  async get(id: string): Promise<WebshopGiftCardDetail> {
    this.requireAllowed();
    return this.call(async (client) => {
      const card = await client.get(id);
      return {
        ...toWebshopGiftCard(card),
        transactions: (card.transactions ?? []).map(
          toWebshopGiftCardTransaction,
        ),
      };
    });
  }

  /** A kiadás: a teljes kód csak ebben a válaszban van; az OS sem tárolja. */
  async issue(raw: unknown): Promise<WebshopGiftCardIssued> {
    this.requireAllowed();
    const parsed = parseWebshopGiftCardIssueInput(raw);
    if (!parsed.ok)
      throw new BadRequestException({
        message: "A kártya adatai hibásak.",
        errors: parsed.errors,
      });
    return this.call(async (client) => {
      const answer = await client.issue({
        amount: parsed.value.amount,
        recipient_email: parsed.value.recipientEmail,
        note: parsed.value.note,
      });
      return {
        giftCard: toWebshopGiftCard(answer.gift_card),
        code: answer.code,
      };
    });
  }

  async disable(id: string): Promise<WebshopGiftCard> {
    this.requireAllowed();
    return this.call(async (client) =>
      toWebshopGiftCard(await client.disable(id)),
    );
  }
}
