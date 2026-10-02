# Material Requests V2 (Anyagigény V2): discovery report

Phase 0 of Material Requests V2 (Figma `404:533`). This is a report and a plan
only: **no schema and no code are in this PR.** Implementation starts after the
open questions at the end are answered in this PR's comments.

The owner already decided four points on 2026-10-02. They are marked
**Decided** below and are not reopened.

## Summary

- **The Figma file is readable.** Node `404:533` was read through the Figma
  connector, with screenshots of all five parts:
  - desktop overview `404:16`;
  - desktop detail `404:221`;
  - mobile list `404:369`;
  - mobile detail `404:431`;
  - workflow definition `404:489`.

  The "Workflow Rules" frame (`404:520`) is empty in the file, and the
  status-metric cards carry example numbers only. The transition rules
  therefore come from the owner's decisions, not from the file.

- **V1 is small and correct for what it does.**
  - DRAFT → OPEN → RECEIVED.
  - The OPEN → RECEIVED step is an atomic conditional update.
  - Notifications are mail and APNs push.
  - There is one capability, `MATERIAL_REQUEST_MARK_RECEIVED`.
- **V1 has one visibility gap that V2 must close.** The purchasing list and
  the history list are global queries with only a status filter. They do not
  reuse the worksheet visibility query, and they do not exclude hidden
  worksheets (§3).
- **Everything V2 adds is additive:** three status values, a handler, an
  order mark, item-level receiving, a history table, a comment table, a
  requester note, a deadline and a priority. No existing row changes meaning,
  and no V1 column is dropped.
- **The production quantity measurement is not done.** I have no access to
  the production database, and the house rules forbid running anything
  against it. §5 gives the read-only query to run, and the parse rule the code
  will use.

## 1. The current schema

`packages/database/prisma/schema.prisma`, migration `20260922204900_material_request`:

- `enum MaterialRequestStatus { DRAFT, OPEN, RECEIVED }` (:5220).
- `MaterialRequest` (:5234):
  - Fields: `id`, `worksheetId` (Cascade), `status` (default DRAFT),
    `requestedById?`, `createdAt`, `submittedAt?`, `receivedAt?`,
    `receivedById?`. Both user relations are SetNull.
  - Indexes: `[worksheetId, createdAt]`, `[status, createdAt]`.
  - There is no updatedAt, handler, note, deadline, priority or history.
- `MaterialRequestItem` (:5274):
  - Fields: `position`, `name`, `quantity` (String), `unit` (String).
  - `@@unique([materialRequestId, position])`.
  - The DTO comment (`dto/material-request.dto.ts:12`) records why
    `quantity` is free text. The owner asked for it on 2026-09-22, and the
    original example was "10 méter" in the quantity field.
- **`receivedByName` is not a column.** It is derived from
  `receivedBy.displayName` in the repository and the shared type
  (`packages/types/src/material-request-management.ts:46`). V2 keeps it as a
  derived field.
- **`ML-2026-0148` in the Figma is a worksheet number**, not a request ID.
  There is no request number today (§9).

## 2. The current status enum and endpoints

The controller is `apps/api/src/material-requests/material-requests.controller.ts`,
with the prefix `service`.

| Route                                            | Permission                  | What it does                                                                                                        |
| ------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET `worksheets/:worksheetId/material-requests`  | SERVICE_VIEW                | The worksheet's requests: non-DRAFT plus the caller's own drafts                                                    |
| POST `worksheets/:worksheetId/material-requests` | SERVICE_MANAGE              | Creates a DRAFT with 1–100 items. There is no separate add-item route                                               |
| POST `material-requests/:id/submit`              | SERVICE_MANAGE              | Own DRAFT → OPEN (conditional update), sets `submittedAt`, notifies CREATED. Warns when no one holds the capability |
| GET `material-requests`                          | SERVICE_MANAGE + capability | OPEN only, oldest first                                                                                             |
| POST `material-requests/:id/receive`             | SERVICE_MANAGE + capability | OPEN → RECEIVED (conditional update), notifies RECEIVED                                                             |
| GET `material-requests/history`                  | SERVICE_MANAGE + capability | OPEN and RECEIVED, newest first                                                                                     |

