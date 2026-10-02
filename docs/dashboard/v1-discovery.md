# Vezérlőpult V1: discovery report

Phase 1 of the modular, role-based dashboard. This is a report and plan only:
**no code is in this PR.**

Inputs:

- the dashboard brief and the fleet constraints of 2026-10-01;
- the approved Figma file `ji64fTFss0jqm5Uifd0zhE`;
- the code on `main` at `b081299`.

## 0. Figma access

Both nodes open through the Figma connector: the owner dashboard **382:3**
("Dashboard / Owner · Default", 1600×1080) and the widget library **392:3**.
Direct HTTPS to figma.com is blocked by this environment's egress policy, but
the connector is enough. So the framework PR will follow the Figma layout and
will not need neutral placeholder styling.

Two things in the Figma file are not layout to copy:

- **The three floating cards in the top-left corner of 382:3.** "Commerce ·
  Online 99.9%", "Revenue · Today" and "7 Action · Orders waiting" overlap the
  sidebar and the header. They look like leftover drafts, so they are ignored.
- **The "OS ADAT" / "JAVASOLT" badges in 392:3.** They are library
  annotations ("this has OS data" / "this is a suggestion"), not product UI.

Several of the owner view's blocks conflict with the constraints. Section 6
covers them.

## 1. The current dashboard and home page

**A permission-aware dashboard already exists.** The new framework extends it;
it does not build a second one.

| Layer           | Where                                                                                       | What                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API             | `apps/api/src/dashboard/` (`controller`, `service`, `repository`, `module`, `service.spec`) | `GET /dashboard/summary`, guarded by `dashboard.view`                                                                                                                                          |
| Shared contract | `packages/types/src/dashboard.ts`, `DashboardSummary`                                       | Every block is an optional key. **An omitted key means the user may not see that subject; an empty list means they may and there is nothing to report.**                                       |
| Web             | `apps/web/src/app/(shell)/page.tsx` (764 lines, `"use client"`)                             | `DashboardPage` → `dashboardApi.summary()`. `DashboardCards` renders a fixed set of `PilotCard`s for the keys present. It uses `Skeleton` while loading and `Alert variant="danger"` on error. |
| Shell badge     | `apps/web/src/components/app-shell.tsx:128-142`                                             | Also calls `/dashboard/summary`, only for `myTaskCount`                                                                                                                                        |

`DashboardService.summary(user)` (`dashboard.service.ts:31-82`) adds blocks by
permission:

- `service.view`: `myWorksheets`, `openTickets`, `upcomingMaintenance`.
- `aquariums.view`: `aquariumAlerts`.
- `service.manage`: `managerTiles`, `deadlines`, `teamLoad`, `activity`.
  Also `materialRequests`, but only with the `MATERIAL_REQUEST_MARK_RECEIVED`
  capability.
- `purchasing.view`: `purchasing`.
- `inventory.view`: `inventoryDiscrepancies`.
- `tasks.view`: `myTaskCount`.

What it lacks is exactly what the brief asks for: a registry, per-user
selection and order, role presets, and per-widget error isolation. **One
failing block fails the whole page.**

### Problems found in the current dashboard, to fix as the widgets move

1. **`managerTiles` counts company-wide.** The tiles are open tickets,
   awaiting signature, open material requests and issued maintenance orders.
   They are gated only by `service.manage`, which the plain `SERVICE` role
   also has, so every technician sees company totals.
2. `deadlines()` and `teamLoad()` are unscoped too.
3. **The awaiting-signature count includes hidden worksheets.** Its raw query
   does not filter `hiddenAt`.
4. **`aquariumAlerts()` is unscoped and expensive.** It does not apply
   `aquariumVisibilityWhere` (harmless today, because only internal roles
   have `dashboard.view`). It also loads every measurement of every active
   aquarium with no limit.
5. **`inventoryDiscrepancies` is expensive.** It runs the full stock
   reconciliation paging (`reconcilePage`, batches of 200) on every dashboard
   load.

## 2. The permission model as it applies to widgets

All of it is in `packages/types/src/auth.ts`, and the web app and the API use
the same functions:

