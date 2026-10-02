# JEV Product Intelligence V1: discovery report

Phase 1 of the JEV Product Intelligence UI (Figma `394:466`). This is a report
and a plan only: **no code is in this PR.** Nothing is built until the open
questions at the end are answered.

References: Architecture Council #1199, ACD-021 / PD-011 (Product Enrichment &
Verification), merged #1370 (offline V0 scaffolding, `docs/jev/product-enrichment-v0.md`),
ACD-022 / P-036 (real-product offline benchmark protocol). The webshop / UNAS
freeze and its ACD-021 exception (owner, 2026-10-01 19:07 UTC) apply
throughout.

## Summary

- **The Figma file is readable.** Node `394:466` and its three frames were
  read through the Figma connector (`394:18` product review, `394:196` source
  conflict, `394:316` catalogue quality), with screenshots. Nothing below is
  reconstructed from the brief's text.
- **There is no runtime product-enrichment data, and no path to any.** No API
  module, endpoint, database model or web code references product enrichment.
  `@acropora/jev` deliberately does not export it. In production, every JEV
  view can therefore only show the honest "never checked" / "unavailable"
  state.
- **What can be built today with real data:** the presentational components
  (status badge, field review row, source card, review summary, queue table),
  the "current product data" column from the existing `ProductDetail`, and the
  unavailable / never-checked / error states. All decision and run controls
  stay disabled.
- **Six places where the Figma contradicts the V0 contract or has no real data
  behind it** (§9). The most important: the conflict row shows a JEV value,
  but V0 returns no value for `CONFLICTING_SOURCES`. Showing one would be the
  silent winner the brief forbids.
- **No feature-flag framework exists** (§7). The smallest option fits the
  existing `JEV_*` environment-variable convention.

## 1. The existing product detail architecture

- **Route:** `apps/web/src/app/(shell)/products/[id]/page.tsx` (10 lines) renders
  `<ProductDetailPage productId>`.
- **Component:** `apps/web/src/components/products/product-detail-page.tsx` (1204
  lines, `"use client"`). One `productApi.detail(token, id)` call
  (`apps/web/src/lib/api/products.ts:48`) feeds the whole page. A refetch bumps
  `requestVersion`.
- **Permission gates:** `canView` (PRODUCTS_VIEW), `canManage`
  (PRODUCTS_MANAGE), `canTransferAuthority` (PRODUCTS_CATALOG_AUTHORITY_TRANSFER).
- **Layout:** `PilotPageHeader`, then `PilotPairedRows`
  (`packages/ui/src/pilot-os.tsx:300`). That is a two-column grid from `xl` up,
  with a fixed 352px side column, inside the shell's `max-w-[1600px]` main.
  There are no tabs.
- **Rows, main | side:**
  1. authority (`product-authority-card.tsx`, "Katalógusgazda") | Alapadatok
  2. basics editor (Acropora-authority products only)
  3. shipping profile | Készlet és beszerzés
  4. **UNAS terméktükör** (lines 880-1008) | Csatornák
  5. Változatok és SKU-k (with `BarcodeEditor` and `ProductExtensionEditor`) | Belső megjegyzés
  6. description
  7. images
- **Frozen, untouched by this work:** the authority card, the UNAS mirror and the channels.

**What this means for the JEV section.** The product review frame (`394:18`) is
a full page, not a card: it has its own page header ("Termékadat-ellenőrzés"),
product header, a 498px "current data" column and an 800px review panel.
Putting all of it into a `PilotPairedRows` row would make the detail page
wider and longer than it is designed to be. The proposal in Q1 is a sub-route,
plus one compact entry card on the detail page.

## 2. The relevant product-enrichment code from #1370

`packages/jev/src/product-enrichment/` (offline, no DB, no network, no write):

- **`provenance.ts`:**
  - `FIELD_STATUSES`: VERIFIED, SUGGESTED, MISSING, CONFLICTING_SOURCES,
    UNVERIFIED, POSSIBLE_WRONG_VALUE.
  - `SOURCE_PRECEDENCE`: MANUFACTURER_PAGE, MANUFACTURER_DOCUMENT,
    SUPPLIER_PAGE, OS_PRODUCT_MASTER, UNAS_CURRENT, SUPPLIER_DOCUMENT,
    KNOWLEDGE_BASE.
  - `JEV_PROPOSAL` is a source type, but never evidence.
  - `INDEPENDENT_SOURCES` contains only the manufacturer and supplier
    sources. The OS and UNAS cannot verify themselves; this is the rule the
    Figma's "BELSŐ ADAT" card expresses.
  - `FieldResult`: `value`, `sourceType`, `sourceRef`, `retrievedAt`,
    `confidence`, `status`, `conflicts`, `evidence`, `rejected`,
    `reconciledAt`.