- **The capability check** happens in the service, not in a guard:
  `hasMarkReceivedCapability` (repository :276) reads
  `UserServiceCapability`.
- **Every action also calls `requireInternalWriter`**
  (`worksheets/worksheet-internal-write.ts:44`). Partner users are refused,
  including PARTNER_SERVICE, which holds SERVICE_MANAGE.

## 3. Visibility today

- **The per-worksheet routes are correct.** They load the worksheet through
  `worksheets.detail(id, scope)`, so a request is never shown without its
  worksheet.
- **The pending and history lists are not scoped.** They are global
  (repository :180, :220). In practice only internal capability holders reach
  them. Even so, a hidden worksheet's request is listed, and the lists do not
  follow the unit scope.
- **V2 will build every list and count from `worksheetListWheres`**
  (`worksheets/worksheets.repository.ts:251`). This is the same query the
  Munkalapok list and the dashboard tile use, with hidden worksheets
  excluded. No second visibility query is written.
- **The dashboard tile counts every OPEN request** (`dashboard.repository.ts:294`,
  `dashboard-service-widgets.repository.ts:174`). It moves to the same scoped
  count.

## 4. Permissions today

- **Permissions:**
  - `SERVICE_VIEW`: OWNER, ADMIN, MANAGER, SERVICE, PARTNER_SERVICE,
    ASSET_IMPORT_AGENT, VIEWER.
  - `SERVICE_MANAGE`: the same, without VIEWER.
  - SALES and WAREHOUSE have neither. WAREHOUSE has PURCHASING_*.
- **Capabilities** (`ServiceCapability` enum, :4661):
  `MATERIAL_REQUEST_MARK_RECEIVED`, `AQUARIUM_ASSET_ASSIGN`,
  `MAINTENANCE_ORDER_UPLOAD_SIGNED`, `COMPLETION_CERTIFICATE_UPLOAD_SIGNED`.
  They are granted per user (`UserServiceCapability`).
- **Navigation:** the `material-requests-pending` entry (web and mobile) is
  gated on SERVICE_MANAGE. The capability is checked only on the server.

## 5. Production data implications

**Not measured.** I have no access to the production database, and rule 10
forbids it. Someone with read access should run this query and post the
counts as a PR comment. It returns no item text, so the result can be shared:

```sql
SELECT
  mr.status,
  count(*) AS items,
  count(*) FILTER (WHERE btrim(i.quantity) ~ '^[0-9]+([.,][0-9]+)?$') AS numeric_strict,
  count(*) FILTER (WHERE btrim(i.quantity) ~ '^[0-9]+([.,][0-9]+)?\s*\S.*$'
                     AND btrim(i.quantity) !~ '^[0-9]+([.,][0-9]+)?$')  AS number_plus_text
FROM "MaterialRequestItem" i
JOIN "MaterialRequest" mr ON mr.id = i."materialRequestId"
GROUP BY ROLLUP (mr.status);
```

- **`numeric_strict` uses the parse rule the code will use.** A quantity is a
  number only when, after trimming, it is a non-negative number with at most
  one decimal comma or point (`2`, `10`, `0,5`, `1.5`).
- **Everything else stays text and gets the per-item "megjött" mark** (§8.3).
  That includes `10 méter`, `kb 10` and `2-3`.
- **`number_plus_text` is information only.** It shows how many rows the
  conservative rule leaves as text (e.g. "10 méter"). They are not parsed,
  because the unit field already exists and guessing which part is the unit
  is not deterministic.

The other row counts that matter for the migration are by status:
DRAFT, OPEN and RECEIVED. The same query's ROLLUP gives them.

## 6. Current mobile support

