# Medusa integration: credential path and operations

What this page is for: the Medusa admin credential — where it comes from at
runtime, what the target state is, how it is rotated, and what has actually been
measured about revoking one. Everything here is either measured or explicitly
marked as not measured.

## The credential path

```
database -> env fallback
```

`MedusaCredentialProvider` resolves in that order:

1. **`database`** — the encrypted credential stored on the `MedusaConnectionSetting`
   row, entered through the Settings page. This is the normal path.
2. **`env` fallback** — `MEDUSA_ADMIN_API_KEY` from the process environment, used
   only when the stored credential is absent (`credentialMode = ENV_FALLBACK`).

**The fallback is not silent.** Whoever resolves a credential is told which path it
came from, and the projection command prints one line on stderr when it went the
fallback way. A fallback that works quietly turns a transition into a permanent
state: it keeps working, so nobody notices it is still in use.

**There is no fallback when the stored credential is corrupt.** A damaged envelope
is a configuration and integrity error, not a reason to reach for another secret;
the provider refuses instead of quietly using a different key. That is asserted in
`medusa-credential.provider.spec.ts`.

The address (`MEDUSA_ADMIN_URL`) always comes from the environment and is not a
secret.

### The master key that makes the stored credential readable

Encrypting and decrypting the database credential needs two environment values,
and the API cannot use the stored key without them:

| Variable                               | What it is                         |
| -------------------------------------- | ---------------------------------- |
| `MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION` | which master key version is in use |
| `MEDUSA_CREDENTIAL_MASTER_KEY_V<n>`    | the master key for that version    |

The master key is **32 bytes, base64-encoded**, and the encoding is checked by
round-trip rather than by shape alone, so a truncated or re-wrapped value is
refused instead of producing a key that is almost right. It is **versioned**: the
version travels with the envelope, so an old envelope cannot be opened with a new
key by accident.

Two properties are worth stating plainly because they are easy to assume wrong:

- **It is not the Medusa admin API key.** One protects the other; they rotate on
  different occasions and for different reasons.
- **If it is lost, the stored credential cannot be recovered.** There is no second
  copy and no recovery path — the operational answer is to set a new master key
  and enter the Medusa secret again through the Settings page.

The exact values belong in the deployment's secret store, never in this repository
and never in a shell command.

## Target state

Normal operation: **`database`**.

The env fallback exists for the transition and for rollback. It should not be part
of steady state; see the checklist at the end of the rotation runbook for when it
can be removed from a deployment.

## Rotation

The order is fail-safe, and the point of it is that the old key stays usable until
the new one is proven:

1. create a new Medusa secret key;
2. store it as the database credential (Settings page);
3. confirm `source = database`;
4. read probe green;
5. projection green;
6. **only then** revoke the old key;
7. verify that the old key is refused.

Step-by-step commands: `docs/RUNBOOK-MEDUSA-CREDENTIAL-ROTATION.md`.

Never revoke before step 5. If any step is not green, the revoke does not follow —
that is the one irreversible action in the sequence.

## Revoke behaviour

**The rotation was performed on 2026-08-26, and one half of the measurement was
made while the other was not. Both halves are stated here, because the difference
is the whole point.**

What was measured:

- the old Medusa secret key was revoked;
- after the revoke, a projection using the new, database-stored credential still
  succeeded (`updated -> prod_01M0Z9TAYE7KV7YM3YHMR9YGF3`).

What was **not** measured:

- a direct HTTP request carrying the revoked old key. The plaintext of the old key
  was no longer available, so the call could not be made.

So the refusal of a revoked key has still not been observed. What the round does
establish is that the system no longer depends on the old key: the work continues
on the new credential after the revoke. That is strong indirect evidence, and it
is not the same claim — a system can keep working on a new key while an old one
remains just as usable as before.

**Do not promote this to "revoke propagation proven."** The evidence supports
"the new credential carries the traffic", not "the old credential is refused".
The direct measurement (runbook step 5.2, with its 5.1 control) remains open, and
the next rotation can close it by keeping the outgoing key readable until step 5.2
has run.

When it is finally made, that measurement only counts with its control. A `401`
proves nothing on its own
— a mistyped address or a malformed basic-auth header produces exactly the same
answer, and from outside the two are indistinguishable. So the runbook measures
the **new** key first on the same path: once that returns `200`, the shape of the
call is proven, and the old key's `401` is about the key rather than about the
question.

## Permission enforcement — a compatibility constraint