- **`fields.ts`:**
  - `FIELD_SPECS` with the tiers:
    - **A:** searchKeywords, seoTitle, metaDescription, featureBullets,
      categorySuggestion, shortDescription, longDescription.
    - **B:** title, category, compatibility, application, dosingText,
      productFamily.
    - **C:** ean, manufacturerSku, length/width/heightMm, volume, weight,
      flowRate, power, voltage, dosingAmount, composition, warranty,
      safetyInformation.
    - **C by default:** brand, capacity, packSize, packageContents.
  - A claim policy per field: `none` / `value` / `prose`.
- **`reconcile.ts`:** `reconcileField`. On `CONFLICTING_SOURCES`,
  `POSSIBLE_WRONG_VALUE`, `MISSING` and `UNVERIFIED`, **`value` is `null`**,
  and the disagreeing values are in `conflicts`.
- **`guard.ts`, `gtin.ts`, `units.ts`, `benchmark.ts`:** validation,
  normalization and the offline benchmark.
- **`confidence`** is the _extraction_ confidence (the lowest one in the
  agreeing group), or `null` when nothing was model-extracted. It is not a
  probability that the value is true (§9.3).
- **Not exported.** `packages/jev/src/index.ts` deliberately leaves it out
  ("V0 has no live call path"), and `package.json` exports only `"."`. The web
  app does not depend on `@acropora/jev` at all.

## 3. Real current data availability

| Figma element                                                                 | Real source today                                                                                                                                  | Verdict           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Product name, SKU, origin, variant count                                      | `ProductDetail`                                                                                                                                    | real              |
| "Jelenlegi termékadatok": Márka, Gyártói cikkszám, EAN, Kategória, OS készlet | `brand`, `variants[].manufacturerPartNumber`, `variants[].barcodes`, `primaryCategory`, the stock the page already shows in "Készlet és beszerzés" | real              |
| "Termékleírás" (current webshop / UNAS text)                                  | `ProductDetail.description` (sanitized)                                                                                                            | real, read only   |
| Field review rows (JEV value, status, source, confidence)                     | none                                                                                                                                               | unavailable       |
| "4 forrás · 12 vizsgált mező · utolsó futás 22:41"                            | none: there is no run record                                                                                                                       | unavailable       |
| "78% ADATMINŐSÉG"                                                             | none: no defined calculation                                                                                                                       | must not be shown |
| "3 JAVASLAT", "1 ÜTKÖZÉS"                                                     | none                                                                                                                                               | unavailable       |
| Source cards (value, description, time, state, link)                          | none                                                                                                                                               | unavailable       |
| Catalogue KPIs, review queue, "261 ellenőrzendő rekord"                       | none                                                                                                                                               | unavailable       |

Fields the Figma reviews that have **no product column at all**: volume / pack
size, flow rate (Teljesítmény), power, dimensions. They exist only in
`FIELD_SPECS`. So even "current value" is `—` for them, and that is honest. No
schema change is proposed (non-goal).

The related prior work, `apps/api/src/products/product-data-completeness.ts`,
is a read-only completeness analysis for livestock naming and forbidden
claims. It is not the ACD-021 field model and is not reused as a quality
score.

## 4. Permissions

- `PRODUCTS_VIEW`: OWNER, ADMIN, MANAGER, SALES, WAREHOUSE, VIEWER (not SERVICE).
- `PRODUCTS_MANAGE`: OWNER, ADMIN, MANAGER.
- `PRODUCTS_CATALOG_AUTHORITY_TRANSFER`: OWNER, ADMIN.
- `SETTINGS_MANAGE`: OWNER, ADMIN. This is the dashboard's "JEV intelligencia"
  widget, which is system telemetry over `DecisionRun`.

**Proposal: product JEV evidence follows the product permissions, not
`settings.manage`.**

- Seeing evidence: `PRODUCTS_VIEW`.
- Recording a decision (once a write contract is authorized): `PRODUCTS_MANAGE`.

The reason: evidence about a product's EAN or flow rate is product data. A
warehouse or sales user who can read the product must be able to see that its
EAN is unverified. The dashboard widget, by contrast, measures the decision
system itself (run counts, shadow agreement, errors), which is an operator
concern.

No new permission is proposed. Every future route goes into
`route-permission-coverage.spec.ts` with one of these.

## 5. Existing UI building blocks