- **`apps/mobile/src/app/material-requests/index.tsx`** is the pending
  list.
  - It uses `useQuery(["material-requests-pending"])` and pull-to-refresh.
  - A receive mutation writes the server's response into the cache.
  - It redirects users without `worksheetsManage`, and shows a dedicated 403
    message.
- **`material-requests/[id].tsx`** is the push landing route. It redirects to
  the worksheet.
- **There is no history view.**
- **The tile** is gated in `lib/auth/tile-visibility.ts:37` from the
  server-provided menu.
- **Query client:** staleTime 30 s, retry 1, `refetchOnWindowFocus: false`.
- **Tests:** node:test after `tsc`. There are two material-request specs
  (12 and 6 tests).
- **OTA:** `runtimeVersion: { policy: "fingerprint" }`. V2 needs no new
  native module: the segmented control, sticky action and cards are JS.
  **V2 mobile therefore ships OTA**, as long as no native dependency or config
  plugin is added. Each mobile PR will restate this.

**Compatibility constraint:** phones on the current JS bundle keep calling
`POST material-requests/:id/receive` on OPEN requests until they update. V2
must keep that route working (§9, Q4).

## 7. The Figma against the backend

| Figma concept                                                      | Backend support today                          | V2                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------- |
| Customer · department, worksheet number, requester, submitted time | yes (via worksheet and `requestedBy`)          | reuse                                               |
| Status badge (ÚJ, BEÉRKEZETT)                                      | DRAFT, OPEN, RECEIVED                          | add IN_PROGRESS, ORDERED, PARTIALLY_RECEIVED        |
| "Intézi: Nagy Petra", "átvette tegnap 16:03"                       | none                                           | handler + time                                      |
| "Én intézem a beszerzést"                                          | none                                           | claim action                                        |
| "Megrendeltem"                                                     | none                                           | order mark (state, user, time only)                 |
| Item state ("Nincs megrendelve", "Vár"), "12/14 db"                | none                                           | item-level receiving                                |
| Státusztörténet                                                    | none (only notification logs in `DomainEvent`) | history table                                       |
| Megjegyzés (requester)                                             | none                                           | one text field                                      |
| Megjegyzések + "Megjegyzés hozzáadása"                             | none                                           | comment table                                       |
| Szükséges / Határidő, Prioritás                                    | none                                           | proposed fields (Q5)                                |
| Status metric cards, filters, search                               | none (two unfiltered lists)                    | scoped server-side summary, filters, search, paging |
| "Anyagigény #MR-1041"                                              | none: no request number                        | Q6                                                  |
| "Új anyagigény" on the overview, "Szűrők", "További műveletek"     | none: creation is only on the worksheet        | Q7                                                  |

## 8. Schema and domain additions

All additive, in one migration. No column is dropped or retyped.

### 8.1 The responsible purchaser

- **Fields on `MaterialRequest`:** `handlerId String?` (User, SetNull) and
  `handlerAssignedAt DateTime?`, plus an index on `[handlerId, status]` for
  "Saját beszerzéseim".
- **Why a column and not a join table:**
  - The repository's convention is a join table when several people do the
    work together (`WorksheetAssignee`, `ServiceJobAssignee`).
  - It is a single column when one person owns the item (`Task.assigneeId`).
  - A purchase has exactly one person who is responsible for it.
- **Reassignment is possible by design.** It overwrites the two columns and
  writes a REASSIGNED history row with the previous handler. The history
  keeps every holder; the columns hold only the current one. V2 builds the
  backend action; whether the UI gets it is Q3.
- **The claim is concurrency-safe:**
  ```text
  UPDATE ... WHERE id = :id AND status = 'OPEN' AND "handlerId" IS NULL
  ```
  - This runs in the same transaction as the CLAIMED history row, and the
    affected row count is checked.
  - On 0 rows, the response is 409 with the authoritative current DTO, which
    names the current handler.
  - This is the same pattern V1 already uses for submit and receive.

### 8.2 The state machine (Decided, owner 2026-10-02)

