import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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
export const GIFT_CARD_AUDIT = Symbol("GIFT_CARD_AUDIT");

/** The audit table as the service uses it: the `prisma` client in the module, a fake in the spec. */
export type GiftCardAudit = {
  auditLog: {
    create(args: {
      data: {
        userId: string;
        action: string;
        entityType: string;
        entityId: string | null;
        metadata: Record<string, string | number>;
      };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: { entityId: string; metadata: Record<string, string | number> };
    }): Promise<unknown>;
  };
};

export const GIFT_CARD_AUDIT_ENTITY = "WebshopGiftCard";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
    @Inject(GIFT_CARD_AUDIT) private readonly audit: GiftCardAudit,
  ) {}

  private readonly logger = new Logger(WebshopGiftCardsService.name);

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

  /**
   * A kiadás: a teljes kód csak ebben a válaszban van; az OS sem tárolja.
   *
   * KI ADTA KI (barracuda, #2737; az éles bekapcsolás feltétele). A webshop a hívót az OS közös kulcsaként látja, tehát
   * az embert az OS naplója nevezi meg. A sor a webshop-hívás ELŐTT íródik (a felhasználó és a kért összeg), és ha az
   * nem megy, kiadás sincs: pénz nem keletkezhet név nélkül. A sikeres kiadás után a sor megkapja a kártya azonosítóját;
   * ha EZ bukik el, csak naplózódik, mert a kártya már létezik, és a kódja máshol nem látszana.
   */
  async issue(raw: unknown, userId: string): Promise<WebshopGiftCardIssued> {
    this.requireAllowed();
    const parsed = parseWebshopGiftCardIssueInput(raw);
    if (!parsed.ok)
      throw new BadRequestException({
        message: "A kártya adatai hibásak.",
        errors: parsed.errors,
      });
    const row = await this.audit.auditLog.create({
      data: {
        userId,
        action: "webshop_gift_card.issue",
        entityType: GIFT_CARD_AUDIT_ENTITY,
        entityId: null,
        metadata: { amount: parsed.value.amount, status: "requested" },
      },
    });
    const issued = await this.call(async (client) => {
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
    try {
      await this.audit.auditLog.update({
        where: { id: row.id },
        data: {
          entityId: issued.giftCard.id,
          metadata: {
            amount: issued.giftCard.initialAmount,
            status: "issued",
            codeLast4: issued.giftCard.codeLast4,
          },
        },
      });
    } catch (error) {
      this.logger.error(
        `Gift card ${issued.giftCard.id} issued by user ${userId}, but audit row ${row.id} was not completed: ${errorText(error)}`,
      );
    }
    return issued;
  }

  /** A kikapcsolás is a felhasználó nevén áll a naplóban; a kártya ekkor már ki van kapcsolva, tehát a napló-hiba csak naplózódik. */
  async disable(id: string, userId: string): Promise<WebshopGiftCard> {
    this.requireAllowed();
    const card = await this.call(async (client) =>
      toWebshopGiftCard(await client.disable(id)),
    );
    try {
      await this.audit.auditLog.create({
        data: {
          userId,
          action: "webshop_gift_card.disable",
          entityType: GIFT_CARD_AUDIT_ENTITY,
          entityId: card.id,
          metadata: { balance: card.balance, codeLast4: card.codeLast4 },
        },
      });
    } catch (error) {
      this.logger.error(
        `Gift card ${card.id} disabled by user ${userId}, but its audit row was not written: ${errorText(error)}`,
      );
    }
    return card;
  }
}
