# Mobile Home V1: discovery report

The mobile Home rebuilt around role/view presets (Figma `412:3`, frames
`413:2` Szerviz, `413:105` Webshop, `413:208` Tulajdonos · Menedzser,
`414:110` Partner szerviz, `414:214` Partner akvarista). This is a report and
a plan: **no code is in this PR.** The owner answered the questions on
2026-10-02; the answers (section "Answers") override any proposal below that
says otherwise.

The brief is the owner's mobile Home prompt with acrobot's notes (measured on
main, 2026-10-02). Where the two differ, the notes win. Measured on main
`6dee3af`.

## Summary

- **The Figma file is readable.** Node `412:3` and its five frames were read
  through the connector, with a screenshot. Every frame is the same shell:
  - a header (brand, greeting, avatar);
  - a view chip ("Szerviz nézet ▾");
  - one focus card;
  - one "Figyelmet igényel" card;
  - "Modulok" with six tiles in two columns and an "Összes" link;
  - a four-item bottom bar: Kezdőlap, Feladatok, Modulok, Profil.

  Every value in it is an example. Some have no source at all: "41,7% árrés",
  "95% időben", "96,8% high-conf", "24 perc út".

- **One Home, five presets is cheap on the phone and mostly possible on the
  server.** The server already answers `GET /dashboard/widgets?ids=` with:
  - a per-widget status (`ok` / `error` / `forbidden` / `unavailable`);
  - one failing widget never failing the response;
  - an `attention` list that names a failed source instead of counting it as
    zero.
- **Three things block a straight implementation:**
  1. **Partners cannot call the dashboard.** `PARTNER_SERVICE` has no
     `dashboard.view`, so every `/dashboard/*` route is 403 for them. Granting
     it would also open `/dashboard/summary`, whose `aquariumAlerts` and
     `managerTiles` are **not** partner-scoped. This needs a decision (Q2).
  2. **Many Figma sections have no source today.** Missing are:
     - a schedule with a time ("09:00 · Állatkert");
     - ticket priority ("Sürgős hibajegy");
     - orders waiting or problematic, and orders today (webshop frozen);
     - margin;
     - measurement and ICP due dates;
     - a JEV review queue.

     Each is listed in §7 with what is shown instead or left out.

  3. **Partner Aquarist cannot be built safely yet.** It needs a new role,
     which is the owner's permission decision. It also needs two scope leaks
     closed first, and a rule for retail customers who have no locations
     (§10). Per the brief: stop and report.
