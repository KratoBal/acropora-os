import {
  formatMoney,
  isNavigationEntryVisible,
  type AuthenticatedUser,
  type SearchGroup,
  type SearchResponse,
} from "@acropora/types";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import {
  NAVIGATION_ENV,
  navigationFeatures,
} from "../auth/navigation-features.js";
import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { InvoiceSearchService } from "../billing/invoice-search.service.js";
import { QuotesService } from "../quotes/quotes.service.js";
import { WebshopOrdersService } from "../orders/webshop-orders/webshop-orders.service.js";
import { AquariumsService } from "../aquariums/aquariums.service.js";
import { ServiceAssetsService } from "../service-assets/service-assets.service.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import { SuppliersService } from "../suppliers/suppliers.service.js";
import { WorksheetsService } from "../worksheets/worksheets.service.js";

const LIMIT = 5;

/**
 * MELYIK MENÜPONT LÁTHATÓSÁGA KAPUZZA AZ EGYES CSOPORTOT (T2.2). Egy csoport akkor jelenik meg, ha a
 * felhasználó a menüpontot látja: ugyanazzal a szabállyal, amivel a lista oldalát. A tábla külön
 * áll, hogy egy teszt egybevethesse a lista vezérlőjének `@RequirePermissions` jogával (a keresés
 * nem mutathat olyat, amit a lista 403-mal adna, és nem rejthet olyat, amit a lista megad).
 */
export const SEARCH_GROUP_NAVIGATION: Record<SearchGroup, string> = {
  tickets: "service-jobs",
  worksheets: "worksheets",
  assets: "service-assets",
  partners: "partners",
  aquariums: "aquariums",
  invoices: "billing",
  // a menüpont feature-höz kötött (`QUOTES_ENABLED`): a keresés a felhasználó feature-jeivel kapuz
  quotes: "quotes",
  // az új (Medusa) webshop rendelései: a `/webshop/rendelesek` lista; a UNAS-lista (`webshop-orders`) nem kereshető
  orders: "webshop-medusa-orders",
};

const DEFAULT_EXTERNAL_GROUP_TIMEOUT_MS = 4000;

