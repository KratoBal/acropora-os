import type { ReactNode } from "react";

/**
 * THE REACT SIDE OF ONE REGISTRY ENTRY. The title and subtitle come from the
 * shared registry (`@acropora/types` `DASHBOARD_WIDGETS`), not from here, so
 * the customize panel and the card can never name a widget differently.
 */
export interface DashboardWidgetView<T> {
  /** The full list behind the card. */
  href?: string;
  /** The empty-state sentence when there is nothing to report, else `null`. */
  emptyMessage: (data: T) => string | null;
  Body: (props: { data: T }) => ReactNode;
}