- `PERMISSIONS` (l.96-257), `ROLE_PERMISSIONS` (l.522);
- `hasPermission`, `hasAnyPermission`, `hasAllPermissions` (l.644-668).

**Roles and permissions:**

- Each user has exactly one `UserRole`: `OWNER, ADMIN, MANAGER, SALES,
WAREHOUSE, SERVICE, VIEWER`, plus the machine roles `CONTENT_AGENT,
ASSET_IMPORT_AGENT` and the partner role `PARTNER_SERVICE`.
- Permissions come from a hardcoded role matrix. There is no DB permission
  table and there are no per-user overrides.
- **There is no superuser bypass.** `OWNER` and `ADMIN` simply hold every
  permission.

**Enforcement:**

- API: global `AuthGuard` + `PermissionGuard`, with `@RequirePermissions` /
  `@RequireAnyPermission` and `@CurrentUser()` → `AuthenticatedUser {id, role,
customerId, supplierId, …}`. The user object carries no permission array;
  permissions are always derived from the role.
- Web: `GET /auth/me` → `useAuth().session.user`. Components call
  `hasPermission(session.user, PERMISSIONS.X)`. Navigation visibility uses
  `NAVIGATION_ENTRIES` + `isNavigationEntryVisible` (`packages/types/src/navigation.ts`).

**Second gates that are not permissions:**

- `UserServiceCapability`, e.g. `MATERIAL_REQUEST_MARK_RECEIVED`;
- worksheet-department visibility (`UserWorksheetDepartment`);
- partner scope (`customerId` / `supplierId`);
- aquarium visibility (`aquariumVisibilityWhere`).

A widget definition therefore needs `requiredPermissions` and an optional
`requiredCapability`. Row-level scoping stays in each query.

**Mapping roles to the brief's presets:**

| Brief preset                             | Role(s)                     | Note                                                                                                                            |
| ---------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Szervizes (service technician)           | `SERVICE`                   |                                                                                                                                 |
| Raktár (warehouse)                       | `WAREHOUSE`                 | holds inventory, purchasing and partners; **not finance**                                                                       |
| Menedzser / tulajdonos (manager/owner)   | `OWNER`, `ADMIN`, `MANAGER` |                                                                                                                                 |
| Beszerzés / pénzügy (purchasing/finance) | (none)                      | **no such role.** `SALES` has `finance.view` (so `billing.view`) but not purchasing; `WAREHOUSE` has purchasing but not finance |
| Akváriumfelelős (aquarium responsible)   | (none)                      | **not a role but a relation**: `AquariumMaintainer(aquariumId, userId)`                                                         |
| Webshop manager                          | (none)                      | **frozen**: not implemented                                                                                                     |
| `VIEWER`, `SALES`                        |                             | get the widgets their permissions allow, with no curated default beyond that                                                    |

Proposal:

- Presets are keyed by role.
- The two role-less profiles (aquarium, finance) are offered as **selectable
  starting layouts** in the customize panel, never applied automatically.
- Every preset is filtered through the user's permissions, so a preset can
  never grant a widget.

No new permission is needed. Adding one would break the rule "no parallel
permission system" and the `AUTHORIZATION.md` process.

## 3. Persisting the user's dashboard

**Nothing suitable exists.**

- `User` (`schema.prisma:762-893`) has no JSON or preference column.
- There is no `UserSetting`, `UserPreference`, `AppSetting` or key-value
  model. The `*Setting` models are integration credentials.
- The per-user join tables (`UserServiceCapability`, `UserNotificationRole`,
  `UserWorksheetDepartment`) are authorization data, not preferences.
- The web stores no UI state server-side. `localStorage` holds only the dev
  session and the theme.
- `localStorage` is unsuitable anyway: it is per device and lost on logout.

**Proposal: one small model, one row per user.**