- **`@acropora/ui` components:**
  - `PilotBadge`: variants teal, grey, amber, blue, danger, success, default.
    `success` uses the pilot-green tokens.
  - `PilotSection`, `PilotDataGrid`, `PilotDataItem`, `PilotDataTable`,
    `PilotPairedRows`, `PilotPageHeader`, `PilotCallout`,
    `PilotSegmentedControl`, `PilotButton`, `EmptyState`, `Skeleton`, `Alert`.
- **Missing components:** there is no Tooltip, so a disabled control's reason
  has to be shown as visible text. There is no stateful Tabs component.
- **Tokens:** `packages/ui/src/figma-theme.css`, with aqua, grey, amber, blue,
  red and green-50/700. They already come from the Figma (P1a), so no
  `file_variables:read` is needed. The status colours map onto them:
  - VERIFIED: green
  - SUGGESTED: blue
  - CONFLICTING_SOURCES: amber
  - MISSING / UNVERIFIED: grey
  - POSSIBLE_WRONG_VALUE: red
- **Number formatting: there is no shared Hungarian formatter.** Every feature
  has its own `toLocaleString("hu-HU")`. Two facts matter for the house rule
  (`3 000 l/h`, `1,00`):
  - `Intl.NumberFormat("hu-HU")` does **not** group four-digit numbers: it
    gives `3000`. Only `useGrouping: "always"` gives `3 000`.
  - The separator it produces is U+00A0 (no-break space), not a thin space.

  So the formatter has to be written once, in `apps/web/src/lib/format/`. The
  separator character is Q5.

## 6. The product API and a production endpoint

- **Product routes** (`apps/api/src/products/`): list, detail, create, update,
  delete, catalog-authority transfer, barcodes, extension, shipping profile,
  category options.
- **None of them returns or accepts enrichment data.**
- **No production product-enrichment endpoint exists**, authorized or not.
  None is built in this task.

## 7. Feature availability

- There is no feature-flag framework and no generic settings module (`grep`
  `featureFlag` / `FEATURE_` finds nothing).
- The repository's convention for JEV switches is one environment variable
  per capability, read by the service that owns it:
  - `JEV_ASSET_CATEGORY_PREFILL`
  - `JEV_MISSING_INVOICE_PAIR` (`off|shadow|live`)
  - `JEV_LETTER_CLASS`
  - All three are documented in `.env.example`.
- Integration settings are per-integration database rows, not a generic
  store.

**Proposal (Q3): one variable, `JEV_PRODUCT_ENRICHMENT`, with the four states
the brief names.**

| Value               | Meaning                   |
| ------------------- | ------------------------- |
| `off` (default)     | unavailable               |
| `benchmark`         | internal                  |
| `review`            | review-only               |
| `production-review` | production-review-enabled |

- It is read on the server only.
- It is exposed to the web through the product evidence endpoint's response,
  so the browser never reads an environment variable.
- Until a Council decision, only `off` is ever deployed.

## 8. Auditability

- **There is no audit schema for field decisions, and none is proposed.**
- The existing pattern is enough for the eventual record:
  - `AuditLog` (entityType / entityId / metadata), already written by
    `product-extension.repository.ts` and `product-shipping-profile.repository.ts`;
  - plus a `DomainEvent` with aggregate `ProductVariant`.
- The metadata would carry: product / variant, field, proposed value, evidence
  (source type, ref, retrievedAt), policy / model version, outcome, user,
  timestamp.
- **`DecisionRun`** fits the JEV side: `entityType` is a free string, and no
  product entity uses it yet. `resolution` already has ACCEPTED / OVERRIDDEN.
  "Nem eldönthető" (cannot resolve) has no resolution value; it would be an
  AuditLog-only outcome or need a decision.

Gap to document, not to close now: **nothing records which evidence a human
decision was based on.** That is the first thing a write contract must specify.

## 9. The Figma against the contract

These are not redesigns. Each is a place where the frame shows something the
V0 contract or the data cannot back, and the UI has to render the honest
version instead. Each needs a yes or no in Q4.

1. **The conflict row shows a JEV value** (`394:136`, Teljesítmény: Jelenlegi
   2 500 l/h, JEV **3 000 l/h**, ÜTKÖZÉS).
   - For `CONFLICTING_SOURCES`, V0 returns `value: null`.
   - Showing 3 000 l/h in the JEV column is a silent winner.
   - Proposal: the JEV column says "Források eltérnek" and links to the
     conflict view. The values appear only on the source cards.
2. **"78% ADATMINŐSÉG"** (`394:84`): there is no defined calculation, so the
   chip is omitted, as the brief says.
