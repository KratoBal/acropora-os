import type { DashboardWidgetId } from "@acropora/types";

import { expectedArrivalsWidget } from "./expected-arrivals-widget";
import { maintenanceCalendarWidget } from "./maintenance-calendar-widget";
import { materialRequestsWidget } from "./material-requests-widget";
import { serviceTicketsWidget } from "./service-tickets-widget";
import { tasksWidget } from "./tasks-widget";
import { worksheetsWidget } from "./worksheets-widget";
import type { DashboardWidgetView } from "./widget-view";

/**
 * The React side of the registry: one view per ACTIVE widget. A test checks
 * that every active registry entry has one here, so a widget cannot be
 * switched on in `@acropora/types` without a card to show it.
 */
export const DASHBOARD_WIDGET_VIEWS: Partial<
  Record<DashboardWidgetId, DashboardWidgetView<any>>
> = {
  tasks: tasksWidget,
  "expected-arrivals": expectedArrivalsWidget,
  "service-tickets": serviceTicketsWidget,
  worksheets: worksheetsWidget,
  "material-requests": materialRequestsWidget,
  "maintenance-calendar": maintenanceCalendarWidget,
};
