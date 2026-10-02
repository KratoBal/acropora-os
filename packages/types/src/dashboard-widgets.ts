/**
 * THE DASHBOARD WIDGET REGISTRY, ONE PLACE FOR THE API AND THE WEB.
 *
 * Plan: `docs/dashboard/v1-discovery.md`. The API authorizes and validates
 * against this list; the web renders from it. Nothing here is React and
 * nothing here reads data: a widget's data comes from the dashboard module,
 * which checks the permission AGAIN on the server. Hiding a widget is never
 * the authorization.
 *
 * RULES THE FUNCTIONS BELOW HOLD:
 *   - permissions decide what a user MAY add; the user decides what is shown;
 *   - a role preset is a default and is always filtered through the
 *     permissions, so a preset can never grant a widget;
 *   - only an ACTIVE widget can be available; a PLANNED one is registered so
 *     the gap is named in code, and is never offered to anyone;
 *   - a stored layout is re-checked on every read: a widget the user lost the
 *     permission for, a retired or an unknown widget disappears, it is never
 *     shown "because it was saved".
 *
 * No new permission: every rule uses the existing `PERMISSIONS`
 * (`AUTHORIZATION.md`: no parallel permission system).
 */

import {
  hasAllPermissions,
  PERMISSIONS,
  type Permission,
  type UserRole,
} from "./auth.js";
import type { ServiceCapabilityValue } from "./service-capabilities.js";

export const DASHBOARD_WIDGET_SIZES = ["sm", "md", "lg"] as const;
/** sm = a third of the desktop row, md = two thirds, lg = the full row. */
export type DashboardWidgetSize = (typeof DASHBOARD_WIDGET_SIZES)[number];

export type DashboardWidgetCategory =
  | "tasks"
  | "service"
  | "aquariums"
  | "finance"
  | "purchasing"
  | "inventory"
  | "webshop"
  | "intelligence"
  | "system";

export type DashboardWidgetAvailability = "active" | "planned" | "experimental";

export const DASHBOARD_WIDGET_IDS = [
  "attention",
  "tasks",
  "service-tickets",
  "worksheets",
  "material-requests",
  "maintenance-calendar",
  "today-service",
  "next-location",
  "service-sla",
  "aquarium-alerts",
  "water-values",
  "aquarium-equipment",
  "next-measurements",
  "aquarium-health",
  "consumables",
  "overdue-invoices",
  "missing-invoices",
  "incoming-invoices",
  "expected-arrivals",
  "supplier-matching",
  "settlements",
  "webshop-orders",
  "pos-today",
  "stock-watch",
  "stock-reconciliation",
  "stock-sync-outbox",
  "product-data-quality",
  "personal-priorities",
  "approvals",
  "jev-intelligence",
  "system-status",
  "live-events",
  "upcoming-deadlines",
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  /** Hungarian, as on the card. */
  title: string;
  /** The card's subtitle and the customize panel's description. */
  description: string;
  category: DashboardWidgetCategory;
  /** ALL of these, from the existing `PERMISSIONS`. */
  requiredPermissions: readonly Permission[];
  /** A per-user capability on top of the permission (e.g. material requests). */
  requiredCapability?: ServiceCapabilityValue;
  recommendedRoles: readonly UserRole[];
  defaultSize: DashboardWidgetSize;
  supportedSizes: readonly DashboardWidgetSize[];
  availability: DashboardWidgetAvailability;
  /** Lower first: the order of a preset's tail and of the customize list. */
  priority: number;
  featureFlag?: string;
  /** Where the number comes from, for the reader of this file. */
  dataSource?: string;
  /** For a non-active widget: why it is not built (the honest gap). */
  plannedReason?: string;
}

const P = PERMISSIONS;
const SM: readonly DashboardWidgetSize[] = ["sm", "md"];
const WIDE: readonly DashboardWidgetSize[] = ["md", "lg"];
const MANAGERS: readonly UserRole[] = ["OWNER", "ADMIN", "MANAGER"];
const FROZEN = "Webshop / commerce is frozen by the owner (2026-10-01).";

function widget(
  def: Omit<DashboardWidgetDefinition, "supportedSizes" | "defaultSize"> &
    Partial<Pick<DashboardWidgetDefinition, "supportedSizes" | "defaultSize">>,
): DashboardWidgetDefinition {
  return { defaultSize: "sm", supportedSizes: SM, ...def };
}

