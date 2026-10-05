import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { WebshopStuckMail, WebshopStuckMailList } from "@acropora/types";

import { MedusaAdminHttpError } from "../../integrations/medusa/medusa-admin.client.js";
import {
  WebshopOrdersService,
  webshopErrorMessage,
} from "./webshop-orders.service.js";

/** One page of the stuck list on the Levélsablonok page. */
export const STUCK_MAIL_PAGE = 50;

/**
 * THE WEBSHOP MAILS THAT DID NOT GO OUT, ON THE LEVÉLSABLONOK PAGE.
 *
 * Balazs's decision (2026-10-05 20:11 UTC): no fallback mail. A mail the OS
 * cannot render waits in the webshop's queue, and one stuck for more than an
 * hour is raised here and to acrobot. The queue is the webshop's (commerce
 * W2); this reads it, and puts a mail back once its template is fixed.
 */
@Injectable()
export class WebshopMailOutboxService {
  constructor(private readonly orders: WebshopOrdersService) {}

  async stuck(offset = 0): Promise<WebshopStuckMailList> {
    const client = await this.orders.adminClient();
    try {
      return await client.stuckMails({ limit: STUCK_MAIL_PAGE, offset });
    } catch (error) {
      /*
        A 404 HERE IS A MISSING ENDPOINT, NOT A MISSING MAIL: a webshop
        without the queue (before commerce W2 is out) answers the list so.
        Any refusal of the list therefore reads as "not readable now".
      */
      if (error instanceof MedusaAdminHttpError)
        throw new ServiceUnavailableException(
          `A webshop levél-sora most nem érhető el (HTTP ${error.status}).`,
        );
      throw error;
    }
  }

  async retry(id: string): Promise<WebshopStuckMail> {
    const client = await this.orders.adminClient();
    try {
      return await client.retryStuckMail(id);
    } catch (error) {
      throw this.refusal(error);
    }
  }

  /** The webshop's own sentence where it gave one; the status otherwise. */
  private refusal(error: unknown): unknown {
    if (!(error instanceof MedusaAdminHttpError)) return error;
    const message = webshopErrorMessage(error.body);
    if (error.status === 404)
      return new NotFoundException(
        message ?? "Nincs ilyen levél a webshop levél-sorában.",
      );
    if (error.status === 409)
      return new ConflictException(
        message ?? "Ez a levél már kiment, nem kell újra sorba tenni.",
      );
    return new ServiceUnavailableException(
      `A webshop levél-sora most nem érhető el (HTTP ${error.status}).`,
    );
  }
}