The new enum values follow the existing naming (`PurchaseOrderStatus` already
has `PARTIALLY_RECEIVED`): `IN_PROGRESS`, `ORDERED`, `PARTIALLY_RECEIVED`.
They are added to `MaterialRequestStatus`.

```text
DRAFT ──submit──▶ OPEN ──claim──▶ IN_PROGRESS ──order──▶ ORDERED ──▶ PARTIALLY_RECEIVED ──▶ RECEIVED
                                       │                    └──────────────────────────────▶ RECEIVED
                                       └──── receive (in stock / bought locally) ───────────▶ RECEIVED
```

- **Forward only.** No transition goes back.
- **IN_PROGRESS → RECEIVED is allowed on purpose.** This covers material that
  is in stock or bought locally. The history shows that the order step was
  skipped.
- **Who may change the state:**
  - only the handler, or a leader (OWNER, ADMIN, MANAGER), may change the
    state after a claim;
  - claiming needs the capability (§8.7).
- **Every transition writes one history row.**
- **The rules live in one pure function** (`allowedTransitions(status)`),
  used by the API and mirrored by the UI to show buttons. The API is the
  authority.
- **Item-level receiving decides the status:**
  - Some items arrived: ORDERED → PARTIALLY_RECEIVED, or it stays
    PARTIALLY_RECEIVED.
  - Every item arrived: RECEIVED.
  - "Beérkezett" marks all remaining items as arrived in one step.
- **CLOSED is not recommended.** RECEIVED is already terminal, and nothing in
  the service flow happens after it. The worksheet itself carries the
  handover and use. Adding CLOSED would only add a click.
- **CANCELLED** is not in the Figma or the brief. Today a submitted request
  cannot be withdrawn. This is listed as a known gap, not built (Q8).

### 8.3 Partial receiving (Decided, owner 2026-10-02)

- **Fields on `MaterialRequestItem`:**
  - `quantityValue Decimal(12,3)?`: filled by the system only when
    `quantity` parses under §5's rule. The text stays as it is.
  - `receivedQuantity Decimal(12,3)?`: for numeric items.
  - `receivedAt DateTime?` and `receivedById String?` (SetNull): the moment
    the item counted as arrived. For a text item, this is the "megjött" mark.
- **Arrival:**
  - A numeric item has arrived when `receivedQuantity >= quantityValue`.
  - A text item has arrived when `receivedAt` is set.
- **The ratio display ("12/14 db") appears only where `quantityValue` exists.**
- **Decimal, never float.** Arithmetic is done on Prisma `Decimal`, the
  same as purchase-order lines.
- **No ordered quantity per item.** "Megrendeltem" stays request-level (state,
  user, time), as the freeze requires.

### 8.4 Status history

- **A new `MaterialRequestEvent` table, modelled on `ServiceJobEvent`:**
  - `kind`: SUBMITTED, CLAIMED, REASSIGNED, ORDERED, ITEMS_RECEIVED,
    RECEIVED;
  - `fromStatus?`, `toStatus?`, `actorUserId?` (SetNull), `payload Json?`
    (item deltas, previous handler), `createdAt`;
  - index `[materialRequestId, createdAt]`;
  - the same DB CHECK as `ServiceJobEvent`: a status change has a
    `toStatus`.
- **The timeline is read from these rows, never derived from the current
  status.**
- **CREATED is not a separate event.** A draft is the requester's own working
  state and is not shown to anyone else.
- **Comments are their own table, not an event kind** (§8.5). The timeline
  can interleave them by time if wanted.

### 8.5 Requester note and comments (Decided, owner 2026-10-02)

- **`MaterialRequest.note String?`:**
  - one short requester note, sent with the create call (the existing
    create-and-submit form gets one optional field);
  - ≤ 1000 characters, plain text.
- **A new `MaterialRequestComment` table:**
  - `id`, `materialRequestId` (Cascade), `body` (≤ 2000 characters),
    `authorId?` (SetNull), `createdAt`;
  - modelled on `WorksheetEntry`.
  - No editing, no threads, no reactions.

### 8.6 Deadline and priority (proposed, not decided)