/** `SEARCH_EXTERNAL_GROUP_TIMEOUT_MS`: pozitív egész ezredmásodperc, minden más érték az alapérték. */
export function externalGroupTimeoutMs(env: NodeJS.ProcessEnv): number {
  const value = Number(env.SEARCH_EXTERNAL_GROUP_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_EXTERNAL_GROUP_TIMEOUT_MS;
}

const subtitle = (...parts: Array<string | null | undefined>) =>
  parts.filter((part): part is string => Boolean(part)).join(" · ");

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly serviceJobs: ServiceJobsService,
    private readonly worksheets: WorksheetsService,
    private readonly assets: ServiceAssetsService,
    private readonly suppliers: SuppliersService,
    private readonly aquariums: AquariumsService,
    private readonly invoices: InvoiceSearchService,
    private readonly quotes: QuotesService,
    private readonly orders: WebshopOrdersService,
    /**
     * A menü szerver-oldali kapcsolói (`navigationFeatures`): a feature-höz kötött menüpont
     * (például az ajánlat) feature NÉLKÜL MINDENKINEK rejtett, tehát a keresőnek a
     * felhasználó kiszolgált feature-jeit kell átadnia.
     */
    @Optional()
    @Inject(NAVIGATION_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  /**
   * EGY KÜLSŐ FORRÁSBÓL OLVASÓ CSOPORT NEM VIHETI EL AZ EGÉSZ KERESÉST. A rendelés-lista a webshopot
   * (Medusa) hívja minden keresésnél; ha az nem érhető el, a csoport hiányzik a válaszból (és a
   * napló megmondja, miért), a többi csoport viszont megjön. A DB-s csoportok hibája továbbra is
   * hiba: ott egy elnyelt kivétel adatbázis-gondot rejtene.
   *
   * A LÓGÓ HÍVÁS IS KIHAGYÁS: a Medusa-kliensnek nincs kérés-időkorlátja, és a `Promise.all` a
   * leglassabb tagra vár, tehát időkorlát nélkül egy lógó Medusa az egész keresést lógatná (barracuda,
   * #2123). Az időkorlát `SEARCH_EXTERNAL_GROUP_TIMEOUT_MS` (alapból 4000 ms); lejáratkor a csoport
   * ugyanúgy kimarad és naplózódik. A lejárt hívás a háttérben befejeződik (megszakítani nem
   * tudjuk), az eredményét eldobjuk.
   */
  private async isolated<T>(
    group: string,
    read: () => Promise<T>,
  ): Promise<T | undefined> {
    const limit = externalGroupTimeoutMs(this.environment);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`nem válaszolt ${limit} ms alatt`)),
            limit,
          );
        }),
      ]);
    } catch (error) {
      this.logger.warn(
        `A(z) ${group} keresési csoport kimaradt: ${error instanceof Error ? error.message : "ismeretlen hiba"}`,
      );
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async search(input: string | undefined, user: AuthenticatedUser) {
    const query = input?.trim();
    if (!query || query.length < 2) return {} satisfies SearchResponse;

    const features = navigationFeatures(this.environment, user.id);
    const canSee = (entryId: string) =>
      isNavigationEntryVisible(entryId, user, features);

    const [
      tickets,
      worksheets,
      assets,
      partners,
      aquariums,
      invoices,
      quotes,
      orders,
    ] = await Promise.all([
      canSee(SEARCH_GROUP_NAVIGATION.tickets)
        ? this.serviceJobs.list({ search: query }, user)
        : undefined,
      canSee(SEARCH_GROUP_NAVIGATION.worksheets)
        ? this.worksheets.list({ page: 1, pageSize: 10, search: query }, user)
        : undefined,
      canSee(SEARCH_GROUP_NAVIGATION.assets)
        ? this.assets.list(
            { page: 1, pageSize: 10, search: query, status: "ACTIVE" },
            user,
          )
        : undefined,
      canSee(SEARCH_GROUP_NAVIGATION.partners)
        ? this.suppliers.list(
            { page: 1, pageSize: LIMIT, search: query, status: "ACTIVE" },
            partnerScopeOf(user),
          )
        : undefined,
      canSee(SEARCH_GROUP_NAVIGATION.aquariums)
        ? this.aquariums.list({ page: 1, pageSize: 10, search: query }, user)
        : undefined,
      canSee(SEARCH_GROUP_NAVIGATION.invoices)
        ? this.invoices.search(query)
        : undefined,
      canSee(SEARCH_GROUP_NAVIGATION.quotes)
        ? this.quotes.list(user, 1, LIMIT, { q: query })
        : undefined,
      canSee(SEARCH_GROUP_NAVIGATION.orders)
        ? this.isolated("orders", () =>
            this.orders.list({ q: query, page: 1, pageSize: LIMIT }),
          )
        : undefined,
    ]);

    return {
      ...(tickets === undefined
        ? {}
        : {
            tickets: tickets.items.slice(0, LIMIT).map((ticket) => ({
              id: ticket.id,
              title: ticket.title,
              subtitle: subtitle(
                ticket.jobNumber,
                ticket.customerName,
                ticket.departmentPath?.join(" / "),
              ),
              path: `/szerviz/hibajegyek/${ticket.id}`,
            })),
          }),
      ...(worksheets === undefined
        ? {}
        : {
            worksheets: worksheets.items.slice(0, LIMIT).map((worksheet) => ({
              id: worksheet.id,
              title: worksheet.subject,
              subtitle: subtitle(
                worksheet.number,
                worksheet.customerName,
                worksheet.departmentPath?.join(" / ") ??
                  worksheet.departmentCode,
              ),
              path: `/szerviz/munkalapok/${worksheet.id}`,
            })),
          }),
      ...(assets === undefined
        ? {}
        : {
            assets: assets.items.slice(0, LIMIT).map((asset) => ({
              id: asset.id,
              title: asset.name,
              subtitle: subtitle(
                asset.assetNumber,
                asset.owner.displayName,
                asset.unit?.path.join(" / ") ?? asset.address?.formatted,
              ),
              path: `/szerviz/eszkozok/${asset.id}`,
            })),
          }),
      ...(partners === undefined
        ? {}
        : {
            partners: partners.items.slice(0, LIMIT).map((partner) => ({
              id: partner.id,
              title: partner.name,
              subtitle: subtitle(partner.code, partner.city),
              path: `/partnerek/${partner.id}`,
            })),
          }),
      ...(aquariums === undefined
        ? {}
        : {
            aquariums: aquariums.items.slice(0, LIMIT).map((aquarium) => ({
              id: aquarium.id,
              title: aquarium.name,
              subtitle: subtitle(
                aquarium.aquariumNumber,
                aquarium.customerName,
                aquarium.departmentName,
              ),
              path: `/akvariumok/${aquarium.id}`,
            })),
          }),
      ...(invoices === undefined ? {} : { invoices }),
      ...(orders === undefined
        ? {}
        : {
            orders: orders.items.map((order) => ({
              id: order.id,
              title: `Rendelés #${order.displayId}`,
              subtitle: subtitle(
                order.customer.name ?? order.customer.email,
                formatMoney(order.total, order.currency, { fractionDigits: 2 }),
                order.invoiceNumber,
              ),
              path: `/webshop/rendelesek/${encodeURIComponent(order.id)}`,
            })),
          }),
      ...(quotes === undefined
        ? {}
        : {
            quotes: quotes.items.map((quote) => ({
              id: quote.id,
              title: quote.title,
              subtitle: subtitle(
                quote.quoteNumber,
                quote.customerName,
                quote.latestVersion
                  ? formatMoney(
                      quote.latestVersion.netTotal,
                      quote.latestVersion.currency,
                    )
                  : null,
              ),
              path: `/ajanlatok/${quote.id}`,
            })),
          }),
    } satisfies SearchResponse;
  }
}
