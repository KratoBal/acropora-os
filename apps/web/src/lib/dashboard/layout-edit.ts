import type {
  DashboardLayoutEntry,
  DashboardLayoutUpdate,
  DashboardWidgetId,
} from "@acropora/types";

/**
 * THE CUSTOMIZE PANEL'S EDITS, as pure functions over the resolved layout.
 * The panel never invents a widget: it only rearranges the entries the API
 * returned, and the API validates the result again on save.
 */

/** Enabled entries in display order. */
export function enabledWidgets(
  entries: readonly DashboardLayoutEntry[],
): DashboardLayoutEntry[] {
  return entries
    .filter((entry) => entry.enabled)
    .sort((a, b) => a.order - b.order);
}

/** Switch a widget on (to the end of the enabled ones) or off. */
export function toggleWidget(
  entries: readonly DashboardLayoutEntry[],
  widgetId: DashboardWidgetId,
): DashboardLayoutEntry[] {
  const target = entries.find((entry) => entry.widgetId === widgetId);
  if (!target) return [...entries];
  const enabled = enabledWidgets(entries).filter(
    (e) => e.widgetId !== widgetId,
  );
  const disabled = entries
    .filter((entry) => !entry.enabled && entry.widgetId !== widgetId)
    .sort((a, b) => a.order - b.order);
  const next = target.enabled
    ? [...enabled, { ...target, enabled: false }, ...disabled]
    : [...enabled, { ...target, enabled: true }, ...disabled];
  return renumber(next);
}

/** Move an enabled widget one place up (-1) or down (+1). */
export function moveWidget(
  entries: readonly DashboardLayoutEntry[],
  widgetId: DashboardWidgetId,
  direction: -1 | 1,
): DashboardLayoutEntry[] {
  const enabled = enabledWidgets(entries);
  const index = enabled.findIndex((entry) => entry.widgetId === widgetId);
  const swapWith = index + direction;
  if (index < 0 || swapWith < 0 || swapWith >= enabled.length)
    return [...entries];
  const moved = [...enabled];
  [moved[index], moved[swapWith]] = [moved[swapWith]!, moved[index]!];
  const disabled = entries
    .filter((entry) => !entry.enabled)
    .sort((a, b) => a.order - b.order);
  return renumber([...moved, ...disabled]);
}

/** The body the API's PUT expects. */
export function layoutUpdate(
  entries: readonly DashboardLayoutEntry[],
): DashboardLayoutUpdate {
  return {
    widgets: entries.map(({ widgetId, enabled, order, size }) => ({
      widgetId,
      enabled,
      order,
      size,
    })),
  };
}

function renumber(entries: DashboardLayoutEntry[]): DashboardLayoutEntry[] {
  return entries.map((entry, order) => ({ ...entry, order }));
}

/**
 * A starter layout (e.g. "Akváriumfelelős"): its widgets on, in its order,
 * everything else off. Only ids the API listed as available are touched.
 */
export function applyStarterLayout(
  entries: readonly DashboardLayoutEntry[],
  widgetIds: readonly DashboardWidgetId[],
): DashboardLayoutEntry[] {
  const byId = new Map(entries.map((entry) => [entry.widgetId, entry]));
  const enabled = widgetIds
    .filter((id, index) => byId.has(id) && widgetIds.indexOf(id) === index)
    .map((id) => ({ ...byId.get(id)!, enabled: true }));
  const rest = entries
    .filter((entry) => !widgetIds.includes(entry.widgetId))
    .sort((a, b) => a.order - b.order)
    .map((entry) => ({ ...entry, enabled: false }));
  return renumber([...enabled, ...rest]);
}