```prisma
/// A user's own dashboard. The row exists ONLY after the user has customized
/// their dashboard: no row means the role preset applies, so a preset change
/// reaches every user who has not customized.
model UserDashboardLayout {
  userId    String   @id
  /// `[{ widgetId, enabled, order, size? }]`, validated against the widget
  /// registry on every read and write (unknown, retired or no-longer-permitted
  /// widgets are dropped on read, never shown).
  widgets   Json
  /// Bumped when the stored shape changes; old shapes are migrated on read.
  version   Int      @default(1)
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**Why JSON in one row, and not one row per widget:**

- The layout is always read and written whole.
- A reorder is one atomic write, not N updates.
- Widget ids are registry data that change with code, not database
  references.
- Validation lives in the shared registry, where the API and the web can both
  run it.

"Reset to preset" deletes the row.

## 4. The real data source for each proposed V1 widget

Legend: **ACTIVE** means it can be built from data that exists today.
**PLANNED** means it is registered with no data source and no endpoint.
Permissions are the existing ones.

### Feladatok és szerviz (tasks and service)

| Widget                                          | Status      | Source                                                                                                                                                                                                                                                                               | Permission                                                     | What the data does NOT support                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Feladataim** (my tasks)                       | ACTIVE      | `Task`, `assigneeId = me`, `status = OPEN`; `task.count` + newest 3 by `createdAt` (index `[assigneeId, status, createdAt]`)                                                                                                                                                         | `tasks.view`                                                   | **`Task` has no due date and no priority.** "Ma esedékes" (due today) and "lejárt" (overdue) in Figma cannot be computed and are not shown.                                                                                                                          |
| **Nyitott hibajegyek** (open tickets)           | ACTIVE      | `ServiceJob`: not `COMPLETED/CANCELLED`, `hiddenAt = null`, scoped by `serviceJobVisibilityWhere`; count + `groupBy status` (`NEW`, `WAITING_FOR_PARTS`, `WAITING_FOR_CUSTOMER`, …); oldest open `createdAt` as age                                                                  | `service.view`                                                 | **There is no priority or urgency field anywhere in the schema.** "N sürgős" (N urgent) cannot be shown; see Q2.                                                                                                                                                     |
| **Munkalapok** (worksheets)                     | ACTIVE      | Latest `WorksheetVersion.status`, all scoped and filtering `hiddenAt`: `DRAFT` (unfinished); `AWAITING_SIGNATURE`, split into sent (`sentForSignatureAt`) and not sent; completion certificate issued but not signed back (`CompletionCertificate` without a `SIGNED_FORM` document) | `service.view`                                                 |                                                                                                                                                                                                                                                                      |
| **Anyagigények** (material requests)            | ACTIVE      | `MaterialRequest.status = OPEN`, count + oldest `submittedAt`                                                                                                                                                                                                                        | `service.manage` + `MATERIAL_REQUEST_MARK_RECEIVED` capability | **No urgency field.** Items are free text.                                                                                                                                                                                                                           |
| **Karbantartási naptár** (maintenance calendar) | ACTIVE      | `Asset.nextServiceAt` (indexed): overdue / today / next 7 days, `status ACTIVE`, not archived, scoped by `assetVisibilityForAndBranch`                                                                                                                                               | `service.view`                                                 | `nextServiceAt` is maintained by hand; it is only as good as its entry.                                                                                                                                                                                              |
| **Eszköz-karbantartás** (equipment maintenance) | ACTIVE      | Same source, restricted to equipment attached to an aquarium (`Asset.aquariumId`), due within 14 days                                                                                                                                                                                | `service.view` + `aquariums.view`                              | The 14-day window comes from the Figma example; see Q3.                                                                                                                                                                                                              |
| **Mai szerviz** (today's service)               | **PLANNED** | (none)                                                                                                                                                                                                                                                                               | (none)                                                         | **There is no planned visit time.** `ServiceJob.scheduledAt` exists, but its schema comment says nobody writes it. `MaintenanceOrder` and `ContractItem` carry only a year and a frequency. Departments have no address. "4 helyszín ma, 08:30 …" would be invented. |

### Akváriumok (aquariums)

| Widget                                           | Status | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Permission       |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Mérési figyelmeztetések** (measurement alerts) | ACTIVE | Latest value per (aquarium, parameter) from `AquariumMeasurement`, compared with `aquariumEffectiveMeasurementTargetRange(waterType, code, targets)` (`packages/types/src/aquarium-management.ts:517`). That is the aquarium's own `AquariumMeasurementTarget`, or else the shared `AQUARIUM_MEASUREMENT_TARGET_RANGE` defaults, which exist **only for marine** (`TENGERI`). No range means no alert; **no new limits are invented.** The bounds are inclusive, as in `pilot-aquarium-water-values.tsx`. A stale reading (none, or older than 14 days) is a separate count, as in the existing rule. The query is rewritten as a `DISTINCT ON (aquariumId, parameterCode)` read, scoped by `aquariumVisibilityWhere`. | `aquariums.view` |
| **Legutóbbi vízértékek** (latest water values)   | ACTIVE | Same latest-value read: the number of aquariums with a reading, and for `KH`, `FOSZFAT` (PO₄) and `NITRAT` (NO₃) the counts in range, out of range and **without a target** (shown, never folded into "in range").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `aquariums.view` |

### Pénzügy és beszerzés (finance and purchasing)

| Widget                                                | Status      | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Permission        |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **Lejáró számlák** (invoices falling due)             | ACTIVE      | `ExternalBillingDocument` (our outgoing invoices from the Számlázz.hu feed), not cancelled, with a `dueDate`. Payment state comes **only** from the existing `paymentStateOf` / `externalPaymentFields` (`packages/types/src/billing-payment-state.ts`, `apps/api/src/billing/billing-document-list.ts`), imported and called, not reimplemented. **Only `UNPAID`, and the open part of `PARTIAL` (\|gross\| − \|paid\|), counts.** Buckets: overdue / due today / due within 7 days, with the open amount. **`UNKNOWN` is never overdue**; it is a separate "nincs fizetési adat" (no payment data) figure. Card or cash at ordering counts as `PAID`. Our own `Invoice` rows have no payment source today (`paymentState: null` in the list), so they are not counted, and the widget says so. | `billing.view`    |
| **Hiányzó számlák** (missing invoices)                | ACTIVE      | The existing `MissingInvoicesService.months()`, only called, never modified: for the current and the previous month, `originalMissing`, `notMatched`, `noInvoice`, `missingAmountHuf`, `status`. It is the full matching run over all debits, so the dashboard caches the result briefly in the dashboard module (Q4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `finance.view`    |
| **Bejövő számlák** (incoming invoices)                | ACTIVE      | Actionable only. NAV incoming invoices that are `NEW`/`DATA_FETCHED`, not booked (`purchaseInvoiceId` null), operation `CREATE`, plus `ERROR`. Mailbox documents (`IncomingSupplierDocument`) in `FAILED` or `LATE_CORRECTION`. Cheap counts on indexed status columns; the billing incoming service is not modified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `purchasing.view` |
| **Várható beérkezések** (expected arrivals)           | ACTIVE      | `ExpectedArrival` `OPEN` (plus `RECEIVED` with a late correction) and unbooked NAV invoices, the same two sources `ExpectedArrivalService.list()` merges; count by stage (`PROFORMA`/`INVOICE`/`LATE_CORRECTION`) and the first suppliers. **There is no ETA field**; Figma's "holnap" / "2 nap" (tomorrow / 2 days) cannot be shown.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `purchasing.view` |
| **Elszámolások** (settlements)                        | ACTIVE      | Actionable states only: `FoxpostSettlement` `NEEDS_REVIEW`/`ERROR`, `GlsCodReport` `NEEDS_REVIEW`, `SimplePay` report `NEEDS_REVIEW`, plus the latest sync run of each when it `FAILED`. Cheap counts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `finance.view`    |
| **JEV beszállítói párosítás** (JEV supplier matching) | **PLANNED** | (none)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | (none)            |

Why JEV supplier matching is PLANNED:

- The missing-invoice pairing runs in **shadow** mode in production, and a
  shadow run must never appear as a suggestion.
- The supplier-line suggestion (`JEV_SUPPLIER_LINE_SUGGESTION`) is `off` by
  default.
- So there is no production-visible human review queue.

### Készlet (inventory)

| Widget                                        | Status            | Source / reason                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Készlet-egyeztetés** (stock reconciliation) | ACTIVE (existing) | Already on today's dashboard (`inventoryDiscrepancies`, `inventory.view`), counting only the actionable statuses (`DISCREPANCY_STATUSES`). It moves into the framework unchanged in behaviour. Its cost (a full reconciliation pass per load) needs a cache; see Q5 on its UNAS-derived statuses. |
| **Készlet-kimenősor** (stock-sync outbox)     | **PLANNED**       | The outbox is `UnasStockSyncOutbox` (route `integrations/unas/stock-sync/outbox`). Its `FAILED`/`DEAD_LETTER` counts are a UNAS sync health signal, and the constraints freeze UNAS health checks. Its `GET summary` would be a cheap source if the owner lifts this (Q5).                        |
| **Készletfigyelő** (stock watch)              | **PLANNED**       | `ProductExtension.minimumStock/reorderPoint/safetyStock` exist, but no code computes low stock from them and nothing shows how widely they are filled. The other candidate threshold is UNAS's `AlertQty`. **No global threshold is invented.**                                                   |

### Intelligencia és rendszer (intelligence and system)

| Widget                                  | Status         | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Permission                                                                     |
| --------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **JEV intelligencia**                   | ACTIVE         | A new `groupBy` on `DecisionRun` (index `[policyKey, policyVersion, createdAt]`), today and the last 7 days, per policy. **Shown suggestions:** `ACCEPTED`, `OVERRIDDEN`, unresolved. **Errors:** `status ERROR`. **Shadow:** `HIDDEN` runs with `SHADOW_MATCH`/`SHADOW_MISMATCH`, in a separate block labelled "árnyékmérés — nem javaslat" (shadow measurement, not a suggestion). **Never "javaslat vár"** (suggestion waiting) for a hidden or shadow run, and nothing implies that JEV writes data. | `settings.manage` (holds for OWNER and ADMIN only, per "admin/owner only"; Q6) |
| **Rendszerállapot** (system status)     | ACTIVE, partly | States `OK` / `Figyelmeztetés` / `Hiba` / `Nincs adat` (OK / warning / error / no data) from data that exists. **NAV:** the latest `NavInvoiceSyncRun` (`APPLIED`/`FAILED`) and `NavConnectionSetting.verificationStatus`. **Mail invoice collection:** `SupplierInvoiceMailSyncRun`. **Foxpost / GLS / SimplePay:** their latest sync runs. **JEV:** today's `ERROR` share. **No uptime percentages.** **UNAS, Medusa and Commerce are PLANNED** (frozen) and the widget shows no row for them.         | `settings.manage`                                                              |
| **Figyelmet igényel** (needs attention) | ACTIVE         | An aggregation of the **actionable** figures of the widgets above, each linking to its screen. Each item appears only if the user may see its source:                                                                                                                                                                                                                                                                                                                                                    | per item                                                                       |

The "Figyelmet igényel" items:

- overdue invoices (open amount);
- missing invoices in the closed month;
- NAV invoices in `ERROR`;
- settlements to review;
- worksheets awaiting signature;
- open material requests;
- aquarium values out of range;
- stock discrepancies.

**Not included:** supplier matching (shadow), webshop orders (frozen) and
"urgent tickets" (there is no urgency field).

### PLANNED widgets (registered, with no data source and no endpoint)

| Widget                                                                                                                                                                                                                  | Why                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Webshop rendelési sor, the Webshop manager preset, POS · mai forgalom, the KPI row (Bevétel, Rendelések, Készletérték, Árrés), Működési áttekintés (the order pipeline), Katalógus állapota, Webshop termékadat minőség | **Webshop / commerce frozen**                                                           |
| Kereskedelem, UNAS and Medusa rows of Rendszerállapot                                                                                                                                                                   | frozen                                                                                  |
| Készlet-kimenősor                                                                                                                                                                                                       | UNAS sync health (Q5)                                                                   |
| Készletfigyelő                                                                                                                                                                                                          | no reliable threshold                                                                   |
| Mai szerviz, Következő helyszín (next location)                                                                                                                                                                         | no scheduled time or address; navigation integration                                    |
| Szerviz SLA / késésveszély (SLA / delay risk)                                                                                                                                                                           | no SLA or urgency rules                                                                 |
| Következő mérések / ICP (next measurements)                                                                                                                                                                             | no measurement schedule                                                                 |
| Akvárium állapot / health score                                                                                                                                                                                         | no scoring model                                                                        |
| Fogyóanyag / adagolás (consumables / dosing)                                                                                                                                                                            | no consumption model                                                                    |
| Személyes prioritások, Jóváhagyásra vár, Élő események, Közelgő határidők (priorities, approvals, live events, upcoming deadlines)                                                                                      | need cross-module priority, approval, event and deadline abstractions that do not exist |
| JEV beszállítói párosítás                                                                                                                                                                                               | no production-visible review queue (shadow / off)                                       |

**PLANNED widgets are not exposed to users at all**: not on the dashboard and
not in the customize panel. They exist in the registry, so the gap is
documented in code and a later PR can flip one to ACTIVE.

## 5. What can be built immediately (ACTIVE)

There are 16 in all.

- **Tasks and service:** Feladataim, Nyitott hibajegyek, Munkalapok,
  Anyagigények, Karbantartási naptár, Eszköz-karbantartás.
- **Aquariums:** Mérési figyelmeztetések, Legutóbbi vízértékek.
- **Finance and purchasing:** Lejáró számlák, Hiányzó számlák, Bejövő
  számlák, Várható beérkezések, Elszámolások.
- **Inventory:** Készlet-egyeztetés.
- **Intelligence and system:** JEV intelligencia, Rendszerállapot (NAV, mail,
  couriers, JEV), Figyelmet igényel.

Each comes with the caveats in its row above.

## 6. What stays PLANNED

See the table above. For the owner view (382:3) this means:

- **The KPI row and Működési áttekintés disappear in V1.** All four metric
  cards and the pipeline are commerce figures.
- **The right column holds only JEV intelligencia.** Katalógus állapota is
  planned.
- **The Rendszerállapot strip shows NAV, mail, couriers and JEV.**
- **"Figyelmet igényel" uses the real items listed above.** The Figma tiles
  "Várakozó rendelések" (waiting orders) and "Beszállítói párosítások —
  Jev-javaslatok várnak" (supplier matches, JEV suggestions waiting) are not
  built: the first is frozen, the second is shadow.
- **"Élő események" (live events) is planned.**

The owner preset is therefore thinner than the Figma until commerce is
unfrozen. That is intended: no invented figures.

## 7. Proposed architecture

### Shared: `packages/types/src/dashboard-widgets.ts`

No React here.

```ts
type DashboardWidgetId = "tasks" | "service-tickets" | … ;   // closed union
interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  title: string; description: string;           // Hungarian
  category: "service" | "aquariums" | "finance" | "purchasing" | "inventory"
          | "tasks" | "intelligence" | "system" | "webshop";
  requiredPermissions: readonly Permission[];   // ALL of them, existing PERMISSIONS only
  requiredCapability?: ServiceCapability;       // e.g. material requests
  recommendedRoles: readonly UserRole[];
  defaultSize: "sm" | "md" | "lg";  supportedSizes: readonly ("sm" | "md" | "lg")[];
  availability: "active" | "planned" | "experimental";
  priority: number;                             // preset ordering
  featureFlag?: string;
  dataSource?: string;                          // human note, e.g. "ExternalBillingDocument + paymentStateOf"
}
DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[];
DASHBOARD_ROLE_PRESETS: Partial<Record<UserRole, DashboardWidgetId[]>>;
DASHBOARD_STARTER_LAYOUTS: { aquarium: …, finance: … };   // selectable, never automatic

