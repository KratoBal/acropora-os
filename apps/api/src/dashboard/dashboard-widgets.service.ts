import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import {
  availableDashboardWidgets,
  availableStarterLayouts,
  dashboardWidget,
  dashboardWidgetInfo,
  isDashboardWidgetAvailable,
  isDashboardWidgetId,
  resolveDashboardLayout,
  sanitizeDashboardLayoutInput,
  type AuthenticatedUser,
  type DashboardAttentionWidgetData,
  type DashboardExpectedArrivalsWidgetData,
  type DashboardLayoutResponse,
  type DashboardViewer,
  type DashboardWidgetId,
  type DashboardWidgetResult,
  type DashboardWidgetsResponse,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { StockReconciliationService } from "../inventory/stock-reconciliation.service.js";
import { UnasStockSyncOutboxRepository } from "../inventory/unas-stock-sync-outbox.repository.js";
import { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import { ExpectedArrivalService } from "../purchasing/expected-arrivals/expected-arrival.service.js";
import { assignedUnitIdsFor } from "../service-jobs/assigned-units.query.js";
import { aquariumFindings } from "./aquarium-findings.js";
import {
  ATTENTION_SOURCES,
  attentionItemsOf,
  sortAttentionItems,
} from "./attention.js";
import { DashboardAquariumWidgetsRepository } from "./dashboard-aquarium-widgets.repository.js";
import { DashboardFinanceWidgetsRepository } from "./dashboard-finance-widgets.repository.js";
import { DashboardLayoutRepository } from "./dashboard-layout.repository.js";
import { DashboardSystemWidgetsRepository } from "./dashboard-system-widgets.repository.js";
import { MissingInvoicesSummaryCache } from "./missing-invoices-summary.js";
import { summarizeOverdueInvoices } from "./overdue-invoices.js";
import { stockDiscrepancies, stockSyncOutboxState } from "./stock-widgets.js";
import {
  DashboardServiceWidgetsRepository,
  type ServiceWidgetViewer,
} from "./dashboard-service-widgets.repository.js";

/** What every failed widget says instead of a number. Never a zero. */
export const WIDGET_UNAVAILABLE_MESSAGE = "Az adat jelenleg nem elérhető.";
const LATEST_ARRIVALS = 3;

/**
 * What a loader gets besides the user: the viewer, and the OTHER widgets'
 * data, memoized for this one request (Figyelmet igényel reads the cards'
 * own figures without querying twice).
 */
export interface WidgetLoadContext {
  viewer: DashboardViewer;
  load(id: DashboardWidgetId): Promise<unknown>;
}

type WidgetLoader = (
  user: AuthenticatedUser,
  context: WidgetLoadContext,
) => Promise<unknown>;

/** Replaceable in tests: a loader per ACTIVE widget id. */
export const DASHBOARD_WIDGET_LOADERS = Symbol("DASHBOARD_WIDGET_LOADERS");

/**
 * THE CONFIGURABLE DASHBOARD (`docs/dashboard/v1-discovery.md` 7. pont).
 *
 * Two jobs, both behind the registry in `@acropora/types`:
 *   - the user's layout: read (stored, else the role preset, always
 *     re-filtered), write (strictly validated), reset (the row goes);
 *   - the widgets' data in ONE grouped call. Every requested widget is
 *     checked here, on the server, against the same rule as the layout: a
 *     client asking for a widget its user may not have gets `forbidden`, not
 *     data. Hiding a card in the browser is never the authorization.
 *
 * One failing source does not blank the page: each widget settles on its own,
 * and a failure is `error` with a message, never a zero.
 */
@Injectable()
export class DashboardWidgetsService {
  private readonly logger = new Logger(DashboardWidgetsService.name);
  private readonly loaders: Partial<Record<DashboardWidgetId, WidgetLoader>>;
  private readonly missingInvoicesCache: MissingInvoicesSummaryCache;

  constructor(
    private readonly repository: DashboardLayoutRepository,
    private readonly expectedArrivals: ExpectedArrivalService,
    private readonly serviceWidgets: DashboardServiceWidgetsRepository,
    private readonly aquariumWidgets: DashboardAquariumWidgetsRepository,
    private readonly financeWidgets: DashboardFinanceWidgetsRepository,
    missingInvoices: MissingInvoicesService,
    private readonly reconciliation: StockReconciliationService,
    private readonly outbox: UnasStockSyncOutboxRepository,
    private readonly systemWidgets: DashboardSystemWidgetsRepository,
    @Optional()
    @Inject(DASHBOARD_WIDGET_LOADERS)
    loaders?: Partial<Record<DashboardWidgetId, WidgetLoader>>,
  ) {
    this.missingInvoicesCache = new MissingInvoicesSummaryCache(() =>
      missingInvoices.months(),
    );
    this.loaders = loaders ?? this.defaultLoaders();
  }

  async layout(user: AuthenticatedUser): Promise<DashboardLayoutResponse> {
    const viewer = await this.viewer(user);
    const stored = await this.repository.findLayout(user.id);
    return this.response(viewer, stored);
  }

  async saveLayout(
    user: AuthenticatedUser,
    body: unknown,
  ): Promise<DashboardLayoutResponse> {
    const viewer = await this.viewer(user);
    const widgets =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).widgets
        : undefined;
    const result = sanitizeDashboardLayoutInput(viewer, widgets);
    if (!result.ok) throw new BadRequestException(result.errors);
    await this.repository.saveLayout(user.id, result.widgets);
    return this.response(viewer, result.widgets);
  }

  async resetLayout(user: AuthenticatedUser): Promise<DashboardLayoutResponse> {
    const viewer = await this.viewer(user);
    await this.repository.deleteLayout(user.id);
    return this.response(viewer, null);
  }

  /**
   * The data of the requested widgets, each with its own result.
   *
   * AN UNKNOWN ID IS "unavailable", NOT A FAILED REQUEST (owner, 2026-10-02).
   * Clients and server are released apart: an older phone build may still ask
   * for an id this server no longer has, and a newer one for an id this
   * server does not have yet. Refusing the whole request then took every
   * other widget down with it. Only that id answers "unavailable"; nothing is
   * loaded for it.
   */
  async widgets(
    user: AuthenticatedUser,
    requested: readonly string[],
  ): Promise<DashboardWidgetsResponse> {
    const unique = [...new Set(requested)];
    const unknown = unique.filter((id) => !isDashboardWidgetId(id));
    const ids = unique.filter(isDashboardWidgetId);
    const viewer = await this.viewer(user);
    const memo = new Map<DashboardWidgetId, Promise<unknown>>();
    const context: WidgetLoadContext = {
      viewer,
      load: (id) => {
        let pending = memo.get(id);
        if (!pending) {
          const loader = this.loaders[id];
          pending = loader
            ? loader(user, context)
            : Promise.reject(new Error(`No loader for "${id}".`));
          memo.set(id, pending);
        }
        return pending;
      },
    };

    const settled = await Promise.all(
      ids.map(
        async (id): Promise<[DashboardWidgetId, DashboardWidgetResult]> => {
          const definition = dashboardWidget(id);
          if (definition.availability !== "active")
            return [id, { status: "unavailable" }];
          if (!isDashboardWidgetAvailable(definition, viewer))
            return [id, { status: "forbidden" }];
          if (!this.loaders[id]) return [id, { status: "unavailable" }];
          try {
            return [id, { status: "ok", data: await context.load(id) }];
          } catch (error) {
            this.logger.warn(
              `Dashboard widget "${id}" failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return [
              id,
              { status: "error", message: WIDGET_UNAVAILABLE_MESSAGE },
            ];
          }
        },
      ),
    );
    return {
      results: {
        ...Object.fromEntries(
          unknown.map((id) => [id, { status: "unavailable" } as const]),
        ),
        ...Object.fromEntries(settled),
      },
    };
  }

  private async viewer(user: AuthenticatedUser): Promise<DashboardViewer> {
    return {
      // a személy saját listája is (ha a szerver kitöltötte), nem csak a szerepe
      role: user.role,
      permissions: user.permissions,
      capabilities: await this.repository.capabilities(user.id),
    };
  }

  private response(
    viewer: DashboardViewer,
    stored: unknown,
  ): DashboardLayoutResponse {
    return {
      ...resolveDashboardLayout(viewer, stored),
      available: availableDashboardWidgets(viewer).map(dashboardWidgetInfo),
      starterLayouts: availableStarterLayouts(viewer),
    };
  }

  private defaultLoaders(): Partial<Record<DashboardWidgetId, WidgetLoader>> {
    return {
      tasks: (user) => this.repository.tasksWidget(user.id),
      "expected-arrivals": () => this.expectedArrivalsWidget(),
      "service-tickets": async (user) =>
        this.serviceWidgets.serviceTickets(await serviceViewer(user)),
      worksheets: async (user) =>
        this.serviceWidgets.worksheets(await serviceViewer(user)),
      "material-requests": async (user) =>
        this.serviceWidgets.materialRequests(await serviceViewer(user)),
      "maintenance-calendar": async (user) =>
        this.serviceWidgets.maintenanceCalendar(
          await serviceViewer(user),
          new Date(),
        ),
      "aquarium-alerts": async (user) =>
        aquariumFindings(
          await this.aquariumWidgets.readings(await serviceViewer(user)),
          new Date(),
        ).alerts,
      "water-values": async (user) =>
        aquariumFindings(
          await this.aquariumWidgets.readings(await serviceViewer(user)),
          new Date(),
        ).waterValues,
      "aquarium-equipment": async (user) =>
        this.aquariumWidgets.equipment(await serviceViewer(user), new Date()),
      "overdue-invoices": async () => {
        const now = new Date();
        return summarizeOverdueInvoices(
          await this.financeWidgets.overdueInvoiceRows(now, 7),
          now,
        );
      },
      "missing-invoices": () => this.missingInvoicesCache.summary(),
      "incoming-invoices": () => this.financeWidgets.incomingInvoices(),
      settlements: () => this.financeWidgets.settlements(),
      "stock-reconciliation": () => stockDiscrepancies(this.reconciliation),
      "stock-sync-outbox": () => stockSyncOutboxState(this.outbox),
      "jev-intelligence": () => this.systemWidgets.jevIntelligence(new Date()),
      "system-status": () => this.systemWidgets.systemStatus(new Date()),
      attention: (_, context) => this.attentionWidget(context),
    };
  }

  /**
   * Figyelmet igényel: the figures of the source widgets the user may see,
   * each through its own loader. A source that fails is named as
   * unavailable, never counted as zero; one the user may not see is skipped
   * without being loaded.
   */
  private async attentionWidget(
    context: WidgetLoadContext,
  ): Promise<DashboardAttentionWidgetData> {
    const visible = ATTENTION_SOURCES.filter((id) => {
      const definition = dashboardWidget(id);
      return (
        definition.availability === "active" &&
        isDashboardWidgetAvailable(definition, context.viewer) &&
        this.loaders[id] !== undefined
      );
    });
    const settled = await Promise.allSettled(
      visible.map((id) => context.load(id)),
    );
    const data: DashboardAttentionWidgetData = { items: [], unavailable: [] };
    settled.forEach((result, index) => {
      const id = visible[index]!;
      if (result.status === "fulfilled")
        data.items.push(...attentionItemsOf(id, result.value));
      else
        data.unavailable.push({
          widgetId: id,
          title: dashboardWidget(id).title,
        });
    });
    data.items = sortAttentionItems(data.items);
    return data;
  }

  /**
   * Várható beérkezések, from the SAME list the purchasing page shows
   * (`ExpectedArrivalService.list()`), so the two can never disagree. There
   * is no ETA field: the stage and the arrival of the document are shown.
   */
  private async expectedArrivalsWidget(): Promise<DashboardExpectedArrivalsWidgetData> {
    const { items } = await this.expectedArrivals.list();
    const byStage = { PROFORMA: 0, INVOICE: 0, LATE_CORRECTION: 0 };
    for (const item of items) byStage[item.stage] += 1;
    return {
      count: items.length,
      byStage,
      latest: items.slice(0, LATEST_ARRIVALS).map((item) => ({
        supplierName: item.supplierName,
        stage: item.stage,
        arrivedAt: item.arrivedAt,
      })),
    };
  }
}

/** The scope every service widget query is filtered by: the list pages' own. */
async function serviceViewer(
  user: AuthenticatedUser,
): Promise<ServiceWidgetViewer> {
  return {
    userId: user.id,
    role: user.role,
    scope: partnerScopeOf(user),
    assignedUnitIds: await assignedUnitIdsFor(user.id),
  };
}
