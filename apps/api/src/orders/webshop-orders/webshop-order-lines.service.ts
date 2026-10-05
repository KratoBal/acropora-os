import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  WebshopOrderDetail,
  WebshopOrderLineEdit,
  WebshopVariantOption,
} from "@acropora/types";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import {
  WebshopOrdersService,
  webshopErrorMessage,
} from "./webshop-orders.service.js";

const KIND_LABEL: Record<WebshopOrderLineEdit["kind"], string> = {
  quantity: "mennyiség",
  remove: "törlés",
  replace: "csere",
};

/**
 * A TÉTELMŰVELETEK (Rendelések, 6. PR): mennyiség, csere, törlés, soronként.
 * A rendelés a webshopé, ezért a művelet a Medusa saját szerkesztési útján
 * megy: megnyitás, a változás, kérés, megerősítés. A megerősítés előtt a
 * commerce őre áll: a kártyás zárolás megmarad, a levonás a Kiszállításkor
 * megy, a csökkentett összegre (commerce #482).
 *
 * HA EGY LÉPÉS ELBUKIK a megnyitás után, a szerkesztést visszavonjuk, hogy ne
 * maradjon félbehagyott változás a webshopban (a következő művelet különben
 * „már folyamatban van” hibán állna meg).
 */
@Injectable()
export class WebshopOrderLinesService {
  private readonly logger = new Logger(WebshopOrderLinesService.name);

  constructor(
    private readonly orders: WebshopOrdersService,
    private readonly repository: WebshopOrdersRepository,
  ) {}

  async edit(
    orderId: string,
    itemId: string,
    edit: WebshopOrderLineEdit,
    user: AuthenticatedUser,
    now = new Date(),
  ): Promise<WebshopOrderDetail> {
    const detail = await this.orders.detail(orderId, now);
    if (!detail.lineEdit.allowed)
      throw new ConflictException(detail.lineEdit.reason);
    const line = detail.lines.find((candidate) => candidate.id === itemId);
    if (!line)
      throw new NotFoundException("A tétel nem található a rendelésen.");

    if (
      edit.kind !== "remove" &&
      !(Number.isInteger(edit.quantity) && edit.quantity >= 1)
    )
      throw new BadRequestException("A mennyiség legalább 1 egész darab.");
    if (edit.kind === "quantity" && edit.quantity === line.quantity)
      return detail;
    if (edit.kind === "remove" && detail.lines.length === 1)
      throw new ConflictException(
        "Az utolsó tétel nem törölhető: ilyenkor a rendelést kell lezárni (Sikertelenül lezárt rendelés).",
      );

    const client = await this.orders.adminClient();
    try {
      await client.beginOrderEdit(
        orderId,
        `OS: ${KIND_LABEL[edit.kind]} · ${line.title}`,
      );
    } catch (error) {
      throw this.webshopError(
        error,
        "A tétel nem változott: a webshop nem nyitotta meg a szerkesztést",
      );
    }
    try {
      if (edit.kind === "quantity")
        await client.setOrderEditItemQuantity(orderId, itemId, edit.quantity);
      else if (edit.kind === "remove")
        await client.setOrderEditItemQuantity(orderId, itemId, 0);
      else {
        await client.setOrderEditItemQuantity(orderId, itemId, 0);
        await client.addOrderEditItem(orderId, edit.variantId, edit.quantity);
      }
      await client.requestOrderEdit(orderId);
      await client.confirmOrderEdit(orderId);
    } catch (error) {
      await this.cancel(client, orderId);
      throw this.webshopError(
        error,
        "A tétel nem változott. A webshop válasza",
      );
    }

    await this.repository.recordLineEdit({
      userId: user.id,
      orderId,
      itemId,
      title: line.title,
      before: line.quantity,
      edit,
    });
    return this.orders.detail(orderId, now);
  }

  /** Változatok a cseréhez, név vagy cikkszám szerint. */
  async variants(query: string): Promise<WebshopVariantOption[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const client = await this.orders.adminClient();
    try {
      const rows = await client.searchVariants(trimmed);
      return rows.map((row) => {
        const product = row.product?.title?.trim() || null;
        const variant =
          row.title && !/^default/i.test(row.title) && row.title !== product
            ? row.title
            : null;
        return {
          variantId: row.id,
          title: [product, variant].filter(Boolean).join(" · ") || row.id,
          sku: row.sku,
        };
      });
    } catch (error) {
      throw this.webshopError(error, "A webshop nem adta ki a termékeket");
    }
  }

  private async cancel(client: MedusaAdminClient, orderId: string) {
    try {
      await client.cancelOrderEdit(orderId);
    } catch (error) {
      // a visszavonás hibája nem takarja el az eredeti okot; naplóba megy
      this.logger.warn(
        `order edit of ${orderId} could not be cancelled: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private webshopError(error: unknown, prefix: string) {
    if (error instanceof MedusaAdminHttpError && error.status < 500)
      return new UnprocessableEntityException(
        `${prefix}: ${webshopErrorMessage(error.body) ?? `HTTP ${error.status}`}`,
      );
    if (error instanceof MedusaAdminHttpError)
      return new ServiceUnavailableException(
        `${prefix} (a webshop nem érhető el, HTTP ${error.status}).`,
      );
    return error;
  }
}