> Turning on Medusa's permission enforcement (`rbac`) may be a breaking change for
> the Acropora OS machine integration.

The secret key is full-privilege and carries no role. With enforcement on, our
calls would receive `403` even though the key is intact. Anyone changing the
commerce configuration should treat this as a known dependency, not as a risk to
be discovered later.

## Reading an HTTP refusal

A `401` or `403` from Medusa **does not by itself prove a bad key**:

- `403` today can only come from the permission check, but that sits behind the
  `rbac` flag, and the reverse proxy in front of Medusa could also produce one;
- `401` comes from a single place, but five different causes lead there, and one of
  them is not about the key at all: Medusa catches its own api-key module's
  exception, so a database error on that side arrives as `401`.

Consequences, both deliberate:

- the integration state names the two together (`auth-or-permission-failure`), and
  the message says both possible causes in one sentence;
- **no automatic credential rotation on a status code alone.** A rotation triggered
  by a `401` would, in the failure mode above, replace a healthy key while the real
  fault stays where it is.

## Publication and sales channel

What decides whether a product is buyable on the storefront, and what the OS
sends to make it so. Measured from the installed Medusa 2.19.0, not from
documentation.

### Product mastership

| `catalogAuthority` | In this round                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UNAS`             | **not a projection target.** The catalogue is maintained on the other side; copying it here would put the same data in a second place where nobody tends it. |
| `ACROPORA`         | may be projected.                                                                                                                                            |
| `null`             | fail-closed. Unresolved ownership is not a reason to proceed.                                                                                                |

### What the storefront actually looks at

The store routes apply **two** filters, and a product needs both:

- `applyDefaultFilters({ status: ProductStatus.PUBLISHED })` — `draft`,
  `proposed` and `rejected` never appear;
- `filterByValidSalesChannels()` plus the `product_sales_channel` link filter —
  the product must be linked to the sales channel the request carries.

Either one missing and the product is not returned. **This is why the two gates
move together**: a change that flipped one and not the other would look, from
outside, exactly like a successful change.

### The rule

A product is storefront-buyable when **all four** hold:

1. `catalogAuthority = ACROPORA`;
2. the product is active;
3. it has at least one active variant;
4. `webshopSellable` is true.

Then: **`published` + linked to the storefront channel.** Otherwise: **`draft` +
detached.** The reason names the EARLIEST unmet condition, not the last one — a
message that names the last one walks the reader through their own mistakes one
at a time.

**`webshopSellable` is a new, Acropora-owned business field, and it defaults to
false.** The obvious existing candidate, `ChannelListing.isPublished`, is the
wrong one: it mirrors what UNAS publishes, only the sync writes it, and
`CatalogChannel` has exactly one value (`UNAS`). It answers a question we were
not asking.

### The sales channel

The storefront channel is configured **per environment**, by id, in
`MEDUSA_STOREFRONT_SALES_CHANNEL_ID`. Not by name: a name can be changed, and a
name-based lookup would one day quietly stop matching. The id is not a secret.

**Per environment is the point.** A stage channel id does not exist in
production. If the setting is carried across, Medusa rejects it — which is the
good outcome: it becomes invalid rather than almost right.

Two refusals, both deliberate:

- **id missing** → the projection stops before sending anything. Omitting the
  field would leave the links while the status moved; sending an empty list is a
  detach nobody could tell apart from a deliberate one a week later. Both quiet
  options are worse than the error.
- **id does not exist on the target** → stops on first use, once.

**The channel name is printed in the report, not asserted.** A name check would
fail on a legitimate rename, and a check whose failure is a legitimate change
gets switched off — after which its place stands empty while everyone believes
something guards it. Printing cannot misfire: it claims nothing, it shows what
was written to. It is also the only thing that catches an id that exists but
belongs to someone else's shop, because that call succeeds and every test stays
green.

### Idempotency comes from the target, not from our code

The 2.19.0 update workflow treats `sales_channels` as a **replace**: absent
means "leave the links alone", a list means "delete the current links, create
these". Resending the same list therefore cannot duplicate a link, and the empty
list is the detach. Status and channel travel in one request.

### Not in this round

Pricing is not part of this projection. The variant price array is sent empty
because the create endpoint requires the field, not because we have a price to
state.

**Inventory was added in a later round** (2026-08-27) as a _separate_ command
and a separate policy module — see "Inventory projection" below. The separation
is the point: zero stock does not draft a product, and the inventory projection
touches no sales channel.

### What has NOT been proven, and why it does not look like a gap

**Everything above is asserted by tests. None of it has been run against a live
system.** The runtime stage proof was written and then left out - a decision by
the owner of the round, not a technical obstacle. The script exists; nobody ran
it end to end.

This paragraph is here because the absence would otherwise be invisible. Every
other claim on this page names the file that would go red, and after enough of
those a reader stops asking which ones were measured on a running system. **An
unmarked claim borrows credibility from the ones beside it.**

**The Store API side, measured rather than assumed** (2026-08-27): a plain
`GET /store/products` against the stage commerce host answers `400` with
`"Publishable API key required in the request header: x-publishable-api-key"`.
The publishable key carries the sales-channel scope, and we do not have one. So
the storefront half cannot be measured directly today, and **no storefront was
built for the proof.**

#### The five things the tests cannot settle

Each of these can only fail on a live system. The tests assert what we send;
none of them observes what the other side did with it.

| #   | What would falsify the rule                                                       | Why a test cannot catch it                                                                        |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | the product stays `draft` while the flag is true and the product is active        | the tests assert the decision and the call; they do not observe the product afterwards            |
| 2   | it becomes `published` but the channel list stays empty                           | both travel in one request in OUR code; whether the target applies both is the target's behaviour |
| 3   | a second run leaves TWO channel links                                             | the replace semantics is read from the installed source, not observed on a running instance       |
| 4   | with the flag false the product is still reachable from the Store API             | the storefront intersection is read from middleware source; we have never asked the Store API     |
| 5   | the report names `Acropora Webshop` while the product sits on a different channel | the name comes from our own lookup; only the target can contradict it                             |

**Three of the five (2, 3, 4) rest on claims read from the installed Medusa
2.19.0 source.** That is a stronger footing than a guess and a weaker one than
an observation: the source says what the code does, not what this deployment
does with our data.

## Inventory projection

`Acropora OS = inventory source of truth`, `Medusa = storefront projection`.
There is no write-back, and none is planned. The command is separate from the
product projection on purpose: publication and inventory are separate
responsibilities, and a single command would eventually let one bleed into the
other — not because anybody decided so, but because they would sit in one place.

```bash
cd /home/marveen/marveen/agents/nautilus/acropora-os
pnpm --filter @acropora/api medusa:inventory sku:teszt0001
```

### The quantity formula, and the fifth copy that was not written

The number we send is `onHand - reserved`, taken from the main warehouse row
with **no location and no lot** — the same row the UNAS sync and the POS search
read. Reading anything else here would introduce a second stock concept under
the same name.

The formula was measured (2026-08-27) as written out **four separate times**:
the UNAS outbox, the POS product search, the reconciliation target, and the
purchase-invoice reservation. There was no shared function. This round created
one, `apps/api/src/inventory/available-to-sell.ts`, and moved all four onto it.

Four copies are not bad because they are four. They are bad because **when one
of them moves, nothing says so**: the others keep compiling and keep running,
and the drift only shows up in the shop, weeks later. That is checkable now —
breaking the shared function turns five spec files red across three domains.

### Negative stock, and what the clamp is and is not

`medusaQuantity = max(0, floor(availableToSell))`.

**The clamp is a constraint, not a design choice.** The Medusa admin validator
declares `stocked_quantity: z.number().min(0)` in four places; a negative value
would be refused with a 400. We could not send one if we wanted to.

**The clamp is not in the shared formula, and that is deliberate.** UNAS receives
the signed value today — the owner switched the stock display off there because
the recorded quantities have drifted, and until the stock count that is the
intended state. Putting the clamp in the shared function would silently revoke
that, and the rule would no longer be visible where it applies.

**The floor is measured behaviour, not a business rule.** Medusa's own
availability computation applies `Math.floor`, so 2.7 would sell as 2 anyway.
The report says when a fraction was dropped, otherwise it would claim more than
the shop will sell. The report also says when a negative was clamped, otherwise
`0` would read as an empty warehouse rather than as minus two.

### Backorder: the default is the opposite of the decision

The owner's rule (2026-08-27 16:02): positive stock shows "Raktáron", **zero
shows "Rendelhető"**.

The mechanism is `ProductVariant.allow_backorder`. Measured on the installed
2.19.0: when true, the cart's inventory check is skipped entirely; when false,
`confirmInventory` runs and a shortfall raises `INSUFFICIENT_INVENTORY`. **Its
default is `false`.**

So the wanted behaviour does not arise on its own. A projection that set only
the quantity would leave the shop doing the opposite of what was decided — not
with an error, but by simply refusing the sale. The projection therefore sets
the flag explicitly on every variant it projects, and one test goes red if the
mechanism is missing rather than if the intention is missing.

This is not a preorder feature. No new field, no new flow: an existing boolean
on the target side is given a value.

### Two reservation concepts, stacked

The OS `reserved` field is written by the project reservation flow — it is not a
separate ledger. On the Medusa side `available_quantity` is **computed**
(`stocked - reserved`), only `stocked_quantity` is writable, and its
`reserved_quantity` comes from Medusa's own cart reservations.

So sending `onHand - reserved` as `stocked_quantity` means **a Medusa cart
reservation is subtracted a second time**, on top of the OS reservation already
subtracted. This is a consequence, not a bug, and there is no shape that avoids
it: `stocked` is the only writable field. The choice is not "subtract twice or
not", it is "what should the shop start from" — and the right starting point is
what the OS already reports to a webshop today. The report prints the Medusa-side
reserved quantity when the response carries it, so anyone comparing the two
numbers can see the stacking.

### The stock location is resolved at run time, from the sales channel

No location id is stored or hard-coded. Every run asks
`GET /admin/stock-locations?sales_channel_id=<channel>` — a named filter in the
admin validator — and the run is **fail-closed in both directions**:

| What comes back      | What happens                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------ |
| exactly one location | that is the target; the projection writes there                                            |
| zero                 | stop, write nothing — either the wrong channel, or no location is linked to it             |
| more than one        | stop, write nothing — which location's stock belongs to the webshop is a business decision |

A configured location id would bring back the same trouble the per-environment
channel id already taught us, only quietly: writing stock to the wrong location
is a perfectly valid operation as far as Medusa is concerned. Asking the channel
every run also means a changed environment is reported by the run itself rather
than by an out-of-date page.

### Inventory identity

```
OS product --(ExternalReference MEDUSA/Product)--> Medusa product
Medusa product --> variant (matched on SKU) --> inventory item (Medusa's own link)
inventory item --(inventory level, per location)--> stock location
```

No new mapping was introduced. The variant-to-inventory-item link is the one
Medusa maintains itself; we read it through
`inventory_items.inventory.location_levels` on the variant. The
`GET /admin/inventory-items?sku=` route exists, but the SKU on an inventory item
is a **copy** made at creation, and identity on a renameable field is what the
brief forbids.

**A truncated variant list is not an answer either.** The variant lookup reports
whether it exhausted its limit, and the run stops if it did — the same guard the
product lookup already carries, and for the same reason: the list does not sort,
so a truncated response is an arbitrary subset rather than the first N. An
"exactly one match" check running on a subset would answer "no variant with that
SKU" with full confidence.

**A missing field is not an empty list.** If the response does not carry
`inventory_items` (or the nested `location_levels`), the run stops and says so.
Reading absence as "there is no link" would send the projection down the wrong
branch in silence. This matters because one thing here is **not measured**: that
the admin HTTP layer passes that field expansion through. The path is the one the
installed 2.19.0 cart and order flows use internally; whether the `fields` query
parameter accepts it is only decidable on a live system. If it does not, the
first run stops with `inventory-chain-missing` — loudly, having written nothing.

### Idempotency comes from the target, again

`updateInventoryLevels` **sets** the received `stocked_quantity` and resolves the
level on the `(inventory_item_id, location_id)` pair. Absolute, not delta.
Re-sending the same value leaves the same state and creates no second level, and
`5 → 3 → 0` simply takes the value sent.

Two consequences worth stating rather than enjoying quietly:

- The brief's stop condition ("if only delta updates are possible, stop") **does
  not apply**.
- The idempotency is therefore **not our code's merit**. If someone rewrites the
  call into a "more efficient" delta operation, idempotency would be lost
  silently. That is why "absolute set replaced by delta" is on the falsification
  list, and it turns three tests red.

**The update does not create a missing level.** Measured: `ensureInventoryLevels`
raises `Item ... is not stocked at location ...`. So the projection looks first
and creates the level when it is absent — which is the normal state of a first
run, not an error.

### Failure model

Three or four calls are needed, so **atomicity is not claimed**. Every call's
result is inspected separately and the first failure stops the rest.

**The backorder flag is written before the quantity, and the order is not a
matter of taste.** Of the three half-states the worst is quantity-set,
flag-unset: a zero-stock product then cannot be bought although it is supposed
to be orderable — and it fails quietly, because the shop works, it just refuses
the sale. In the order used, the surviving half-state is flag-set,
quantity-stale: visible, fixable, and it blocks nothing. The stop message names
which of the two happened.

Two concurrent projections of the same SKU would write the same absolute value
if they read the same OS state; if they did not, **the last write wins** — which
is the correct behaviour for a projection, since the OS is the source of truth
and the next run carries the fresh value anyway. There is no read-modify-write
cycle here, only a write, so **no lock and no outbox were built**.

### What has NOT been proven here

**Nothing in this section has been run against a live system.** The runtime stage
proof was left out by the owner's decision (2026-08-27 17:34, in answer to a
direct question: "nem kerem"), and with it the stage stock-location measurement
("akkor nem aktualis") — which is precisely why the location is resolved at run
time instead of being written down here.

Four things only a live run can settle:

| #   | What would falsify the rule                                          | Why a test cannot catch it                                                      |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | the `fields` expansion does not return `inventory_items` over HTTP   | read from the installed source's internal queries, never asked of the admin API |
| 2   | the shop still refuses a zero-stock sale with `allow_backorder` true | the tests assert the call; they do not observe a checkout                       |
| 3   | the channel has a location, but not the one the webshop sells from   | our own lookup produces the name; only the target can contradict it             |
| 4   | a fractional quantity is rejected rather than floored                | the validator has no `.int()`, but only a live call proves the acceptance       |

Items 1, 2 and 4 rest on the installed 2.19.0 source: a stronger footing than a
guess and a weaker one than an observation.

## Where the assertions live

| Claim                                                              | Where it is asserted                          |
| ------------------------------------------------------------------ | --------------------------------------------- |
| the four integration states stay distinct                          | `medusa-connection.service.spec.ts`           |
| no fallback when the stored credential is corrupt                  | `medusa-credential.provider.spec.ts`          |
| projection works from the stored key with no env key               | `medusa-projection.cli.spec.ts`               |
| a missing key is still visible as `not-configured`                 | `medusa-admin.config.spec.ts`                 |
| the secret is not read from the environment on the projection path | `medusa-projection.cli.spec.ts` (structural)  |
| the publication rule, every branch                                 | `medusa-publication.policy.spec.ts`           |
| the service APPLIES the rule, and sends both gates in one request  | `medusa-product-projection.service.spec.ts`   |
| a missing channel id stops before any call goes out                | `medusa-product-projection.service.spec.ts`   |
| a non-existent channel id stops on first use, once                 | `medusa-product-projection.service.spec.ts`   |
| the report names the state, the channel and the reason             | `medusa-projection.cli.spec.ts`               |
| the quantity formula, in one place for all five callers            | `available-to-sell.spec.ts`                   |
| the clamp, the floor, and that neither hides the other             | `medusa-inventory.policy.spec.ts`             |
| the projection SETS `allow_backorder`, flag before quantity        | `medusa-inventory-projection.service.spec.ts` |
| absolute desired state on both increase and decrease               | `medusa-inventory-projection.service.spec.ts` |
| a repeat run does not drift and creates no second level            | `medusa-inventory-projection.service.spec.ts` |
| a partial failure is not a success, and a retry converges          | `medusa-inventory-projection.service.spec.ts` |
| not exactly one stock location on the channel stops the run        | `medusa-inventory-projection.service.spec.ts` |
| a missing chain field is not read as an empty list                 | `medusa-inventory-projection.service.spec.ts` |
| a truncated variant list stops instead of answering "not found"    | `medusa-inventory-projection.service.spec.ts` |
| inventory never writes product status or sales channel             | `medusa-inventory-projection.service.spec.ts` |
| a non-ACROPORA product is not projected                            | `medusa-inventory.cli.spec.ts`                |
| the inventory report names quantity, location, clamp and backorder | `medusa-inventory.cli.spec.ts`                |
| **nothing on this page has been observed on a running system**     | **no file - see "What has NOT been proven"**  |

**A claim with an expiry condition, not a date.** Two Medusa integration specs
(`medusa-connection.repository.integration.spec.ts`,
`medusa-product-link.integration.spec.ts`) were written but named in no runner
list, so they ran nowhere.

The condition is checkable in one command, and it is the condition — not this
paragraph — that decides:

```bash
grep -c 'medusa-connection.repository.integration.spec.js' apps/api/package.json
```

- **`0`** — the specs still run nowhere, and "the Medusa integration tests are
  green" is an assumption rather than a statement.
- **`1`** — they run with the rest, and this paragraph no longer applies.

A date here would read just as confidently a month from now, and by then it could
be false. A condition cannot: it answers for itself.
