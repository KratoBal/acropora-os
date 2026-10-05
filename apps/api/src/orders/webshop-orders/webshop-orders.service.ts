import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  WebshopOrderListQuery,
  WebshopOrderListResponse,
} from "@acropora/types";

import {
  MedusaAdminHttpError,
  MedusaConfigurationError,
  medusaClientFromEnvironment,
  type MedusaAdminClient,
  type MedusaOrderOverviewRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../../integrations/medusa/medusa-connection.types.js";
import { MedusaCredentialProvider } from "../../integrations/medusa/medusa-credential.provider.js";
import {
  NO_FACTS,
  applyFilters,
  countersOf,
  distinctSorted,
  inView,
  sortItems,
  toListItem,
} from "./webshop-orders.rules.js";

/** Egy lap a webshopból; ennyi lapot olvasunk egy körben. */
export const OVERVIEW_PAGE_SIZE = 100;
export const OVERVIEW_MAX_PAGES = 10;

/**
 * A WEBSHOP RENDELÉSLISTÁJA AZ OS-BEN. A rendelés a webshopé: minden kérés
 * onnan olvas (`GET /admin/order-overview`), és itt szűr, rendez és lapoz.
 *
 * MIÉRT AZ OS SZŰR, ÉS NEM A WEBSHOP: a szűrők egy része az OS saját adatán áll
 * (számla, és később a küldemény), a webshop azt nem ismeri. A webshop ma
 * néhány tucat rendelést tart; ha a körönkénti határ (`OVERVIEW_MAX_PAGES` ×
 * `OVERVIEW_PAGE_SIZE`) elé ér, a válasz `truncated` jelzéssel mondja meg.
 */
@Injectable()
export class WebshopOrdersService {
  constructor(
    private readonly credentials: MedusaCredentialProvider,
    @Optional()
    private readonly clientFactory: (
      apiKey: string,
    ) => MedusaAdminClient = medusaClientFromEnvironment,
  ) {}

  private async client(): Promise<MedusaAdminClient> {
    try {
      const resolved = await this.credentials.resolve();
      return this.clientFactory(resolved.apiKey);
    } catch (error) {
      if (
        error instanceof MedusaConnectionError ||
        error instanceof MedusaConfigurationError
      )
        throw new ServiceUnavailableException(
          "A webshop kapcsolata nincs beállítva (Beállítások, Medusa kapcsolat).",
        );
      throw error;
    }
  }

  private async readAll(): Promise<{
    rows: MedusaOrderOverviewRow[];
    truncated: boolean;
  }> {
    const client = await this.client();
    const rows: MedusaOrderOverviewRow[] = [];
    try {
      for (let index = 0; index < OVERVIEW_MAX_PAGES; index++) {
        const page = await client.orderOverview({
          limit: OVERVIEW_PAGE_SIZE,
          offset: index * OVERVIEW_PAGE_SIZE,
        });
        rows.push(...page.orders);
        if (rows.length >= page.count || page.orders.length === 0)
          return { rows, truncated: false };
      }
    } catch (error) {
      if (error instanceof MedusaAdminHttpError)
        throw new ServiceUnavailableException(
          `A webshop nem adta ki a rendeléseket (HTTP ${error.status}).`,
        );
      throw error;
    }
    return { rows, truncated: true };
  }

  async list(
    query: WebshopOrderListQuery,
    now = new Date(),
  ): Promise<WebshopOrderListResponse> {
    const { rows, truncated } = await this.readAll();
    const items = rows.map((row) => toListItem(row, NO_FACTS, now));
    const viewed = inView(items, query.view);
    const filtered = sortItems(
      applyFilters(viewed, query),
      query.sort,
      query.direction,
    );
    const pageSize = query.pageSize ?? 50;
    const page = query.page ?? 1;
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
      counters: countersOf(viewed),
      shippingMethods: distinctSorted(
        items.map((item) => item.shipping.method),
      ),
      paymentMethods: distinctSorted(items.map((item) => item.payment.method)),
      truncated,
    };
  }
}
