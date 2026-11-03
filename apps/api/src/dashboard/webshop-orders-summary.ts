import type {
  DashboardWebshopOrdersWidgetData,
  WebshopOrderListResponse,
} from "@acropora/types";

/** The same 5 minutes as the missing-invoice check (owner decision, PR #1379). */
export const WEBSHOP_ORDERS_CACHE_MS = 5 * 60 * 1000;

/**
 * Webshop rendelési sor: the open view's counters, exactly the ones the order list shows
 * (`WebshopOrdersService.list`), so the card and the list can never disagree. The list reads
 * every order from the webshop, hence the cache in the service.
 */
export function toWebshopOrdersWidgetData(
  response: WebshopOrderListResponse,
): DashboardWebshopOrdersWidgetData {
  return { counters: response.counters, truncated: response.truncated };
}