export const DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[] = [
  // --- general ---
  widget({
    id: "attention",
    title: "Figyelmet igényel",
    description: "Prioritásos teendők az elérhető modulokból",
    category: "system",
    requiredPermissions: [P.DASHBOARD_VIEW],
    recommendedRoles: MANAGERS,
    defaultSize: "md",
    supportedSizes: WIDE,
    availability: "planned",
    priority: 0,
    dataSource:
      "The actionable figures of the other active widgets, per permission.",
    plannedReason: "Built with the JEV / system batch (PR 7).",
  }),
  widget({
    id: "tasks",
    title: "Feladataim",
    description: "Személyes teendők",
    category: "tasks",
    requiredPermissions: [P.TASKS_VIEW],
    recommendedRoles: [
      "OWNER",
      "ADMIN",
      "MANAGER",
      "SALES",
      "WAREHOUSE",
      "SERVICE",
      "VIEWER",
    ],
    availability: "active",
    priority: 10,
    dataSource:
      "Task: assigneeId = me, status OPEN (no due date in the model).",
  }),
  // --- service ---
  widget({
    id: "service-tickets",
    title: "Nyitott hibajegyek",
    description: "Prioritás és késés",
    category: "service",
    requiredPermissions: [P.SERVICE_VIEW],
    recommendedRoles: ["SERVICE", ...MANAGERS],
    availability: "active",
    priority: 20,
    dataSource:
      "ServiceJob open statuses, scoped by serviceJobVisibilityWhere.",
  }),
  widget({
    id: "worksheets",
    title: "Munkalapok",
    description: "Adminisztrációs állapot",
    category: "service",
    requiredPermissions: [P.SERVICE_VIEW],
    recommendedRoles: ["SERVICE", ...MANAGERS],
    availability: "active",
    priority: 21,
    dataSource:
      "Latest WorksheetVersion status; CompletionCertificate without SIGNED_FORM.",
  }),
  widget({
    id: "material-requests",
    title: "Anyagigények",
    description: "Szervizhez szükséges tételek",
    category: "service",
    requiredPermissions: [P.SERVICE_MANAGE],
    requiredCapability: "MATERIAL_REQUEST_MARK_RECEIVED",
    recommendedRoles: ["SERVICE", ...MANAGERS],
    availability: "active",
    priority: 22,
    dataSource: "MaterialRequest status OPEN.",
  }),
  widget({
    id: "maintenance-calendar",
    title: "Karbantartási naptár",
    description: "Következő 7 nap",
    category: "service",
    requiredPermissions: [P.SERVICE_VIEW],
    recommendedRoles: ["SERVICE", ...MANAGERS],
    availability: "active",
    priority: 23,
    dataSource: "Asset.nextServiceAt (maintained by hand).",
  }),
  widget({
    id: "today-service",
    title: "Mai szerviz",
    description: "Karbantartás · mai program",
    category: "service",
    requiredPermissions: [P.SERVICE_VIEW],
    recommendedRoles: ["SERVICE"],
    availability: "planned",
    priority: 24,
    plannedReason:
      "No planned visit time exists: ServiceJob.scheduledAt is never written, maintenance orders carry only a year.",
  }),
  widget({
    id: "next-location",
    title: "Következő helyszín",
    description: "Terepi navigáció",
    category: "service",
    requiredPermissions: [P.SERVICE_VIEW],
    recommendedRoles: ["SERVICE"],
    availability: "planned",
    priority: 25,
    plannedReason: "Needs a schedule, addresses and a travel-time integration.",
  }),
  widget({
    id: "service-sla",
    title: "Szerviz SLA / késésveszély",
    description: "Proaktív figyelmeztetés",
    category: "service",
    requiredPermissions: [P.SERVICE_MANAGE],
    recommendedRoles: MANAGERS,
    availability: "planned",
    priority: 26,
    plannedReason: "No SLA, urgency or risk rule is defined.",
  }),
  // --- aquariums ---
  widget({
    id: "aquarium-alerts",
    title: "Mérési figyelmeztetések",
    description: "Céltartományon kívül",
    category: "aquariums",
    requiredPermissions: [P.AQUARIUMS_VIEW],
    recommendedRoles: ["SERVICE", ...MANAGERS],
    availability: "active",
    priority: 30,
    dataSource:
      "Latest AquariumMeasurement per parameter vs aquariumEffectiveMeasurementTargetRange.",
  }),
  widget({
    id: "water-values",
    title: "Legutóbbi vízértékek",
    description: "Gyors áttekintés",
    category: "aquariums",
    requiredPermissions: [P.AQUARIUMS_VIEW],
    recommendedRoles: ["SERVICE", ...MANAGERS],
    availability: "active",
    priority: 31,
    dataSource:
      "Latest KH / FOSZFAT / NITRAT per aquarium vs the effective range.",
  }),
  widget({
    id: "aquarium-equipment",
    title: "Eszköz-karbantartás",
    description: "Akváriumhoz tartozó eszközök",
    category: "aquariums",
    requiredPermissions: [P.SERVICE_VIEW, P.AQUARIUMS_VIEW],
    recommendedRoles: ["SERVICE"],
    availability: "active",
    priority: 32,
    dataSource:
      "Asset.nextServiceAt for assets with an aquariumId, due within 14 days (Figma example; open question).",
  }),
  widget({
    id: "next-measurements",
    title: "Következő mérések",
    description: "Mérés / ICP esedékesség",
    category: "aquariums",
    requiredPermissions: [P.AQUARIUMS_VIEW],
    recommendedRoles: ["SERVICE"],
    availability: "planned",
    priority: 33,
    plannedReason: "No measurement schedule or reminder model exists.",
  }),
  widget({
    id: "aquarium-health",
    title: "Akvárium állapot",
    description: "Összesített health score",
    category: "aquariums",
    requiredPermissions: [P.AQUARIUMS_VIEW],
    recommendedRoles: MANAGERS,
    availability: "planned",
    priority: 34,
    plannedReason: "No scoring model is defined.",
  }),
  widget({
    id: "consumables",
    title: "Fogyóanyag / adagolás",
    description: "Készlet és utánpótlás",
    category: "aquariums",
    requiredPermissions: [P.AQUARIUMS_VIEW],
    recommendedRoles: ["SERVICE"],
    availability: "planned",
    priority: 35,
    plannedReason: "No usage-rate or dosing consumption model exists.",
  }),
  // --- finance & purchasing ---
  widget({
    id: "overdue-invoices",
    title: "Lejáró számlák",
    description: "Kimenő számlák · fizetési határidő",
    category: "finance",
    requiredPermissions: [P.BILLING_VIEW],
    recommendedRoles: ["SALES", ...MANAGERS],
    availability: "active",
    priority: 40,
    dataSource:
      "ExternalBillingDocument + the existing paymentStateOf / externalPaymentFields; UNKNOWN never overdue.",
  }),
  widget({
    id: "missing-invoices",
    title: "Hiányzó számlák",
    description: "Havi ellenőrzés",
    category: "finance",
    requiredPermissions: [P.FINANCE_VIEW],
    recommendedRoles: ["SALES", ...MANAGERS],
    availability: "active",
    priority: 41,
    dataSource: "MissingInvoicesService.months() (called, not modified).",
  }),
  widget({
    id: "incoming-invoices",
    title: "Bejövő számlák",
    description: "Feldolgozásra vár",
    category: "purchasing",
    requiredPermissions: [P.PURCHASING_VIEW],
    recommendedRoles: ["WAREHOUSE", ...MANAGERS],
    availability: "active",
    priority: 42,
    dataSource:
      "NavIncomingInvoice unbooked / ERROR; IncomingSupplierDocument FAILED / LATE_CORRECTION.",
  }),
  widget({
    id: "expected-arrivals",
    title: "Várható beérkezések",
    description: "Bevételezésre váró szállítmányok",
    category: "purchasing",
    requiredPermissions: [P.PURCHASING_VIEW],
    recommendedRoles: ["WAREHOUSE", ...MANAGERS],
    availability: "active",
    priority: 43,
    dataSource:
      "ExpectedArrivalService.list() (open mail arrivals + unbooked NAV invoices); no ETA field exists.",
  }),
  widget({
    id: "supplier-matching",
    title: "JEV beszállítói párosítás",
    description: "Emberi megerősítésre vár",
    category: "purchasing",
    requiredPermissions: [P.PURCHASING_VIEW],
    recommendedRoles: ["WAREHOUSE", ...MANAGERS],
    availability: "planned",
    priority: 44,
    plannedReason:
      "No production-visible review queue: the missing-invoice pairing runs in shadow mode (never a suggestion) and the supplier-line suggestion is off.",
  }),
  widget({
    id: "settlements",
    title: "Elszámolások",
    description: "Foxpost · GLS · SimplePay",
    category: "finance",
    requiredPermissions: [P.FINANCE_VIEW],
    recommendedRoles: ["SALES", ...MANAGERS],
    availability: "active",
    priority: 45,
    dataSource:
      "Settlement / COD report NEEDS_REVIEW and ERROR, latest sync runs.",
  }),
  // --- webshop & inventory ---
  widget({
    id: "webshop-orders",
    title: "Webshop rendelési sor",
    description: "Megrendelések feldolgozása",
    category: "webshop",
    requiredPermissions: [P.ORDERS_VIEW],
    recommendedRoles: MANAGERS,
    availability: "planned",
    priority: 50,
    plannedReason: FROZEN,
  }),
  widget({
    id: "pos-today",
    title: "POS · mai forgalom",
    description: "Mai értékesítés",
    category: "webshop",
    requiredPermissions: [P.ORDERS_VIEW],
    recommendedRoles: MANAGERS,
    availability: "planned",
    priority: 51,
    plannedReason: FROZEN,
  }),
  widget({
    id: "stock-watch",
    title: "Készletfigyelő",
    description: "Kritikus és alacsony készlet",
    category: "inventory",
    requiredPermissions: [P.INVENTORY_VIEW],
    recommendedRoles: ["WAREHOUSE"],
    availability: "planned",
    priority: 52,
    plannedReason:
      "No reliable threshold: ProductExtension minimum/reorder fields are not used anywhere and their fill rate is unknown.",
  }),
  widget({
    id: "stock-reconciliation",
    title: "Készlet-egyeztetés",
    description: "Ledger / készlet eltérések",
    category: "inventory",
    requiredPermissions: [P.INVENTORY_VIEW],
    recommendedRoles: ["WAREHOUSE", ...MANAGERS],
    availability: "planned",
    priority: 53,
    dataSource:
      "StockReconciliationService, actionable statuses only (today's dashboard block).",
    plannedReason: "Moved into the framework with the inventory batch (PR 6).",
  }),
  widget({
    id: "stock-sync-outbox",
    title: "Készlet-kimenősor",
    description: "UNAS stock sync",
    category: "inventory",
    requiredPermissions: [P.INVENTORY_VIEW],
    recommendedRoles: ["WAREHOUSE", ...MANAGERS],
    availability: "planned",
    priority: 54,
    plannedReason:
      "UNAS sync health; UNAS / commerce health checks are frozen (open question in the discovery report).",
  }),
  widget({
    id: "product-data-quality",
    title: "Webshop termékadat minőség",
    description: "JEV enrichment / verification",
    category: "webshop",
    requiredPermissions: [P.PRODUCTS_VIEW],
    recommendedRoles: MANAGERS,
    availability: "planned",
    priority: 55,
    plannedReason: `${FROZEN} Later driven by the JEV product enrichment workstream.`,
  }),
  // --- intelligence & system ---
  widget({
    id: "personal-priorities",
    title: "Személyes prioritások",
    description: "Minden jogosultságból egy helyre",
    category: "tasks",
    requiredPermissions: [P.DASHBOARD_VIEW],
    recommendedRoles: MANAGERS,
    availability: "planned",
    priority: 60,
    plannedReason: "Needs a cross-module priority aggregation.",
  }),
  widget({
    id: "approvals",
    title: "Jóváhagyásra vár",
    description: "Döntést igénylő tételek",
    category: "system",
    requiredPermissions: [P.DASHBOARD_VIEW],
    recommendedRoles: MANAGERS,
    availability: "planned",
    priority: 61,
    plannedReason: "Needs a common approval abstraction.",
  }),
  widget({
    id: "jev-intelligence",
    title: "JEV intelligencia",
    description: "Döntések és review queue",
    category: "intelligence",
    requiredPermissions: [P.SETTINGS_MANAGE],
    recommendedRoles: ["OWNER", "ADMIN"],
    availability: "planned",
    priority: 62,
    dataSource:
      "DecisionRun groupBy; shadow runs only as a labelled shadow measurement, never as suggestions.",
    plannedReason: "Built with the JEV / system batch (PR 7).",
  }),
  widget({
    id: "system-status",
    title: "Rendszerállapot",
    description: "NAV · levelezés · futárok · JEV",
    category: "system",
    requiredPermissions: [P.SETTINGS_MANAGE],
    recommendedRoles: ["OWNER", "ADMIN"],
    availability: "planned",
    priority: 63,
    dataSource:
      "Latest sync runs (NAV, mail, Foxpost, GLS, SimplePay), JEV error share; UNAS / Medusa rows frozen.",
    plannedReason: "Built with the JEV / system batch (PR 7).",
  }),
  widget({
    id: "live-events",
    title: "Élő események",
    description: "Jogosultság szerint szűrt feed",
    category: "system",
    requiredPermissions: [P.DASHBOARD_VIEW],
    recommendedRoles: MANAGERS,
    availability: "planned",
    priority: 64,
    plannedReason: "Needs a cross-module event feed.",
  }),
  widget({
    id: "upcoming-deadlines",
    title: "Közelgő határidők",
    description: "Feladat · számla · karbantartás",
    category: "system",
    requiredPermissions: [P.DASHBOARD_VIEW],
    recommendedRoles: MANAGERS,
    availability: "planned",
    priority: 65,
    plannedReason: "Needs a permission-aware deadline aggregator.",
  }),
];