Neither field exists today.

- **Proposal:** `neededBy DateTime? @db.Date` and
  `priority MaterialRequestPriority?`.
- **`MaterialRequestPriority`:** NORMAL, HIGH, URGENT. LOW is left out,
  because a material request nobody needs soon is not sent.
- **Both are set by the requester at creation and are optional.**
  - Existing rows stay `null` and show "—".
  - Nothing is invented for them.
- **This is a new enum.** No `Priority` enum exists to reuse.

Q5 decides whether these are wanted at all.

### 8.7 Permissions

No new `Permission` is proposed.

- **`MATERIAL_REQUEST_MARK_RECEIVED` becomes the purchasing capability.**
  - Its meaning widens from "may mark received" to "may handle purchases".
  - Its Hungarian label changes in `packages/types/src/service-capabilities.ts`;
    the enum value stays the same, so no data migration is needed.
  - Claiming requires it.
- **Leaders** (OWNER, ADMIN, MANAGER) may change any request's state and
  reassign. This is the same leader set as the dashboard decisions.
- **The handler** may change their own request's state.
- **Comments:** anyone who can see the request may comment.
- **Every action stays internal-only** (`requireInternalWriter`), as in V1,
  until Q2 says otherwise.

Every new route gets `@RequirePermissions(SERVICE_MANAGE)` (reads:
`SERVICE_VIEW`) for `route-permission-coverage.spec.ts`. The capability and
leader checks run in the service, the same as V1.

### 8.8 Ordering and purchase orders

- `PurchaseOrderLine` is bound to a product variant. Material request items
  are free text with no product link.
- **There is no natural link**, and the freeze forbids touching purchase
  orders. "Megrendeltem" records `orderedAt` and `orderedById` on the
  request, plus an ORDERED history row. Nothing else.
- A supplier or order reference is a future extension.

## 9. API shape

- **Explicit actions under the existing `service` prefix.** No generic PATCH.
- **Each action:**
  - authorizes in the service;
  - checks the transition with `allowedTransitions`;
  - runs one conditional update plus a history insert in a transaction;
  - returns the fresh detail DTO.

| Route                                                                  | Who                                   | Effect                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET `material-requests?view=active\|mine\|received&status=&q=&cursor=` | internal SERVICE_VIEW                 | Scoped, paged summary list, with server-side search over customer, department, worksheet number, item name, requester and handler |
| GET `material-requests/summary`                                        | same                                  | Scoped counts per status; RECEIVED limited to the last 7 days, as on the Figma card                                               |
| GET `material-requests/:id`                                            | same                                  | Detail DTO: items with receiving state, note, comments, history                                                                   |
| POST `material-requests/:id/claim`                                     | capability                            | OPEN → IN_PROGRESS; 409 with the current handler if taken                                                                         |
| POST `material-requests/:id/reassign`                                  | leader                                | Handler change, REASSIGNED row                                                                                                    |
| POST `material-requests/:id/order`                                     | handler or leader                     | IN_PROGRESS → ORDERED                                                                                                             |
| POST `material-requests/:id/receive-items`                             | handler or leader                     | Per-item quantities or marks → PARTIALLY_RECEIVED or RECEIVED                                                                     |
| POST `material-requests/:id/receive`                                   | handler or leader (V1 compatible, Q4) | All remaining items arrive → RECEIVED                                                                                             |
| POST `material-requests/:id/comments`                                  | anyone who sees it                    | Adds a comment                                                                                                                    |

- **Avoiding N+1:** the summary DTO comes from one query with `include` of
  worksheet (number, customer, department), requester, handler and the first
  items.
- **Paging** is cursor-based, 50 rows per page.
- **The V1 list routes** (`GET material-requests`,
  `GET material-requests/history`) stay until the web and mobile clients have
  moved over. They are scoped (§3) in the same phase.

## 10. Notifications

