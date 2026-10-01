# Jev: Product Enrichment & Verification, V0

Contract: KratoBal/acropora-os #1199, **ACD-021 / PD-011**
([comment 5938327176](https://github.com/KratoBal/acropora-os/issues/1199#issuecomment-5938327176)).
Development start approved by Balázs on 2026-10-01.

This document maps P-031 to P-035 onto this codebase and describes what V0
adds. **PD-011 authorizes V0 only:** design and discovery, a source inventory,
and an offline benchmark of 30-50 products. Before any further step, the
Council has to decide whether to build a reviewed draft-product workflow.

## What V0 is and is not

| V0 does                                                              | V0 does not                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| defines the provenance-first field model (P-033) as TypeScript types | write any product, variant, barcode or category row                           |
| ships deterministic Tier C validators (GTIN, units)                  | publish anything, or change anything customer-visible                         |
| ships a reconciler that never picks between disagreeing sources      | touch the storefront, UNAS sync, the Medusa projection or catalogue migration |
| ships a guard that rejects any Tier C value without evidence         | call Jev, need a secret, or read an environment variable                      |
| ships an offline benchmark harness that reports the seven metrics    | read the database                                                             |
| ships a **synthetic** fixture that tests the harness                 | contain any real product, price, customer or supplier data                    |

The code lives in `packages/jev/src/product-enrichment/`. It is **not
re-exported** from `@acropora/jev`'s main entry point, because the API imports
that entry point. V0 has no live call path, and keeping it out of the main
entry point means the API cannot reach it by accident.

## Inventory: what already exists

### The product master (`packages/database/prisma/schema.prisma`)

| Model                                               | Fields relevant to enrichment                                                                                                                                                      | Notes                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Product`                                           | `name`, `description` (short, UNAS `Description.Short`), `descriptionLong`, `brandId`, `categoryId` (deprecated pointer), `catalogAuthority`, `webshopSellable`, `webshopExcluded` | `catalogAuthority` (UNAS / ACROPORA / null) decides who owns the master data (`apps/api/src/products/catalog-authority.ts`). Any future write must respect it. **There is no column for a structured spec** (flow, power, voltage, and so on). |
| `ProductVariant`                                    | `sku` (unique), `manufacturerPartNumber`, `unit`, `secondaryUnit*`, `unasVariantValues`                                                                                            | `manufacturerPartNumber` is the only Tier C identifier column the master already has.                                                                                                                                                          |
| `ProductBarcode`                                    | `code` (unique across the whole catalogue), `isPrimary`                                                                                                                            | Holds EANs **and the shop's own internal codes**, so `apps/api/src/products/barcode.util.ts` only _reports_ the EAN check digit. See [PRODUCT-BARCODES.md](../PRODUCT-BARCODES.md).                                                            |
| `ProductCategory`                                   | `productId`, `categoryId`, `isPrimary`, `source`                                                                                                                                   | The category source of truth. Its free-text `source` column is the only provenance-like column on the product side today.                                                                                                                      |
| `ProductExtension`                                  | stock levels, preferred supplier, last purchase price, `phaseOut`                                                                                                                  | Purchasing and stock data. **Nothing to enrich here**; listed because the task asked for it.                                                                                                                                                   |
| `SupplierProduct`                                   | `supplierSku`, `supplierName`, `packageSize`                                                                                                                                       | Supplier-side identity: input for P-034 (supplier item → draft).                                                                                                                                                                               |
| `ProductDatasheet` + `ProductDatasheetFieldRefusal` | livestock datasheet fields; per-field refusal with `RefusalReason` = `NINCS_FORRAS` (no source) / `DONTESRE_VAR` (waiting for a decision)                                          | **The closest existing precedent for P-033:** "no source" is already a recorded, first-class outcome instead of an empty field. A V1 schema should follow the same idea.                                                                       |
| `UnasProductSnapshot`                               | the UNAS mirror                                                                                                                                                                    | Source type `UNAS_CURRENT`.                                                                                                                                                                                                                    |

Read-only analysis that already exists: `apps/api/src/products/product-data-completeness.ts`
(required catalogue fields, forbidden livestock claims, with an explicit
`unrecognizable` state). It is the P-035 precedent: a report-only audit.

### The Jev integration pattern

- **`packages/jev`**: the offline evaluators (`evaluation.ts`, `run.ts`), the
  Jev client with an injectable `fetch` (`jev-client.ts`), canonical
  projection hashing (`cph1.ts`), the redactor, and the per-policy rule
  modules (`asset-category-prefill.ts`, `missing-invoice-pair-policy.ts`).
  Pattern: **measure offline first, against a gold set, with the thresholds
  stated before the run.**
- **`apps/api/src/decisions`** (`DecisionRun`, `asset-category-suggestion`):
  the V1 live pattern. Every call is a `DecisionRun` row (policy key and
  version, projection hash, options hash, model, confidence, exposure
  `SHOWN`/`HIDDEN`, resolution). Jev **suggests**; the human saves. There is a
  kill switch, a timeout and a single attempt, and an error is a silent
  no-suggestion.
- **`apps/api/src/missing-invoices/*jev*`**: the same pattern applied to a
  second domain, with redaction before the call and a 10% hidden control.

Product enrichment fits this pattern unchanged. V0 builds the offline part. A
later V1 would add a `DecisionRun` policy key (for example
`products.enrichment@1`), and the `sourceRef` of a Jev-produced value would be
the `DecisionRun` id.

## P-033: the provenance-first field model

`packages/jev/src/product-enrichment/provenance.ts`

```ts
interface FieldResult {
  field: string;
  value: string | null; // non-null ONLY for VERIFIED and SUGGESTED
  sourceType: SourceType | null; // primary source of the agreeing group
  sourceRef: string | null;
  retrievedAt: string | null; // ISO 8601
  confidence: number | null; // lowest extraction confidence in the group
  status:
    | "VERIFIED"
    | "SUGGESTED"
    | "MISSING"
    | "CONFLICTING_SOURCES"
    | "UNVERIFIED"
    | "POSSIBLE_WRONG_VALUE";
  conflicts?: ConflictEntry[]; // every distinct value with every source stating it
  evidence: SourcedValue[]; // every accepted candidate
  rejected: RejectedCandidate[]; // every candidate refused, and why
  reconciledAt: string | null; // supplied by the caller; nothing reads the clock
}
```

**Invariant:** a field that is missing, conflicting or unverified has no
`value`. What the sources said is kept in `evidence`, `conflicts` and
`rejected`, so it is never lost, but it can never be mistaken for the answer.

### Source types and precedence

`SOURCE_PRECEDENCE` lists the sources in the order P-031 gives them:
manufacturer page, manufacturer document, supplier page, OS Product Master,
current UNAS data, historical supplier document, Knowledge Base. Values Jev
produces itself have the separate type `JEV_PROPOSAL`.

The precedence is explicit, as the decision requires, and it is used **only
to order** a conflict set and to name the primary source of a group that
already agrees. **It never decides a disagreement.**

**Independent sources** (manufacturer page or document, supplier page or
document) are the only ones that can make a value VERIFIED. The OS Product
Master and the current UNAS data are the data P-032 verifies, so agreeing with
them is circular: a Tier C value backed only by them is UNVERIFIED.

## Tiers

`packages/jev/src/product-enrichment/fields.ts`, `FIELD_SPECS`

| Tier | Fields                                                                                                                                                | Rule                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A    | searchKeywords, seoTitle, metaDescription, featureBullets, categorySuggestion, shortDescription, longDescription                                      | Jev may propose (`SUGGESTED`); still reviewable                                                                        |
| B    | title, category, compatibility, application, dosingText, productFamily                                                                                | human-confirmed before an authoritative write                                                                          |
| C    | ean, manufacturerSku, lengthMm / widthMm / heightMm, volume, weight, flowRate, power, voltage, dosingAmount, composition, warranty, safetyInformation | **copy or verify only; never synthesize.** No trustworthy source → `MISSING` or `UNVERIFIED`                           |
| C\*  | brand, capacity, packSize, packageContents                                                                                                            | named in P-031 but not placed in a tier by the decision: **the strictest tier by default** (`tierFromDecision: false`) |

## The deterministic parts

The decision's architecture boundary assigns identifiers, schemas, field
validation, unit normalization, uniqueness, final writes and publication
state to deterministic code. V0 implements the first four of these as pure
functions. Uniqueness, writes and publication do not exist in V0.

### Validators

- **`validateGtin`** (`gtin.ts`): EAN-8, UPC-A, EAN-13 and GTIN-14, with the
  GS1 check digit. The only formatting it forgives is whitespace. The
  comparison form is zero-padded to 14 digits, so a UPC-A and its 13-digit
  form are the same GTIN. Restricted-circulation (in-store) numbers are
  flagged, not rejected. This is deliberately stricter than `barcode.util.ts`,
  which has to accept internal codes.
- **`parseQuantity`** (`units.ts`): flow (l/h, L/h, lph, l/óra, m³/h → l/h),
  power (W, kW → W), voltage (V, with AC/DC kept), volume (ml, l → ml), length
  (mm, cm, m → mm), mass (g, kg → g). The arithmetic is exact decimal. **It
  rejects:**
  - a value with no unit;
  - a range or a multiple (`2000-3000 l/h`, `2 x 24 W`, `5 ml/100 l`);
  - a qualifier (`max.`, `~`, `ca.`, `kb.`, `up to`, `akár`);
  - a separator followed by exactly three digits (`1.500 l/h`: 1.5 or 1500
    depending on the writer's locale);
  - an unknown unit, or a unit of the wrong dimension;
  - zero, or trailing text.

  Space-grouped thousands (`3 000 l/h`) are accepted.

- **Identifiers** (manufacturer SKU): case and whitespace are treated as
  formatting. A hyphen is not: `AB-123` and `AB123` are reported as a
  conflict for a human to settle.

### The reconciler (`reconcile.ts`)

`reconcileField(field, candidates)` applies one fixed decision table:

1. Every candidate passes the provenance guard or is rejected as
   `UNSUPPORTED`.
2. Every remaining candidate is normalized (check digit, units) or is
   rejected as `INVALID`.
3. If nothing was accepted, the result is `POSSIBLE_WRONG_VALUE` when a
   value was invalid, `UNVERIFIED` when a value was unsupported, and `MISSING`
   when there was no candidate at all.
4. If the accepted values disagree after normalization, the result is
   **`CONFLICTING_SOURCES`, with the full conflict set**, whatever the
   sources' precedence.
5. If the values agree but some source stated an invalid value, the result
   is `POSSIBLE_WRONG_VALUE`, with the conflict set.
6. If the values agree, the result is `VERIFIED` when at least one source is
   independent. Otherwise it is `SUGGESTED` for Tier A/B and `UNVERIFIED` for
   Tier C.

### The guard (`guard.ts`)

- `candidateProvenanceProblem` is applied to every candidate **entering**
  the reconciler. It rejects a Tier C value from `JEV_PROPOSAL`, and any
  evidence without a `sourceRef` or a valid `retrievedAt`.
- `guardFieldResult` is applied to a result **coming from elsewhere**, such
  as a Jev output. A Tier C result is rejected if it is `SUGGESTED`, has no
  `sourceRef`, has a non-independent source type, or has no evidence entry
  that **states the same value**. A rejected result is downgraded to
  `UNVERIFIED` with no value, and the violations are returned.

The tests prove the hard rule in three ways:

- by enumerating every Tier C field against every source type and every
  missing-reference or missing-timestamp variant;
- with a seeded randomized run of 4,000 mixed candidate sets;
- by checking that every reconciler `VERIFIED` result also passes the guard.

## The Jev / deterministic-code boundary (from ACD-021)

| Jev                                                                  | Deterministic code                     |
| -------------------------------------------------------------------- | -------------------------------------- |
| semantic extraction (reading a datasheet)                            | source fetching and parsing transport  |
| reconciliation **proposals**                                         | identifiers, schemas, field validation |
| classification (category, product family)                            | unit normalization                     |
| conflict detection (e.g. sibling contamination, name vs description) | uniqueness constraints                 |
| evidence-grounded copy generation                                    | final writes, publication state        |

In practice: Jev reads a source and says "the datasheet, page 4, says
3000 l/h". The deterministic layer checks that the value parses and that the
reference exists, then compares it with every other source. Jev never
decides that two sources agree.

## P-031 to P-035 in this codebase

- **P-031 Enrichment:** the field list is `FIELD_SPECS`. The sources are
  `SOURCE_PRECEDENCE`. There is no place to store a structured spec yet (see
  the open questions).
- **P-032 Verification:** a field status and a reconciliation of the current
  data (`OS_PRODUCT_MASTER`, `UNAS_CURRENT`) against independent sources.
  Sibling contamination and name-vs-description checks are Jev's part, and
  will be measured in the benchmark under conflict detection.
- **P-033 Provenance:** `FieldResult`, as above.
- **P-034 Draft product flow:** not in V0. The natural entry point is the
  existing supplier-line workflow (`supplier-line-candidates.ts`): a supplier
  item with no master counterpart leads to an enrichment draft, then human
  review. Writes must go through the existing product services and respect
  `catalogAuthority` and `webshopExcluded`.
- **P-035 Catalogue Data Quality Agent:** not in V0. It would be report-only,
  like `product-data-completeness.ts` and `decision-report.ts`.

## The V0 benchmark

```bash
pnpm --filter @acropora/jev build
node packages/jev/scripts/eval-product-enrichment.mjs --dataset <file.json> [--out <dir>] [--json] [--gate]
```

The harness is offline: it makes no network or database calls and reads no
environment variables. `--gate` makes the script exit with code 3 when the
unsupported-fact gate is not `PASS`.

**The real 30-50 product dataset is supplied separately and is never
committed.** The only dataset in the repository is
`packages/jev/fixtures/product-enrichment-synthetic.json`: four invented
products with obviously fake names and `synthetic://` sources, which exist
only to test the harness.

### Dataset format (`product-enrichment-benchmark@1`)

```jsonc
{
  "schema": "product-enrichment-benchmark@1",
  "products": [
    {
      "id": "p-01",
      "sources": ["<source ref>", "..."], // the source inventory for this product
      "gold": {
        "flowRate": { "status": "VERIFIED", "value": "3000 l/h" },
        "voltage": {
          "status": "CONFLICTING_SOURCES",
          "supportedValues": ["12 V", "24 V"],
        },
        "ean": { "status": "MISSING" },
      },
      "candidate": {
        // Jev output, one FieldResult-shaped entry per field
        "flowRate": {
          "status": "VERIFIED",
          "value": "3 m³/h",
          "sourceType": "MANUFACTURER_DOCUMENT",
          "sourceRef": "<ref>",
          "retrievedAt": "2026-10-01T09:00:00Z",
          "confidence": 0.95,
        },
      },
      "human": { "flowRate": "ACCEPTED" }, // optional: ACCEPTED | EDITED | REJECTED
      "copyQuality": 4, // optional: 1..5
    },
  ],
}
```

### The seven metrics, each reported separately

1. **Field extraction accuracy:** of the gold `VERIFIED` fields, the share
   the candidate asserted with the same value after normalization.
2. **Conflict detection accuracy:** whether `CONFLICTING_SOURCES` was flagged,
   compared with gold over every gold-labelled field (accuracy, precision,
   recall, and the confusion counts).
3. **Missing-field detection:** recall over gold `MISSING` fields (the
   candidate left the field without a value), plus the number of false
   `MISSING` results.
4. **Unsupported-fact (hallucination) rate:** over asserted Tier C values.
   A value counts as unsupported if any of these holds:
   - the guard rejects it;
   - its `sourceRef` is not in the product's source inventory;
   - gold says no source supports any value;
   - no source states that value.

   **This is the hard gate: it must be zero** (`PASS`). If nothing was
   asserted, the result is `NO_DATA`, not `PASS`.

5. **Provenance completeness:** of the asserted values and the conflict
   outputs, the share with a source type, a `sourceRef`, a valid
   `retrievedAt` and a confidence. A conflict output also needs at least two
   conflict entries.
6. **Human acceptance rate:** only if the dataset has labels; otherwise
   `n/a`.
7. **Copy quality:** scored **only** for products that passed the factual
   checks (every gold value correct, every gold conflict flagged, no
   unsupported fact). The other products are counted as "not scored".

A metric with nothing to measure reports `n/a`, never 0% or 100%.

## Open questions for the Council and the reviewer

1. **Tier placement** of brand, capacity, pack size and package contents.
   P-031 names them but the tier list does not. V0 treats them as Tier C.
2. **The Knowledge Base:** is it an independent source? V0 treats it as
   internal (it cannot verify a value) until it is clear what it is curated
   from.
3. **A confidence threshold for VERIFIED.** V0 reports the lowest extraction
   confidence but does not gate on it, because the decision sets no number.
4. **Where structured specs live in V1.** The master has no columns for
   flow, power or voltage. The options are a typed table with provenance
   columns (following `ProductDatasheetFieldRefusal`) or a generic
   field/value/provenance table. This needs an ADR and a migration, and is
   out of scope for V0.
5. **Dimension triplets** (`30 x 20 x 10 cm`) are rejected as multiples.
   V0 models length, width and height as three fields. Whether to add a
   triplet parser is a question for the benchmark data.
6. **Who labels** the 30-50 product gold set, and where it is stored outside
   the repository (the precedent is PD-003 for the asset-category gold set).