/**
 * ROLE PRESETS (Figma 392:3 "Ajánlott alapértelmezett dashboardok").
 * Defaults only; the user's own layout wins. Filtered through the
 * permissions on every use. Feladataim heads every preset of a role with
 * `tasks.view` ("Recommended roles: Mindenki" in the library).
 */
export const DASHBOARD_ROLE_PRESETS: Partial<
  Record<UserRole, readonly DashboardWidgetId[]>
> = {
  SERVICE: [
    "today-service",
    "service-tickets",
    "worksheets",
    "material-requests",
    "tasks",
    "maintenance-calendar",
  ],
  WAREHOUSE: [
    "tasks",
    "expected-arrivals",
    "stock-watch",
    "stock-reconciliation",
    "stock-sync-outbox",
  ],
  SALES: [
    "tasks",
    "overdue-invoices",
    "incoming-invoices",
    "missing-invoices",
    "settlements",
  ],
  OWNER: [
    "attention",
    "tasks",
    "system-status",
    "jev-intelligence",
    "approvals",
    "upcoming-deadlines",
    "expected-arrivals",
  ],
  ADMIN: [
    "attention",
    "tasks",
    "system-status",
    "jev-intelligence",
    "approvals",
    "upcoming-deadlines",
    "expected-arrivals",
  ],
  MANAGER: [
    "attention",
    "tasks",
    "approvals",
    "upcoming-deadlines",
    "expected-arrivals",
  ],
  VIEWER: ["attention", "tasks"],
};