3. **"Biztonság: 1,00"**: the number is extraction confidence, not
   truthfulness.
   - It is `null` for a value copied without a model.
   - Proposal: show it only when it is non-null, labelled "Kinyerési
     biztonság".
   - Never show it on a CONFLICTING / MISSING row. The Figma shows "—" there,
     which matches.
4. **Two pills that are not field statuses:**
   - "NINCS FORRÁS" (catalogue table, `394:458`) has no V0 status. Proposal:
     render UNVERIFIED as "NEM ELLENŐRZÖTT", and treat "Nincs forrás" as the
     queue's _issue type_, not a status.
   - "BELSŐ ADAT" (source card `394:287`) is the label for an OS / UNAS source,
     which can never verify itself. It is kept as a source-card label only.
5. **The catalogue KPI frame (`394:377`) is empty in the Figma.** There is no
   design for the four summary cards, and no data. Proposal: leave the KPI
   area out until both exist. Do not design it here.
6. **Decision controls.**
   - The review rows in the Figma have no per-row actions.
   - "Kijelölt módosítások alkalmazása" has no selection control anywhere in
     the frame.
   - Proposal: no per-row actions in V1. The batch button is rendered disabled,
     with a visible reason (there is no tooltip component). The conflict
     view's four decision buttons are also disabled with a visible reason.
     Nothing persists.

Also in the frames, and frozen or out of scope:

- The sidebar "JEV intelligencia" nav item: there is no such page today (Q6).
- "Újraellenőrzés" and "Új ellenőrzés indítása": there is no authorized
  execution endpoint, so both are disabled with a reason.
- "Export": not proposed for V1.

## 10. What can be implemented now, and what must stay disabled

**Implementable now, with real data or honest states.**

- **Components:** status badge (the six statuses, Hungarian labels, colour plus
  text), field review row, source card, review summary, catalogue queue table
  primitives.
- **Product review view:**
  - the product header and the "current data" column, from `ProductDetail`;
  - the review panel in its never-checked state;
  - unavailable, error and empty states that cannot be confused. An API
    failure is never a success-looking empty state.
- **Conflict view:** the route and layout, the "A Jev nem választ
  automatikusan" explanation, and disabled decisions.
- **Catalogue view:** the route, filters (Összes, Kritikus, Ütközés, Hiányzó
  adat, Javaslat, Ellenőrzött) over an empty queue, and the unavailable state.
- **The shared hu-HU number formatter.**

Fixtures exist in tests only. Screenshots taken from fixtures are labelled
"fixture", and no fixture is importable from a production module.

**Disabled until a Council decision:**

- every accept / keep / reject / resolve control;
- batch apply;
- Újraellenőrzés and Új ellenőrzés indítása;
- the quality percentage;
- the catalogue KPIs;
- Export.

There will be no write endpoint, no provider call, and no path from a JEV
decision to the UNAS outbox, the Medusa projection or any channel sync.

## 11. The API contracts the production version will need

These are documented, not built. Each needs authorization before
implementation.

1. **`GET /products/:id/enrichment`** (PRODUCTS_VIEW): one product-level
   review DTO, so there is no per-field or per-source request.
   - `availability`: `off|benchmark|review|production-review`
   - `lastRun`: `{ at, sourceCount, fieldCount } | null`
   - `fields`: `FieldResult[]` plus `tier` and `currentValue`
   - `summary`: `{ suggestions, conflicts }`

   It needs a persisted run result, which does not exist.

2. **`GET /products/enrichment/queue?filter=&cursor=`** (PRODUCTS_VIEW): a
   paginated queue with `{ productId, productName, field, issueType, status,
lastCheckedAt }`, plus a server-side summary DTO for the KPIs. The browser
   never scans the catalogue.
3. **`POST /products/:id/enrichment/decisions`** (PRODUCTS_MANAGE): one
   explicit human decision per field.
   - Body: `{ field, outcome: accept|keep|reject|unresolvable, evidenceRef }`.
   - Audited per §8.
   - It writes the product only through the existing product write paths, and
     only for an ACROPORA-authority product.
   - Tier C only from valid evidence; never from a conflict that is still open.
4. **`POST /products/:id/enrichment/runs`**: a live run. It is out of scope
   until the Council authorizes a provider path.

## Phases (each a separate PR against `main`)

1. **This report.**
2. **UI foundation:**
   - the components and the hu-HU formatter, with the tests the brief lists
     (state rendering, provenance, confidence, no silent winner, disabled when
     unauthorized, error vs empty, Tier C never shown as verified);
   - no route.