- **Icons: `@expo/vector-icons` (Ionicons outline), as an OTA update,
  measured** (owner's choice, answer 6).
  - The package is pure JavaScript; its glyphs are fonts loaded by
    `expo-font`.
  - `expo-font`'s native module is already autolinked in the app on both
    platforms.
  - Installing it leaves the runtime fingerprint unchanged on both platforms
    (§6).

## 1. The current Home (`apps/mobile/src/app/index.tsx`, 959 lines)

**Hooks, all before the early return:**

- auth (`useAuth`);
- connectivity (`useIsOnline`);
- the offline write queue (`useQueueDrain`, `useQueueBacklog`);
- push (`usePushPreference`, `usePushRegistration`);
- the local capability mirrors `getWebshopCapabilities` and
  `getServiceCapabilities` (`lib/auth/webshop-authorization.ts`);
- the asset-form prefetch into SQLite;
- `servedTileIds(user)`.

**One API call of its own:** `listUnasOrders(1, 5)`, i.e.
`GET /integrations/unas/orders?page=1&pageSize=5`, enabled by `ordersView`
(:158-162). The embedded offline downloader makes its own calls.

**Rendered, top to bottom:**

1. queue-drain and backlog banners (the backlog banner opens `/queue`);
2. the offline-session banner;
3. a hero ("ACROPORA OS" or "FIELD SERVICE", role badge, "Szia, …!");
4. "Modulok": ten fixed `ModuleCard`s with emoji icons;
5. the zero-tiles card with a retry that reruns `/auth/me`;
6. `HelyszinLetolto`, the offline location download (if `assetsView`);
7. **"Legutóbbi rendelések"**: three UNAS orders, with loading, error, empty
   and "Összes" states;
8. the account card ("Beállítások ›", **Kijelentkezés**);
9. the version line.

**Pinned by source-reading specs**, all of which this work rewrites on
purpose (Phase 1 lists each one in its PR):

| Spec                                                   | What it pins                                               |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `lib/auth/tile-visibility.spec.ts`                     | 10 tile codes, plus the "Nincs megjeleníthető modul" retry |
| `lib/auth/tile-order.spec.ts`                          | Fixed tile order, and the SERVICE subset                   |
| `lib/home-module-icons.spec.ts`                        | Exact emoji, the `48%` grid, header `headerRight`          |
| `lib/auth/nav-tile-roles.spec.ts`                      | `code="NAV"`                                               |
| `apps/api/src/mobile/mobile-capability-values.spec.ts` | Every mobile navigation entry has a tile                   |
| `apps/api/src/mobile/mobile-screen-routes.spec.ts`     | Home links to `/settings`; every link has a route file     |

## 2. Tile visibility today

- `TILE_ENTRY` (`lib/auth/tile-visibility.ts:21-44`) maps a tile code to a
  shared navigation entry id:

  | Code | Entry id                    | Route                           |
  | ---- | --------------------------- | ------------------------------- |
  | HJ   | `service-jobs`              | `/service-jobs`                 |
  | MU   | `worksheets`                | `/worksheets`                   |
  | AI   | `material-requests-pending` | `/material-requests`            |
  | ES   | `service-assets`            | `/assets`                       |
  | AK   | `aquariums`                 | `/aquariums`                    |
  | RE   | `webshop-orders`            | `/orders`                       |
  | PA   | `partners`                  | `/partners`                     |
  | BE   | `purchasing`                | none, disabled "Következő ütem" |
  | TE   | `products`                  | none, disabled                  |
  | NAV  | `nav-integration-mobile`    | none, disabled                  |

- **The server decides.** `servedTileIds` reads the `navigation` the server
  sends on login and on `/auth/me` (mobile-surface entries only).
  `tileVisible` is a set lookup. There is no local fallback: no menu means no
  tiles, and the screen says so.
- **This stays the rule.** A preset may order and pick tiles, but a tile is
  drawn only when its entry was served. Permissions win by construction.

## 3. User, role and capability model

**Roles and permissions**

- **One role per user** (`User.role`).
- `ROLE_PERMISSIONS` (`packages/types/src/auth.ts:280-529`) is the only
  permission source. There are no per-user overrides
  (`docs/dashboard/v1-discovery.md:84-110`).
- Per-user second gates exist as `UserServiceCapability` flags:
  `MATERIAL_REQUEST_MARK_RECEIVED`, `AQUARIUM_ASSET_ASSIGN`, and the two
  signed-upload flags. They are checked in services, not in
  `@RequirePermissions`, and navigation cannot filter on them.

| Role                | Has `dashboard.view` | Relevant permissions                                          |
| ------------------- | -------------------- | ------------------------------------------------------------- |
| OWNER, ADMIN        | yes                  | all                                                           |
| MANAGER             | yes                  | all but a few admin ones (no `settings.manage`)               |
| SALES               | yes                  | orders, products, customers, inventory.view, finance.view     |
| WAREHOUSE           | yes                  | orders.view, products, inventory, purchasing, partners        |
| SERVICE             | yes                  | tasks, partners.view, service, aquariums                      |
| VIEWER              | yes                  | every `*.view`                                                |
| **PARTNER_SERVICE** | **no**               | service.view/manage, aquariums.view/manage, **no tasks.view** |

**Partner link**

- A partner user carries `customerId` or `supplierId` (at most one, enforced
  by a DB check).
- `partnerScopeOf(user)` reads that link, **never the role**
  (`apps/api/src/auth/partner-scope.util.ts:31`).

**On the phone**

- The mobile app keeps a hand-maintained copy of the role union and of two
  capability tables (`webshop-authorization.ts`). These are display hints
  only; the server still decides.

## 4. PARTNER_SERVICE scoping (unchanged by this work)

**Locations**

- Locations are the `WorksheetDepartment` tree. A user is assigned nodes via
  `UserWorksheetDepartment`, and sees each node plus everything beneath it.
- **No assignment means nothing is visible.** An empty list becomes
  `{ id: { in: [] } }`, never `{}`.

**Scope is applied in services and repositories:**

| Area               | Rule                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Tickets            | `serviceJobVisibilityWhere`: own customer AND (opened by me OR `departmentId in units`)                           |
| Worksheets         | Customer + `departmentId in assigned`                                                                             |
| Assets             | `assetVisibilityForAndBranch`                                                                                     |
| Aquariums          | `aquariumVisibilityWhere`: own customer AND `departmentId in subtree`; aquariums without a location are invisible |
| Maintenance orders | Visible only when all item locations are covered                                                                  |
| Material requests  | Internal only (`requireInternalWriter`)                                                                           |

**The 2026-09-22 incident (c654a5d4)**

- A portal user assigned to four locations saw the whole customer. The ticket
  filter was `customer.worksheetDepartments.some(id in units)`, which is true
  for every ticket of that customer.
- The fix moved the filter onto the row itself (`departmentId in units`). The
  asset branch got the same AND-clause.
- Pinned by `service-job-visibility.spec.ts:57-125`,
  `asset-unit-visibility.integration.spec.ts` and
  `worksheet-departments-scope.integration.spec.ts`.
- The brief's "52 of 53 locations" figures are not in the repo. The
  calibration in Phase 2 rebuilds exactly that case: four assigned locations
  out of many, and nothing outside them.

**The "Partner szerviz" preset**

- It uses this scope unchanged, through the endpoints that already apply it.
- It adds no scope code. The mobile `hatokor.ts` stays a display hint
  (`hatokor.spec.ts`).

## 5. Router and bottom navigation

**Today**

- One root `<Stack>` (`app/_layout.tsx`): no tabs, no nested layouts, no
  bottom bar.
- Index header: title "Acropora OS", plus an emoji gear that opens
  `/settings`.
- Route files:
  - `index`, `login`, `settings`;
  - `queue`, `queue-fix/[id]`, `queue-resolve/[id]`;
  - `orders/*`, `service-jobs/*`, `worksheets/*`, `material-requests/*`;
  - `assets/*`, `partners/*`, `aquariums/*`.
- Deep links:
  - push targets: worksheet, service job, material request, aquarium;
  - schemes: `acropora-os(-dev|-preview)`.
- `settings.tsx` has the profile header, the push switch, the theme choice
  and "Vissza". **It has no logout.** Logout is on Home.

**Recommendation: keep the Stack and draw one shared bottom bar on four
screens, rather than moving routes into an `expo-router` `(tabs)` group.**

| Tab       | Route        | Notes                                  |
| --------- | ------------ | -------------------------------------- |
| Kezdőlap  | `/`          |                                        |
| Feladatok | `/feladatok` | new                                    |
| Modulok   | `/modulok`   | new                                    |
| Profil    | `/settings`  | the existing screen; logout moves here |

Why:

- every existing route and deep link stays exactly where it is;
- `mobile-screen-routes.spec.ts` keeps working;
- detail screens keep their Stack headers and back gesture.

**The bar is one component with a fixed item list**, so it is identical for
every preset. That is one of the calibrations.

## 6. Icon strategy

**Today**

- Emoji in `Text` for the tiles and the gear; `›` for arrows; initials for
  the avatar.
- The app has no vector icon library (`_layout.tsx:92-94`).

**Decision (owner, answer 6): `@expo/vector-icons`, the Ionicons outline
set, behind a thin `Icon` component and one name map.**

The bottom bar uses four glyphs, all present in the bundled Ionicons glyph
map:

| Tab       | Glyph                      |
| --------- | -------------------------- |
| Kezdőlap  | `home-outline`             |
| Feladatok | `checkmark-circle-outline` |
| Modulok   | `grid-outline`             |
| Profil    | `person-circle-outline`    |

The module tiles take outline glyphs from the same map. The Figma's code
marks (HJ, ML, AI…) are placeholders, as the brief says.

**Delivery: OTA, measured** with `npx fingerprint fingerprint:generate` on
main `6dee3af`:

- **Why it can ship as an update.** `@expo/vector-icons` (`~15.0.2`, the
  version `expo`'s `bundledNativeModules.json` names) has no dependencies and
  no native code. It peers on `expo-font`. `expo-font` is native, and it is
  already autolinked on both platforms: the fingerprint lists
  `dir:node_modules/expo-font/ios` and `dir:node_modules/expo-font/android`.
- **Fingerprint unchanged.** Installed temporarily and declared in
  `package.json`, both hashes stayed the same:
  - iOS `3f4966325b3b6e20f295f8da21cc45f668d1f8e9`;
  - Android `93a68ef92e917f3ec0461b5dc56db17a33b6df10`.

  The installation was reverted afterwards.

- **What "unchanged" means.** With `runtimeVersion: { policy: "fingerprint" }`
  the update targets the builds whose runtime is that fingerprint. Whether
  the store builds in use carry exactly this runtime is visible in EAS, not
  in the repository. Phase 1's PR states the runtime it targets, so it can
  be checked there before publishing.

The earlier `expo-symbols` proposal is dropped. It is a native module, and its
Android side is a font-drawn fallback; the owner chose the font-only route.

## 7. The real source of each Home section

**One request per Home**: `GET /dashboard/widgets?ids=attention,<the preset's
widgets>`.

`attention` reuses the per-request memo, so a widget the tiles also need is
loaded once. A failed source arrives as `unavailable: [{widgetId, title}]` and
is shown as "Az adatok jelenleg nem frissíthetők", never as zero.

**Szerviz**

| Section                                                                      | Source today                                                                                                                                | V1 shows                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focus: "next location 09:00"                                                 | None. `today-service` and `next-location` are planned: `ServiceJob.scheduledAt` is never written, and maintenance orders carry only a year. | **"Esedékes karbantartás"** from `maintenance-calendar` (overdue / today / 7 days, soonest three with the place name; day only, no time), plus the offline readiness of that place. "24 perc út" is left out (no travel data). |
| Sürgős hibajegy                                                              | None: tickets have no priority field (`dashboard-widgets.ts:966-970`)                                                                       | Left out. The server's `service-tickets` "new" item is shown instead.                                                                                                                                                          |
| Új anyagigény                                                                | `material-requests` (needs the `MARK_RECEIVED` capability)                                                                                  | As served                                                                                                                                                                                                                      |
| Lezárandó munkalap                                                           | `worksheets` (`not-sent`)                                                                                                                   | As served                                                                                                                                                                                                                      |
| Tiles: Hibajegyek, Munkalapok, Anyagigények, Eszközök, Akváriumok, Partnerek |                                                                                                                                             | Status lines from `service-tickets`, `worksheets`, `material-requests`, `maintenance-calendar`, `aquarium-alerts`; Partnerek has none                                                                                          |

**Webshop.** The webshop is frozen, so V1 uses only what the OS serves today.

| Section                                                         | Source today                                                                                 | V1 shows                                                                                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focus: orders waiting                                           | `GET /integrations/unas/orders` has no status filter; `webshop-orders` is planned and frozen | **Not built.** Adding a filter is a commerce change. The focus card shows `expected-arrivals` instead (Q4).                                                 |
| Problémás fizetés, problematic orders                           | None                                                                                         | Left out, and listed in the PR                                                                                                                              |
| Készletfigyelmeztetés                                           | `stock-reconciliation`, `stock-sync-outbox` (`stock-watch` planned)                          | As served                                                                                                                                                   |
| Várható beérkezés                                               | `expected-arrivals`                                                                          | As served                                                                                                                                                   |
| Tiles: Rendelések, Termékek, Készlet, Beszerzés, NAV, Partnerek |                                                                                              | Rendelések keeps its tile with no count. Termékek, Beszerzés and NAV have **no mobile screen** today (disabled tiles); Készlet has no mobile entry. See Q4. |

**Tulajdonos · Menedzser**

| Section                          | Source today                                                                                                    | V1 shows                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focus: "1,28 M Ft · 38 rendelés" | `pos-today` is planned and frozen. There is no margin metric.                                                   | **The attention summary**: how many items need attention across the sources this user may see, and which sources could not be read. No revenue, no margin. |
| Finance                          | `overdue-invoices`, `missing-invoices` (heavy on a cache miss, 5-min cache), `incoming-invoices`, `settlements` | Through `attention`                                                                                                                                        |
| Inventory, purchasing, service   | `stock-*`, `expected-arrivals`, `incoming-invoices`, `service-tickets`, `worksheets`, `material-requests`       | Through `attention` and tile lines                                                                                                                         |
| JEV                              | `jev-intelligence` (OWNER/ADMIN only, metrics only); no review queue, no "high-conf"                            | Tile with run and error counts for those who may see it. No accuracy figure.                                                                               |

**Partner szerviz.** None of these sections can come from `/dashboard/*` until
Q2 is answered.

| Section                    | Source today                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Focus                      | Scoped `GET /service/jobs` and `GET /service/worksheets`                                  |
| Új hibajegy                | `service-tickets` loader (scoped)                                                         |
| Anyagigény folyamatban     | **None for partners**: material requests are internal only                                |
| Aláírt dokumentum hiányzik | Worksheet signature states and certificates (scoped list endpoints); no partner aggregate |

**Partner akvarista**: see §10.

**Missing sources, collected.** These are not built in this work. Each is
either a planned widget with a stated reason or a missing model:

- schedule with time;
- travel time;
- ticket priority;
- order processing state;
- payment problems;
- POS today;
- margin;
- measurement and ICP schedule;
- aquarium health score;
- JEV review queue.

## 8. Is a consolidated mobile Home API justified?

**No new endpoint is needed for internal users.** `GET /dashboard/widgets`
already is the consolidated, permission-filtered, per-widget-status
aggregate, and the web uses it. Reading the same list means web and phone
cannot disagree.

**Two small server changes are proposed (new backend requirements):**

1. **An unknown widget id should not fail the whole request.** Today it is a
   400 (`dashboard-widgets.service.ts:148-152`).
   - A new app talking to an older server (OTA lands before the API deploy,
     or the reverse) would lose the whole Home.
   - Proposal: an unknown id returns `{status:"unavailable"}` for that id,
     with a test.
   - This changes the web's behaviour too, so it needs approval (Q3).
2. **Attention sources the presets need but the server lacks.** Any new one
   is added to `attention.ts` with a test, never computed on the phone.
   V1 needs none beyond what exists, given the left-outs above.

**Cost control:** each preset requests only its ids. `missing-invoices` and
`stock-reconciliation` are heavy; only the owner preset asks for them.

**Partners need Q2**, either a route they may call or a permission split
(§10, Q2).

## 9. Multi-preset model and persistence

**Shape** (`apps/mobile/src/lib/home/presets.ts`, pure, no `@/` imports, so
`node:test` can load it):

```ts
interface MobileHomePreset {
  id: "service" | "webshop" | "owner" | "partner-service";
  label: string; // "Szerviz nézet"
  /** Served navigation ids; the preset is offered only if ALL are served. */
  requires: readonly string[];
  focus: FocusSource; // which widget feeds the focus card
  attentionSources: readonly DashboardWidgetId[];
  modules: readonly TileCode[]; // ~6, in order; unserved ones are skipped
  widgetIds: readonly DashboardWidgetId[]; // what this preset requests
}
```

**Eligibility comes from the served menu, so the server decides:**

| Preset          | Requires (served entry ids)                    | Default for                   |
| --------------- | ---------------------------------------------- | ----------------------------- |
| owner           | `dashboard`, `billing`                         | OWNER, ADMIN, MANAGER, VIEWER |
| webshop         | `webshop-orders`                               | SALES, WAREHOUSE              |
| service         | `service-jobs`                                 | SERVICE                       |
| partner-service | `service-jobs`, and the user is partner-scoped | PARTNER_SERVICE               |

- **The view chip** appears only when more than one preset is eligible.
  Choosing one changes order and emphasis, never what is fetched beyond the
  preset's own ids. Every id keeps its server permission check.
- **Persistence:**
  - Stored in SecureStore under `acropora.home-preset` as
    `{ userId, presetId }`, following `theme-preference-store.ts`. SecureStore
    is the app's only local store; a comment there says so.
  - On read it is validated: a different user, an unknown id, or a preset no
    longer eligible falls back to the role default.
  - Not cleared on sign-out (like the theme), but bound to the user id.
- **Future personalisation** (order, hidden modules) fits the same record. It
  is not built in V1.

**Offline**

- The last widgets response is written to the existing SQLite database as one
  row (`cached_home_summary`: user id, preset id, JSON, fetched-at), through
  `migrations.ts`, the same way the other caches are.
- When the request fails, Home renders from that row with "Utolsó frissítés:
  …" and the counts marked as not current. There is no separate offline
  system.
- `forgetOfflineData()` clears it on sign-out.

**Feladatok** (acrobot note 5): the user's own open items, from existing
lists:

| Source            | Endpoint                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| Tickets           | `GET /service/jobs?scope=mine` (exists, `service-job-list-scope.ts:53`) |
| Worksheets        | Assigned to me                                                          |
| Material requests | `overview?view=mine` (handler = me)                                     |
| Tasks             | `GET /tasks/mine` (`tasks.view`)                                        |

- There is no new task entity.
- Partners have no `tasks.view` and no material requests. Their Feladatok
  shows their own tickets and worksheets only.

**Modulok**: every served tile, in one list, as the launcher. The tiles with
no mobile screen stay disabled with their reason, as today.

## 10. Partner Aquarist: recommended authorization model

**Answers to the brief's five questions**

1. **Can PARTNER_SERVICE infrastructure be generalised? Yes, for scope.**
   - Scope follows the partner link, not the role. Any user with a
     `customerId` is already location-scoped by `aquariumVisibilityWhere`,
     `assetVisibilityForAndBranch` and `serviceJobVisibilityWhere`.
   - Partner aquarium create (own customer, assigned location required) and
     partner measurement entry already exist; edit, delete and export are
     internal only.
   - What is not general are the **hard-coded role points**:
     - `users.service.ts:144-152`: a linked account must be PARTNER_SERVICE;
     - the web user editor (`user-editor-page.tsx:116,251,346`);
     - the partner portal gate (`portal-shell.tsx:208`);
     - the mobile role copy (`types.ts`, `webshop-authorization.ts`,
       `hatokor.ts:70`).
2. **A new role, PARTNER_AQUARIST, not a capability bundle.**
   - `@RequirePermissions` reads only the role. `UserServiceCapability` flags
     can narrow a role but cannot grant an endpoint.
   - A partner-user "type" would be a second role column, and nothing reads
     one.
   - Proposed permissions: `aquariums.view`, `aquariums.manage` (measurement
     entry needs it; partner edits are already blocked server-side). **No
     `service.*`.**
   - It joins `PARTNER_ROLES`, so `INTERNAL_ROLES` excludes it automatically.
3. **Aquarium-level isolation: server-side, by location, as today.**
   - Reach = **the assigned locations' aquariums**, not the customer's.
     `aquariumVisibilityWhere` already says "own customer AND
     `departmentId in` the assigned subtree", and an aquarium without a
     location is invisible.
   - This keeps the owner's 2026-09-22 rule (no assignment means nothing).
   - The Phase 3 calibration reuses the four-of-many case.
   - **Two leaks must be closed first**, because PARTNER_SERVICE can reach
     them today:
     - `GET /aquariums/customers` (`aquariums.view`) lists every active
       customer's name and city with no scope
       (`aquariums.controller.ts:59-63`, `aquariums.service.ts:104`);
     - `GET /aquariums/maintainers/selectable` (`aquariums.manage`) lists
       internal staff with no internal check.
4. **One user, several sites: yes, within one customer.**
   `UserWorksheetDepartment` holds many rows (production accounts have four
   and three). Several customers: no; one `customerId`, and `mayAssignUnit`
   refuses others.
5. **Both partner-service and partner-aquarist: yes, as PARTNER_SERVICE.**
   PARTNER_SERVICE already holds `aquariums.view/manage`, so a service
   partner already sees their aquariums. The aquarist is the narrower role.
   With one role column, "both" means PARTNER_SERVICE; no union role is
   needed.

**What the aquarist Home could show with real data:**

- Focus: `water-values` (latest KH / phosphate / nitrate in range,
  out of range, not measured).
- Attention: `aquarium-alerts` (out of range, plus "not measured for 14 days"
  as the only honest "due" signal).
- These loaders are already aquarium-scoped. The rest does not exist:
  - **ICP:** `IcpReport.aquariumId` has no relation and there is no ICP API;
  - **equipment:** asset routes and `aquarium-equipment` need `service.view`,
    which the role would not have;
  - **measurement or ICP due dates:** no schedule model;
  - **"Segítség":** no partner help or ticket route without `service.*`.

**Why Phase 3 stops here (the brief's "stop and report")**

- **A new role is a permission change.** The owner approves it before merge
  (acrobot note 2).
- **Retail customers have no locations.** Locations exist mainly for zoo and
  service-partner customers. A home-aquarium owner given this role would see
  nothing until locations are created and set on their aquariums. That is a
  product decision, not code (Q5).
- **Partners cannot call the dashboard.** The Home sources are gated as in
  Q2.

## Existing, UI-only, and new backend

|                                             | Items                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Existing, reused as is**                  | Served navigation and tile visibility; `/dashboard/widgets` with per-widget status; the `attention` list; partner scope; `/service/jobs?scope=mine`; `/tasks/mine`; SecureStore preference pattern; SQLite cache and migrations; `HelyszinLetolto`; `expo-font` (already linked) |
| **UI / preset only**                        | Home shell, focus and attention cards, module tile, bottom bar, icon map, preset resolver and chip, `/feladatok` and `/modulok` screens, logout moved to Profil, "Legutóbbi rendelések" removed, Home offline snapshot                                                           |
| **New backend (approved, each its own PR)** | Closing the two aquarium leaks (first); unknown widget id → `unavailable`, with a test; a read-only partner summary with the existing partner scope and no new permission; the PARTNER_AQUARIST role (only after the leak fix)                                                   |

## Phases (each a separate PR from `main` after the previous one merges)

Before the Home phases, as their own PRs:

- **A. The two aquarium leaks** (answer 5, first). The PR names each leak and
  what a partner could see through it.
- **B. Unknown widget id → `unavailable`** (answer 3), with a test.

Then:

1. **Shared framework.**
   - Shell, preset resolver (role default only, no chip yet), focus, attention
     and tile components, bottom bar, `/modulok`, Profil logout, icon map.
   - "Legutóbbi rendelések" removed.
   - **No new data** (acrobot note 10): the focus and attention cards are not
     drawn yet, and the tiles keep today's served-navigation rule.
   - The pinned specs (§1) are rewritten in the same PR.
2. **Presets on real data.**
   - One `/dashboard/widgets` request per preset, the chip with SecureStore
     persistence, the SQLite snapshot with last-refresh time, `/feladatok`,
     and the left-out list in the PR.
   - The internal presets first. Webshop tiles with no mobile screen are not
     on the preset (answer 4).
   - The partner summary endpoint (answer 2) and the Partner szerviz preset on
     it, as their own PR.
3. **Partner Aquarist role**, after PR A has merged, as its own PR, then its
   preset.
4. **Polish.** Loading, error and empty states for every card and tile, and
   visual parity, with fixture screenshots per preset.

**Calibrations planned** (acrobot note 11), each broken once:

- a tile and its attention item disappear without the permission;
- a partner sees nothing outside four assigned locations;
- Home makes one dashboard request;
- offline renders from cache with the last-refresh time;
- the bottom bar is identical for every preset.

## Answers (owner, 2026-10-02)

These answer the questions below. They override any proposal above that says
otherwise.

1. **Left-outs: agreed.** Anything with no real data source is left out, not
   approximated. Each PR lists what was left out and why.
2. **Partner Home data: not (a).** `/dashboard/widgets` was built for internal
   staff. Opening it to partners with a new permission would make every
   current and future widget a partner-safety obligation. Instead:
   - **a separate, read-only partner summary** that filters with the existing
     partner scope (assigned locations; no location means nothing);
   - **no new permission.**

   Design for that PR:
   - **Route and permission.** A read-only `GET` under `service/` on
     `service.view`, an existing permission PARTNER_SERVICE already holds. It
     refuses an internal caller, who has the dashboard.
   - **Shape.** Built only from the where-builders the partner list pages
     already use:
     - `serviceJobVisibilityWhere` (open and new tickets);
     - the worksheet scope (awaiting signature, not sent and sent);
     - `assetVisibilityForAndBranch` (`nextServiceAt` overdue, today, 7 days);
     - `aquariumVisibilityWhere` (out-of-range, stale).
   - **No locations.** The answer carries the number of assigned locations.
     With none, the phone says "Nincs hozzád rendelt helyszín" instead of
     showing zeros as if everything were fine.
   - **Per section, an error is an error.** It is never zero; the same
     per-section status as the widgets.
   - **Calibration.** The four-of-many case: nothing outside the assigned
     locations. A user with no assignment gets nothing.

3. **Unknown widget id: yes.** Only that widget is "unavailable"; the rest of
   the request goes through. This is good for the web too, since an older
   phone build may send an id that no longer exists. With a test.
4. **Webshop tiles with no screen: left out.** No tile that leads nowhere.
5. **Partner Aquarist.**
   - **Reach:** by assigned location, matching the earlier partner decision.
   - **The two leaks first,** as a separate PR that names exactly what each
     leak is and what a partner could see until now.
   - **The new role only after that,** in its own PR.
6. **Icons:** `@expo/vector-icons` (Ionicons outline: house, check in a
   circle, grid, profile). It arrives as a font, so it can ship as an update
   if the needed part is in the current build. Measured first; see §6. The
   Phase 1 PR states: update or build.

## Questions for the owner (answered above)

1. **The left-outs (§7).** Is it right that V1 leaves out, rather than
   approximates, the things with no source? These are: the time-of-day
   schedule and travel time, urgent tickets, order processing state, payment
   problems, today's revenue and orders, margin, ICP and measurement due
   dates, and JEV accuracy. The focus cards then show "Esedékes karbantartás"
   (service), "Várható beérkezések" (webshop) and the attention summary
   (owner).
2. **Partners and the dashboard.** Choose one:
   - (a) a new permission that opens only `GET /dashboard/widgets`, with a
     test that a partner role can reach only scoped widgets
     (`service-tickets`, `worksheets`, `maintenance-calendar`,
     `aquarium-*`, `attention`). `/dashboard/summary` and `layout` stay on
     `dashboard.view`;
   - (b) the partner Home reads the scoped list endpoints it can already call
     (tickets, worksheets), a few small requests instead of one;
   - (c) no partner Home data until later.

   Recommendation: (a). It keeps one source, but it is a permission change.

3. **Unknown widget ids** return `unavailable` instead of failing the request
   (affects web too)?
4. **Webshop tiles with no mobile screen** (Termékek, Beszerzés, NAV, Készlet):
   show them disabled as today, or leave them off the webshop preset until
   they exist? Recommendation: leave them off the preset; they remain in
   Modulok as disabled.
5. **Partner Aquarist.**
   - (a) Approve a new PARTNER_AQUARIST role with `aquariums.view/manage`
     only?
   - (b) Reach = assigned locations' aquariums (today's rule), accepting that
     retail customers need a location created first? Or is "all of the
     customer's aquariums" wanted for this role? The latter is a new rule
     against the 2026-09-22 decision.
   - (c) Close the two aquarium leaks now as a separate fix PR?
6. **Icons.** Accept `expo-symbols` (SF Symbols on iOS, Material Symbols on
   Android, OTA) rather than the Figma's exact SVG shapes, which would need
   `react-native-svg` and a new store build?