/**
 * STARTER LAYOUTS for the two profiles that are not a role (an aquarium
 * maintainer is a relation, purchasing/finance spans two roles). Offered in
 * the customize panel, never applied automatically.
 */
export const DASHBOARD_STARTER_LAYOUTS = [
  {
    id: "aquarium",
    label: "Akváriumfelelős",
    widgetIds: [
      "aquarium-alerts",
      "water-values",
      "aquarium-equipment",
      "tasks",
    ],
  },
  {
    id: "finance",
    label: "Beszerzés / pénzügy",
    widgetIds: [
      "overdue-invoices",
      "incoming-invoices",
      "missing-invoices",
      "expected-arrivals",
      "supplier-matching",
      "settlements",
    ],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  widgetIds: readonly DashboardWidgetId[];
}[];
export type DashboardStarterLayoutId =
  (typeof DASHBOARD_STARTER_LAYOUTS)[number]["id"];

// ---------------------------------------------------------------------------
// The pure rules.

/** Who is looking: the role (permissions) and the per-user capabilities. */
export interface DashboardViewer {
  role: UserRole;
  capabilities: readonly ServiceCapabilityValue[];
}

export interface DashboardLayoutEntry {
  widgetId: DashboardWidgetId;
  enabled: boolean;
  order: number;
  size: DashboardWidgetSize;
}

export interface ResolvedDashboardLayout {
  /** `preset`: no own layout (or it was reset); `custom`: the user's own. */
  source: "preset" | "custom";
  /** Every available widget exactly once: enabled ones first, in order. */
  widgets: DashboardLayoutEntry[];
}

const BY_ID = new Map<string, DashboardWidgetDefinition>(
  DASHBOARD_WIDGETS.map((definition) => [definition.id, definition]),
);

export function isDashboardWidgetId(
  value: unknown,
): value is DashboardWidgetId {
  return typeof value === "string" && BY_ID.has(value);
}

export function dashboardWidget(
  id: DashboardWidgetId,
): DashboardWidgetDefinition {
  const definition = BY_ID.get(id);
  if (!definition) throw new Error(`unknown dashboard widget "${id}"`);
  return definition;
}

/**
 * May this viewer have this widget? ACTIVE, every required permission, and
 * the capability if one is required. The single gate: the API's data endpoint
 * calls it for every requested widget, not only the layout.
 */
export function isDashboardWidgetAvailable(
  definition: DashboardWidgetDefinition,
  viewer: DashboardViewer,
): boolean {
  if (definition.availability !== "active") return false;
  if (!hasAllPermissions(viewer.role, definition.requiredPermissions))
    return false;
  if (
    definition.requiredCapability &&
    !viewer.capabilities.includes(definition.requiredCapability)
  )
    return false;
  return true;
}

/** The widgets this viewer may add, by priority. Never the whole registry. */
export function availableDashboardWidgets(
  viewer: DashboardViewer,
): DashboardWidgetDefinition[] {
  return DASHBOARD_WIDGETS.filter((definition) =>
    isDashboardWidgetAvailable(definition, viewer),
  ).sort((a, b) => a.priority - b.priority);
}

/** The role preset, filtered through what the viewer may have. */
export function presetDashboardLayout(
  viewer: DashboardViewer,
): DashboardLayoutEntry[] {
  return layoutFromEnabledIds(
    viewer,
    DASHBOARD_ROLE_PRESETS[viewer.role] ?? [],
  );
}

/** A starter layout, filtered the same way; `null` for an unknown id. */
export function starterDashboardLayout(
  viewer: DashboardViewer,
  starterId: string,
): DashboardLayoutEntry[] | null {
  const starter = DASHBOARD_STARTER_LAYOUTS.find((s) => s.id === starterId);
  return starter ? layoutFromEnabledIds(viewer, starter.widgetIds) : null;
}

/** The starter layouts that would give this viewer at least one widget. */
export function availableStarterLayouts(viewer: DashboardViewer) {
  return DASHBOARD_STARTER_LAYOUTS.filter((starter) =>
    starter.widgetIds.some((id) =>
      isDashboardWidgetAvailable(dashboardWidget(id), viewer),
    ),
  ).map((starter) => ({
    id: starter.id,
    label: starter.label,
    widgetIds: starter.widgetIds.filter((id) =>
      isDashboardWidgetAvailable(dashboardWidget(id), viewer),
    ),
  }));
}

function layoutFromEnabledIds(
  viewer: DashboardViewer,
  enabledIds: readonly DashboardWidgetId[],
): DashboardLayoutEntry[] {
  const available = availableDashboardWidgets(viewer);
  const availableIds = new Set(available.map((d) => d.id));
  const enabled = [...new Set(enabledIds)].filter((id) => availableIds.has(id));
  const rest = available.map((d) => d.id).filter((id) => !enabled.includes(id));
  return [...enabled, ...rest].map((widgetId, order) => ({
    widgetId,
    enabled: order < enabled.length,
    order,
    size: dashboardWidget(widgetId).defaultSize,
  }));
}

/** The stored row's shape; `version` lets a later shape be migrated on read. */
export const DASHBOARD_LAYOUT_VERSION = 1;

/**
 * THE VIEWER'S LAYOUT. No stored layout: the preset. A stored one is
 * RE-CHECKED: entries that are unknown, not active or no longer permitted are
 * dropped (never shown because they were saved); available widgets the
 * stored layout does not mention (new ones, or a newly granted permission)
 * are appended DISABLED, so they are offered, not imposed.
 */
export function resolveDashboardLayout(
  viewer: DashboardViewer,
  stored: unknown,
): ResolvedDashboardLayout {
  const entries = parseStoredEntries(stored);
  if (!entries)
    return { source: "preset", widgets: presetDashboardLayout(viewer) };

  const available = availableDashboardWidgets(viewer);
  const availableIds = new Set(available.map((d) => d.id));
  const kept = entries
    .filter((entry) => availableIds.has(entry.widgetId))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.order - b.order);
  const seen = new Set(kept.map((entry) => entry.widgetId));
  const added = available
    .filter((d) => !seen.has(d.id))
    .map((d) => ({
      widgetId: d.id,
      enabled: false,
      order: 0,
      size: d.defaultSize,
    }));

  return {
    source: "custom",
    widgets: [...kept, ...added].map((entry, order) => ({
      widgetId: entry.widgetId,
      enabled: entry.enabled,
      order,
      size: supportedSize(entry.widgetId, entry.size),
    })),
  };
}