3. **Product detail integration:**
   - the entry card and the review sub-route;
   - real current data and the never-checked state.
4. **Conflict view:** the route, with decisions disabled.
5. **Catalogue data-quality view:** the route, filters and unavailable state.

Each phase is branched from `main` after the previous one has merged, and is
rebased onto `main` before the gates and before review.

## Answers (owner, 2026-10-02)

These answer the questions below. They override any proposal above that says
otherwise.

1. **Placement: agreed.**
   - The review is a sub-route on the product,
     `/products/[id]/adatellenorzes`, laid out as frame `394:18`.
   - The detail page gets only a compact card with the status and a link.
   - The conflict view is `/products/[id]/adatellenorzes/[field]`.
2. **Permission: agreed.**
   - Viewing evidence needs `products.view`.
   - Recording a decision needs `products.manage`.
   - `settings.manage` is not used.
3. **Availability: agreed.** One environment variable,
   `JEV_PRODUCT_ENRICHMENT`, default `off`, read on the server only.
4. **The six Figma deviations (§9): agreed, all six.** No view shows more than
   the data backs.
5. **Number format: keep the system's current formatting**, so every page
   writes numbers the same way. That is `toLocaleString("hu-HU", …)`, as the
   product pages use today.
   - **Consequence, stated so it is not a surprise:** this formatting does
     not group four-digit numbers. The Figma's "3 000 l/h" therefore renders
     as "3000 l/h", while "12 500" renders as "12 500" with a no-break space.
   - Decimals keep the comma ("1,00").
   - The JEV components call one small shared helper with exactly these
     options, so they do not add another local copy.
   - The helper does not change any other page's output.
6. **Navigation:** the catalogue data-quality page goes under Termékek.
   - It appears only when `JEV_PRODUCT_ENRICHMENT` is not `off`.
   - It still needs `products.view`.
   - The server decides visibility through the menu it already serves, so
     the browser never reads the variable.
7. **"Nem eldönthető" is a resolution of its own in the decision log**, so
   Jev's learning can count it.
   - When the decision write contract is authorized, `DecisionResolution`
     gets a new value (proposed name `UNRESOLVABLE`), alongside ACCEPTED and
     OVERRIDDEN. This is an additive enum migration, made in that phase, not
     now.
   - **Dependency to remember:** the dashboard's JEV intelligencia widget
     (#1398, `apps/api/src/dashboard/jev-system.ts`) counts an unknown
     resolution of a shown run as "open". The phase that adds the value must
     also give it its own figure there, with a test, so a "cannot resolve"
     decision is never counted as still open.

All questions are answered. Phase 2 (the UI foundation) starts from `main`
after this PR has merged.

## Open questions

1. **Placement.** Is this right?
   - The review becomes a sub-route, `/products/[id]/adatellenorzes`, laid
     out as frame `394:18`.
   - The detail page gets one compact "JEV adatellenőrzés" card in its side
     column with the status and a link, instead of the full panel inside
     `PilotPairedRows`.
   - The conflict view would be `/products/[id]/adatellenorzes/[field]`.
2. **Permission.** Is it right that product evidence is visible with
   `products.view` and decisions need `products.manage`, rather than
   `settings.manage` like the dashboard widget?
3. **Availability.** Is one `JEV_PRODUCT_ENRICHMENT` environment variable
   (`off` | `benchmark` | `review` | `production-review`, default `off`)
   acceptable, following the existing `JEV_*` convention? Or should it be a
   database setting row?
4. **The six Figma deviations in §9.** Agree to each?
   - conflict row without a JEV value;
   - no percentage;
   - confidence only when non-null, labelled "Kinyerési biztonság";
   - "Nincs forrás" as an issue type, not a status;
   - KPI area omitted until designed;
   - no per-row actions, and all decisions disabled.
5. **Number separator.** `Intl` gives U+00A0 and does not group 4-digit
   numbers by default. Should the shared formatter use U+202F (narrow no-break
   space, the typographic thin space that does not wrap) and always group?
   Or keep U+00A0?
6. **Navigation.** Where does the catalogue data-quality page go?
   - The Figma sidebar shows "JEV intelligencia" as a top-level item. Today
     there is no such page.
   - Options: a new top-level entry, a sub-entry under Termékek, or nothing
     until it has data.
7. **"Nem eldönthető".** When decisions are authorized, should "cannot
   resolve" be a new `DecisionRun` resolution value, or only an audit-log
   outcome? Answering this now only fixes the DTO shape; nothing is built.