- **Extend the existing mechanism; do not build a parallel one.**
  - Mail goes through `deliverMaterialRequestMail`, with keys in
    `MAIL_TEMPLATE_EVENTS`. The templates are editable on Beállítások >
    Levelezés.
  - Push goes through `notifications.service.ts`.
  - The delivery log is `DomainEvent`.
- **Proposal:**
  - Add `MATERIAL_REQUEST_CLAIMED` and `MATERIAL_REQUEST_ORDERED` templates.
  - Recipients are the same as for RECEIVED today: the requester plus the
    worksheet's assignees.
  - Partial receiving does not notify, to avoid noise. The final RECEIVED
    still does.
- **The push target moves** from the worksheet to the request detail on
  mobile. The push payload already carries `targetType: "materialRequest"`.

Q9 confirms which events notify.

## 11. The recommended migration

- **One additive migration:**
  - `ALTER TYPE ... ADD VALUE` for the three statuses;
  - nullable columns on both tables;
  - the two new tables.
- **Backfill only what is deterministic:**
  - `quantityValue` from §5's rule;
  - a SUBMITTED history row from each non-draft request's existing
    `submittedAt` and `requestedById`;
  - a RECEIVED history row from each received request's existing
    `receivedAt` and `receivedById`.

  Q10 confirms the history backfill.

- **Not backfilled:**
  - no handler, so existing OPEN rows stay unassigned OPEN;
  - no order time;
  - no item-level receiving on existing RECEIVED rows. The UI treats a
    RECEIVED request as fully arrived, so those rows keep their receiver and
    time exactly as today;
  - no deadline or priority.
- **No existing request disappears or changes status.** The migration is run
  by the deploy pipeline, never by hand against production.

## 12. Phases (each its own PR against `main`)

1. **This report.**
2. **Domain and API:**
   - the migration;
   - the state machine;
   - claim, reassign, order, receive-items, receive, comments;
   - the scoped list, summary and detail;
   - the notifications.

   Tests: the state machine (including the concurrent claim), permissions,
   history actor and time, and the compatibility of DRAFT, OPEN and RECEIVED.

3. **Web:** the overview with metrics, filters, search and paging; the detail;
   the actions; rendering tests for each state.
4. **Mobile:** the list (Aktív, Saját, Beérkezett), the detail with the
   sticky action, the actions, and state and action-visibility specs. OTA.
5. **Polish:** empty, error and loading states; refetch after every action
   and on focus for the list; edge cases.

Each phase is branched from `main` after the previous one has merged.

## Answers (owner, 2026-10-02)

These answer the questions below. They override any proposal above that says
otherwise.

- **Q1, production quantities:** 5 items, all 5 `numeric_strict`, 0
  `number_plus_text` (OPEN 1, RECEIVED 4). The strict parse rule fills
  `quantityValue` for every existing item, so the ratio display works on all
  of today's data.
- **Q2, partner visibility:** no. V2 stays internal-only, as today.
- **Q3, reassignment:** yes, also in the UI, kept simple.
  - A leader or the current handler picks another user from a list.
  - The change writes a REASSIGNED history row.
  - Candidates are the active internal users who hold the purchasing
    capability.
- **Q4, the old receive call:** agreed. Until the OTA reaches every phone,
  `receive` on an OPEN request by a capability holder is an implicit claim
  and receive, writing both CLAIMED and RECEIVED rows.
- **Q5, deadline and priority:** agreed. Both are optional and set by the
  requester. `priority` is NORMAL, HIGH or URGENT (Normál, Magas, Sürgős).
- **Q6, request number:** none. The worksheet number is enough.
- **Q7, "Új anyagigény" on the overview:** left out, on desktop and mobile. A
  request starts only from a worksheet, as today.
- **Q9, notifications:**
  - Claim and order notify **the requester only**, by mail and push, through
    two new editable templates (`MATERIAL_REQUEST_CLAIMED`,
    `MATERIAL_REQUEST_ORDERED`).
  - Partial receiving does not notify.
  - The existing RECEIVED recipients (the requester plus the worksheet's
    assignees) are unchanged.