// Pure functions, unit-tested, the same on both sides:
availableWidgets(user)              // active ∩ permitted ∩ capability
presetLayout(user)                  // role preset ∩ availableWidgets
resolveLayout(user, stored | null)  // stored wins; drops unknown / planned / no-longer-permitted
sanitizeLayoutInput(user, input)    // the API's write validation
```

The registry is shared because the API must authorize and validate against
it, and the web must render from it. It goes into `@acropora/types` next to
`PERMISSIONS`, as `AUTHORIZATION.md` wants.

### API: extend `apps/api/src/dashboard/`

- `GET /dashboard/layout` returns the resolved layout and the user's available
  widgets (only those; never the full registry).
- `PUT /dashboard/layout` sanitizes against the registry and upserts
  `UserDashboardLayout`.
- `DELETE /dashboard/layout` resets to the preset by deleting the row.
- `GET /dashboard/widgets?ids=a,b,c` is **one grouped call** that computes
  only the requested widgets.
  - It runs the computations in parallel with `Promise.allSettled`.
  - It **re-checks each widget's permission and capability server-side.**
  - It returns per widget `{ status: "ok", data }`, `{ status: "error" }` or
    `{ status: "forbidden" }`.
  - So one failing source does not blank the page, and **a failure is never
    returned as zero.**
- Each widget's computation is a small provider in the dashboard module. It
  calls existing services where they exist (e.g. `MissingInvoicesService`,
  `paymentStateOf`) and modifies none of them.
- The two expensive sources (missing invoices, reconciliation) get a short
  in-process TTL cache in the dashboard module.
- `GET /dashboard/summary` stays until the web no longer uses it (the shell
  task badge does), then shrinks to `myTaskCount`.
- All routes keep `@RequirePermissions(DASHBOARD_VIEW)` at class level. The
  new controller methods go into `route-permission-coverage.spec.ts`.

### Web: `apps/web/src/components/dashboard/`

- **`DashboardPage`** replaces today's `(shell)/page.tsx` body. It loads the
  layout, then makes one `widgets` call for the enabled ids.
- **The header** follows 382:3: title, subtitle, an "N AKTÍV WIDGET" pill and
  a "Vezérlőpult testreszabása" button.
- **`DashboardGrid`:**
  - CSS grid: 4 columns on desktop, 2 below `lg`, 1 below `md`;
  - `sm` = 1 column, `md` = 2, `lg` = 4, as in 382:3, where the attention
    block is about 2/3 wide and the metric cards about 1/4.
- **`DashboardWidgetFrame`:**
  - the common container, a white card on the existing `PilotCard` tokens
    (`pilot-grey` surfaces, `pilot-aqua` accent, Inter);
  - title, subtitle, an optional pill and an optional "Megnyitás" (open)
    link;
  - uniform loading (`Skeleton`), empty (a widget-specific Hungarian message,
    e.g. "Ma nincs ütemezett karbantartás."), error ("Az adat jelenleg nem
    elérhető.") and forbidden (renders nothing) states.
- **`widgetComponents: Record<DashboardWidgetId, Component>`:** the React side
  of the registry. A missing component is a typecheck error for an active
  widget.
- **The customize panel (`PilotDrawer`):**
  - the available widgets with on/off switches;
  - reordering of the enabled ones with up/down buttons (keyboard-accessible,
    with no drag-and-drop library; DnD can come later on the same `order`
    field);
  - "Ajánlott elrendezés visszaállítása" (restore the recommended layout);
  - the two starter layouts where the user's permissions allow them.

### Tests

- **Registry, shared:**
  - permission filtering for every `USER_ROLES` value;
  - presets ⊆ available;
  - a stored layout with an unpermitted, unknown or planned widget is
    dropped;
  - order persistence;
  - reset.
- **API:**
  - `PUT` rejects or strips unpermitted widgets;
  - `widgets` returns `forbidden` for a widget the role lacks, even if
    requested;
  - error isolation (one source throws, the others still return).
- **Rules, each calibrated by breaking it once:**
  - overdue invoices (`UNKNOWN` never overdue, `PARTIAL` counts the open
    part, cancelled excluded);
  - aquarium warnings (inclusive bounds, no range means no alert, marine-only
    defaults);
  - ticket counts (hidden and finished excluded, scope applied).
- **Web (vitest):** the frame's four states, and the customize panel shows
  only available widgets.

Synthetic values only.

## 8. Schema changes

**One new model, `UserDashboardLayout`** (section 3), with a migration and the
back-relation on `User`. There are no other schema changes and no domain
model is touched.

## 9. Implementation sequence

Each PR is stacked on the previous one until it is merged, and each states
that in its body.

1. **PR 1 (this one):** the discovery report.
2. **PR 2, the framework:**
   - the registry with all widgets (active and planned), presets and
     resolver;
   - the `UserDashboardLayout` model and migration;
   - the layout endpoints and the grouped `widgets` endpoint;
   - the grid, frame and states, and the customize drawer.
   - Two trivial widgets wired: **Feladataim** and **Várható beérkezések**
     (counts only).
   - Today's cards stay reachable until their widgets replace them.
3. **PR 3, service:** Nyitott hibajegyek, Munkalapok, Anyagigények,
   Karbantartási naptár; fixes 1-3 of the current dashboard's problems.
4. **PR 4, aquariums:** Mérési figyelmeztetések, Legutóbbi vízértékek,
   Eszköz-karbantartás; fix 4.
5. **PR 5, finance:** Lejáró számlák, Hiányzó számlák, Bejövő számlák,
   Elszámolások.
6. **PR 6, inventory and purchasing:** Készlet-egyeztetés (fix 5, cache) and
   the full Várható beérkezések.
7. **PR 7, JEV, system, attention:** JEV intelligencia, Rendszerállapot,
   Figyelmet igényel. The old `DashboardCards` (Határidők, Csapatterhelés,
   Legutóbbi aktivitások, Beszerzés) are **not** retired: they stay until a
   tile replaces them (owner decision, 2026-10-02), and no V1 tile does yet.
   The same decision scopes the Munkalapok tile by role: OWNER, ADMIN and
   MANAGER count every open worksheet in their list scope, everyone else
   only those assigned to them (and the certificates of the tickets
   assigned to them). The tile only; the Munkalapok menu is unchanged.

**Out of scope throughout:**

- No change to `apps/backend`, the storefront, or any medusa or unas module.
- No change to `apps/api/src/missing-invoices` or `apps/api/src/billing`
  logic (only calls into them).
- No new permission and no CI or deploy change.

## Open questions

1. **Presets for role-less profiles.** Is a selectable starter layout right
   for "aquarium responsible" and "purchasing/finance"? Or should a user who
   maintains aquariums (`AquariumMaintainer`) get the aquarium layout by
   default?
2. **Urgent tickets.** There is no urgency field. Is "oldest open ticket age"
   an acceptable stand-in for V1? A real "sürgős" (urgent) needs a schema
   field and a decision, outside this work.
3. **Equipment-maintenance window.** Is 14 days (from the Figma example)
   right, or should it be the same 7 days as the calendar?
4. **Missing-invoices cost and cache.** `months()` reruns the full matching,
   and it lazily writes `payeeCheck` as a side effect, as the existing page
   does. Is a 5-minute in-process cache in the dashboard module acceptable?
5. **Inventory and UNAS.** Today's dashboard already shows Készlet-egyeztetés,
   and several of its statuses compare against UNAS. Keep it ACTIVE as it is
   today? And is Készlet-kimenősor (the UNAS stock-sync outbox) a frozen
   "UNAS health check" (PLANNED, as assumed here) or an inventory queue to
   show?
6. **Permission for "admin/owner only".** JEV intelligencia and
   Rendszerállapot use `settings.manage`, which holds for OWNER and ADMIN.
   Should MANAGER see them too (that would mean `dashboard.view` +
   `finance.view`, or a role check)?
7. **Proformas and delivery notes in Lejáró számlák.** `ExternalBillingDocument.kindCode`
   includes proformas (`D`) and delivery notes (`SL`), which have no payment
   due in the invoice sense. Restrict to invoice kinds? The exact code list
   needs confirming.
8. **SimplePay in Elszámolások.** SimplePay is the webshop's card payment.
   Does the commerce freeze cover its settlement reports too?
