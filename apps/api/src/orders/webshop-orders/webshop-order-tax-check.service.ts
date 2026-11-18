import { Injectable, Logger } from "@nestjs/common";
import type { WebshopOrderTaxCheck } from "@acropora/types";

import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import { NavTaxpayerService } from "../../integrations/nav/nav-taxpayer.service.js";
import {
  navNameMatches,
  orderCompanyName,
  orderTaxNumberShape,
} from "./webshop-order-tax-check.rules.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

const NONE: WebshopOrderTaxCheck = {
  state: "NONE",
  taxNumber: null,
  navName: null,
  nameMatches: null,
};

/**
 * A RENDELÉS ADÓSZÁMÁNAK ELLENŐRZÉSE A NAV-NÁL (kártya c977aed2, P2; acrobot 2026-11-18 23:11: a kirakat pénztáráról nincs valós
 * idejű NAV-hívás, a számla kiállítása előtti ellenőrzés fedi a számla helyességét). A meglévő `NavTaxpayerService` (a NAV
 * technikai felhasználója az OS-ben van), CSAK OLVAS, új titok nincs.
 *
 * A NAV KIESÉSE NEM HIBA A RENDELÉSRE: bármi, ami nem a NAV egyértelmű válasza (nincs beállított kapcsolat, időtúllépés, NAV-hiba),
 * UNAVAILABLE, és nem állítja meg a számlát; a napló a hiba nevét viszi, a szöveget nem (vevőadat, kulcs-töredék).
 */
@Injectable()
export class WebshopOrderTaxCheckService {
  private readonly logger = new Logger(WebshopOrderTaxCheckService.name);

  constructor(
    private readonly nav: NavTaxpayerService,
    private readonly orders: WebshopOrdersService,
  ) {}

  /** Egy rendelés (a webshopból olvasva) adószámának ellenőrzése. */
  async checkOrder(orderId: string): Promise<WebshopOrderTaxCheck> {
    const { order } = await this.orders.source(orderId);
    return this.check(order);
  }

  async check(order: MedusaOrderDetailRow): Promise<WebshopOrderTaxCheck> {
    const shape = orderTaxNumberShape(order);
    if (shape.kind === "MALFORMED")
      return {
        state: "MALFORMED",
        taxNumber: shape.raw,
        navName: null,
        nameMatches: null,
      };
    if (shape.kind !== "HU") return NONE;
    const taxNumber = shape.taxNumber;
    try {
      const answer = await this.nav.lookup(taxNumber);
      if (!answer.valid)
        return {
          state: "INVALID",
          taxNumber,
          navName: null,
          nameMatches: null,
        };
      const navName = answer.data?.name?.trim() || null;
      return {
        state: "VALID",
        taxNumber,
        navName,
        nameMatches: navNameMatches(orderCompanyName(order), navName),
      };
    } catch (error) {
      this.logger.warn(
        `NAV taxpayer check of an order unavailable: ${error instanceof Error ? error.name : "unknown"}`,
      );
      return {
        state: "UNAVAILABLE",
        taxNumber,
        navName: null,
        nameMatches: null,
      };
    }
  }
}