- **Q10, history backfill:** yes, only from stored values.
  - A SUBMITTED row from `submittedAt` and `requestedById`.
  - A RECEIVED row from `receivedAt` and `receivedById`.
  - No row is invented. A request without a stored timestamp gets no row for
    that step.

- **Q8, withdrawal:** yes, in V2, kept simple.
  - A new status value, `CANCELLED` (Visszavont).
  - The requester or a leader may withdraw a request while it is OPEN or
    IN_PROGRESS, that is, before it is ordered. From ORDERED onward it
    cannot be withdrawn.
  - The transition runs as a conditional update on the current status, and
    writes a CANCELLED history row with the actor.
  - The request and its history stay readable. It leaves the active lists
    and shows under its own filter state.
  - No notification is added for it; the brief and the answers name none.
- **Q11, the overview:** every internal user with SERVICE_VIEW sees it,
  scoped to the worksheets they can see (`worksheetListWheres`, hidden
  worksheets excluded). Only the handler, leaders and capability holders may
  change the state. The rules in §8.7 still apply.
- **Q7, "Szűrők" and "További műveletek":** left out for now.

All questions are answered. The resulting state machine, replacing §8.2's
diagram:

```text
DRAFT ─submit─▶ OPEN ─claim─▶ IN_PROGRESS ─order─▶ ORDERED ─▶ PARTIALLY_RECEIVED ─▶ RECEIVED
                  │                │                   └────────────────────────────▶ RECEIVED
                  │                └─ receive (in stock / bought locally) ──────────▶ RECEIVED
                  └───────┴─ cancel (requester or leader) ──────────────────────────▶ CANCELLED
```

Forward only; RECEIVED and CANCELLED are terminal; every arrow writes one
history row.

## Open questions

1. **The production quantity counts:** please run §5's query and post the
   counts here. Phase 2 does not depend on them to start, but the ratio
   display does.
2. **Partner visibility.**
   - V1 refuses partner users on every material-request route.
   - Should a partner technician see (read only) the status of requests on
     worksheets they can see?
   - My recommendation is no for V2: keep it internal, as today.
3. **Reassignment UI.** The backend action is in phase 2. Should leaders also
   get a "Felelős módosítása" control in V2 (web only), or is backend-only
   enough for now?
4. **The old receive call.**
   - Phones on the current bundle mark OPEN requests received directly.
   - Proposal: until the OTA reaches everyone, `receive` on an OPEN request
     by a capability holder performs an implicit claim and receive, writing
     both CLAIMED and RECEIVED rows with the same actor.
   - After the OTA, OPEN → RECEIVED without a claim is refused.
   - Agree?
5. **Deadline and priority.** Are `neededBy` and `priority` (NORMAL, HIGH,
   URGENT), set optionally by the requester, wanted? Or should both be left
   out of V2?
6. **The request number in the Figma ("#MR-1041").**
   - There is no request number today.
   - My recommendation: show only the worksheet number, as rule 3 says, and
     add no counter.
   - Agree?
7. **"Új anyagigény" on the overview** (desktop and mobile "+ Új igény").
   - Creation exists only on the worksheet.
   - Should the button open a worksheet picker, link to the Munkalapok list,
     or be left out?
   - "Szűrők" and "További műveletek" have no defined content in the Figma.
     I propose to leave them out until they have it.
8. **Withdrawal.** Is a CANCELLED state (by the requester or a leader) needed
   in V2, or later?
9. **Notifications.** Should claim and order notify the requester and the
   worksheet assignees by mail and push, and partial receiving not notify?
10. **History backfill.** Should existing requests get SUBMITTED and RECEIVED
    history rows from their existing timestamps and users, so their timelines
    are not empty? Or should history start at the migration?
11. **Visibility of the overview.** Who should see the overview?
    - Today only capability holders do.
    - Proposal: every internal user with SERVICE_VIEW sees the overview,
      scoped to the worksheets they can see.
    - Actions stay limited to the handler, leaders and capability holders as
      above.