/** Read the stored JSON leniently: a broken row means "no own layout". */
function parseStoredEntries(stored: unknown): DashboardLayoutEntry[] | null {
  if (stored === null || stored === undefined) return null;
  if (!Array.isArray(stored)) return null;
  const entries: DashboardLayoutEntry[] = [];
  const seen = new Set<string>();
  for (const raw of stored) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (!isDashboardWidgetId(r.widgetId) || seen.has(r.widgetId)) continue;
    seen.add(r.widgetId);
    entries.push({
      widgetId: r.widgetId,
      enabled: r.enabled === true,
      order:
        typeof r.order === "number" && Number.isFinite(r.order) ? r.order : 0,
      size: isSize(r.size) ? r.size : dashboardWidget(r.widgetId).defaultSize,
    });
  }
  return entries;
}

export type DashboardLayoutInputResult =
  | { ok: true; widgets: DashboardLayoutEntry[] }
  | { ok: false; errors: string[] };

/**
 * THE API'S WRITE VALIDATION, strict where the read is lenient: a client
 * that asks to enable a widget the user may not have is refused by name, not
 * quietly trimmed. The result is normalized (orders 0..n-1, enabled first).
 */
export function sanitizeDashboardLayoutInput(
  viewer: DashboardViewer,
  input: unknown,
): DashboardLayoutInputResult {
  const errors: string[] = [];
  if (!Array.isArray(input))
    return { ok: false, errors: ["A widgets mezőnek listának kell lennie."] };
  if (input.length > DASHBOARD_WIDGET_IDS.length)
    return { ok: false, errors: ["Túl sok widget."] };

  const available = new Set(availableDashboardWidgets(viewer).map((d) => d.id));
  const seen = new Set<string>();
  const entries: DashboardLayoutEntry[] = [];
  input.forEach((raw: unknown, index: number) => {
    const at = `widgets[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return void errors.push(`${at}: nem objektum.`);
    const r = raw as Record<string, unknown>;
    if (!isDashboardWidgetId(r.widgetId))
      return void errors.push(`${at}: ismeretlen widget.`);
    if (!available.has(r.widgetId))
      return void errors.push(
        `${at}: a(z) "${r.widgetId}" widget nem érhető el.`,
      );
    if (seen.has(r.widgetId))
      return void errors.push(`${at}: a(z) "${r.widgetId}" kétszer szerepel.`);
    seen.add(r.widgetId);
    if (typeof r.enabled !== "boolean")
      errors.push(`${at}.enabled: logikai érték kell.`);
    if (
      typeof r.order !== "number" ||
      !Number.isInteger(r.order) ||
      r.order < 0
    )
      errors.push(`${at}.order: nemnegatív egész kell.`);
    if (
      r.size !== undefined &&
      !(
        isSize(r.size) &&
        dashboardWidget(r.widgetId).supportedSizes.includes(r.size)
      )
    )
      errors.push(`${at}.size: nem támogatott méret.`);
    entries.push({
      widgetId: r.widgetId,
      enabled: r.enabled === true,
      order: typeof r.order === "number" ? r.order : 0,
      size: isSize(r.size) ? r.size : dashboardWidget(r.widgetId).defaultSize,
    });
  });
  if (errors.length) return { ok: false, errors };

  const normalized = entries
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.order - b.order)
    .map((entry, order) => ({ ...entry, order }));
  return { ok: true, widgets: normalized };
}

function isSize(value: unknown): value is DashboardWidgetSize {
  return (
    typeof value === "string" &&
    (DASHBOARD_WIDGET_SIZES as readonly string[]).includes(value)
  );
}

function supportedSize(
  id: DashboardWidgetId,
  size: DashboardWidgetSize,
): DashboardWidgetSize {
  const definition = dashboardWidget(id);
  return definition.supportedSizes.includes(size)
    ? size
    : definition.defaultSize;
}

// ---------------------------------------------------------------------------
// The API contract.

/** What the customize panel may show: never the full registry. */
export interface DashboardWidgetInfo {
  id: DashboardWidgetId;
  title: string;
  description: string;
  category: DashboardWidgetCategory;
  defaultSize: DashboardWidgetSize;
  supportedSizes: readonly DashboardWidgetSize[];
}

export interface DashboardLayoutResponse extends ResolvedDashboardLayout {
  available: DashboardWidgetInfo[];
  starterLayouts: {
    id: string;
    label: string;
    widgetIds: DashboardWidgetId[];
  }[];
}

export interface DashboardLayoutUpdate {
  widgets: {
    widgetId: string;
    enabled: boolean;
    order: number;
    size?: string;
  }[];
}

export function dashboardWidgetInfo(
  definition: DashboardWidgetDefinition,
): DashboardWidgetInfo {
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    category: definition.category,
    defaultSize: definition.defaultSize,
    supportedSizes: definition.supportedSizes,
  };
}

/**
 * One widget's data. `error` is never a zero: the card says the data is not
 * available. `forbidden` is the server's own permission check (the client
 * asked for something the user may not have); `unavailable` a widget that is
 * not active.
 */
export type DashboardWidgetResult<T = unknown> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string }
  | { status: "forbidden" }
  | { status: "unavailable" };

export interface DashboardWidgetsResponse {
  results: Partial<Record<DashboardWidgetId, DashboardWidgetResult>>;
}

/** Feladataim. `Task` has no due date: only open count and the newest. */
export interface DashboardTasksWidgetData {
  openCount: number;
  latest: { id: string; title: string; createdAt: string }[];
}

/** Várható beérkezések. There is no ETA field: stages and suppliers only. */
export interface DashboardExpectedArrivalsWidgetData {
  count: number;
  byStage: { PROFORMA: number; INVOICE: number; LATE_CORRECTION: number };
  latest: {
    supplierName: string;
    stage: "PROFORMA" | "INVOICE" | "LATE_CORRECTION";
    arrivedAt: string | null;
  }[];
}

/**
 * Nyitott hibajegyek. There is NO priority or urgency field anywhere in the
 * schema, so "N sürgős" is not shown: the status breakdown and the age of the
 * oldest open ticket are.
 */
export interface DashboardServiceTicketsWidgetData {
  openCount: number;
  /** Open tickets per status; statuses with zero are omitted. */
  byStatus: Partial<
    Record<
      | "NEW"
      | "TRIAGED"
      | "SCHEDULED"
      | "IN_PROGRESS"
      | "WAITING_FOR_PARTS"
      | "WAITING_FOR_CUSTOMER",
      number
    >
  >;
  /** `createdAt` of the oldest open ticket, or `null` when none is open. */
  oldestOpenAt: string | null;
}

/** Munkalapok: the administrative states that need someone to act. */
export interface DashboardWorksheetsWidgetData {
  /** Latest version still a DRAFT: not closed yet. */
  draft: number;
  /** Closed, awaiting signature, not yet sent to anyone for signing. */
  awaitingSignatureNotSent: number;
  /** Sent for signature, not signed yet. */
  awaitingSignatureSent: number;
  /** Completion certificate issued, its signed form not uploaded back yet. */
  certificatesAwaitingSignedForm: number;
}

/** Anyagigények: open (submitted, not yet received) requests. */
export interface DashboardMaterialRequestsWidgetData {
  openCount: number;
  oldestSubmittedAt: string | null;
  latest: {
    id: string;
    worksheetId: string;
    worksheetNumber: string | null;
    customerName: string;
    submittedAt: string;
    itemCount: number;
  }[];
}

/**
 * Karbantartási naptár, from `Asset.nextServiceAt` (maintained by hand).
 * Days are Europe/Budapest calendar days.
 */
export interface DashboardMaintenanceCalendarWidgetData {
  overdue: number;
  today: number;
  /** Tomorrow through the 7th day from today. */
  nextSevenDays: number;
  /** The soonest few, overdue first; `nextServiceAt` as a `YYYY-MM-DD` day. */
  soonest: {
    assetId: string;
    assetName: string;
    placeName: string;
    nextServiceAt: string;
  }[];
}

/**
 * Mérési figyelmeztetések: the latest measurement occasion of each visible
 * aquarium against its effective target range
 * (`aquariumEffectiveMeasurementTargetRange`: own range, else the marine
 * default, else none). No range, no alert: no limit is invented.
 */
export interface DashboardAquariumAlertsWidgetData {
  /** Active aquariums checked (the caller's scope). */
  checked: number;
  outOfRangeCount: number;
  /** No measurement, or the latest older than `staleAfterDays`. */
  staleCount: number;
  staleAfterDays: number;
  /** The out-of-range values, most recent first (a few). */
  items: {
    aquariumId: string;
    aquariumName: string;
    parameterCode: string;
    value: number;
    min: number | null;
    max: number | null;
    measuredAt: string;
  }[];
}

/** Legutóbbi vízértékek: KH, PO4 and NO3 across the aquariums with a fresh reading. */
export interface DashboardWaterValuesWidgetData {
  aquariumCount: number;
  /** Aquariums whose latest occasion is not older than `staleAfterDays`. */
  freshCount: number;
  staleAfterDays: number;
  parameters: {
    code: "KH" | "FOSZFAT" | "NITRAT";
    inRange: number;
    outOfRange: number;
    /** Measured, but no target range exists: never folded into "in range". */
    noTarget: number;
    /** Not measured at the latest occasion. */
    notMeasured: number;
  }[];
}

/** Eszköz-karbantartás: equipment attached to an aquarium, by next service date. */
export interface DashboardAquariumEquipmentWidgetData {
  windowDays: number;
  overdue: number;
  /** Due today or within `windowDays` days. */
  dueSoon: number;
  soonest: {
    assetId: string;
    assetName: string;
    aquariumName: string;
    nextServiceAt: string;
  }[];
}

/**
 * Lejáró számlák: our outgoing invoices from the Számlázz.hu feed
 * (`ExternalBillingDocument`), with the payment state of the existing
 * `externalPaymentFields` / `paymentStateOf` -- never a second calculation.
 * Only UNPAID and the open part of PARTIAL count; UNKNOWN is never overdue,
 * it is its own figure. Days are Europe/Budapest calendar days.
 */
export interface DashboardOverdueInvoicesWidgetData {
  overdue: {
    count: number;
    /** The open amount per currency, decimal strings. */
    openAmounts: { currency: string; amount: string }[];
  };
  dueToday: number;
  /** Due tomorrow through the 7th day from today. */
  dueWithinWeek: number;
  /** Past due, but the feed has no payment data: shown, never counted as overdue. */
  noPaymentDataPastDue: number;
}

/** Hiányzó számlák: the two newest months of the existing missing-invoice check. */
export interface DashboardMissingInvoicesWidgetData {
  months: {
    /** `YYYY-MM` */
    month: string;
    /** originalMissing + notMatched + noInvoice */
    missing: number;
    originalMissing: number;
    notMatched: number;
    noInvoice: number;
    missingAmountHuf: string;
    status: string;
  }[];
}

/** Bejövő számlák: only what needs someone (NAV invoices and mailbox documents). */
export interface DashboardIncomingInvoicesWidgetData {
  /** NAV invoices (CREATE) fetched but not booked yet. */
  navToBook: number;
  navErrors: number;
  /** Mailbox documents that could not be read. */
  mailboxFailed: number;
  /** An invoice corrected after it was booked. */
  lateCorrections: number;
}

/** Elszámolások: the settlements that need review, and each source's last run. */
export interface DashboardSettlementsWidgetData {
  sources: {
    source: "FOXPOST" | "GLS" | "SIMPLEPAY";
    needsReview: number;
    errors: number;
    lastRun: { status: string; startedAt: string } | null;
  }[];
}
