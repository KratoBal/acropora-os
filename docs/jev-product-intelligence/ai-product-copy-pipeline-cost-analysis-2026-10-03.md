# JEV Product Intelligence — AI product copy pipeline cost analysis

**Status:** proposal for review, not an approved architecture decision  
**Date:** 2026-10-03  
**Example product:** Korallen-Zucht Amino Acid High Concentrate 50 ml

Related context:

- `docs/jev-product-intelligence/v1-discovery.md`
- `docs/jev/product-enrichment-v0.md`
- Architecture Council #1199
- ACD-021 / PD-011 — Product Enrichment & Verification
- ACD-022 / P-036 — real-product offline benchmark protocol

This document is a **workflow and cost hypothesis for review**. It does not authorize implementation, live web access, product-master writes or webshop publishing.

## Goal

Turn a supplier/manufacturer product page into a high-quality Hungarian webshop product description that is:

- not a literal translation;
- factually grounded in primary/independent sources;
- natural in Hungarian;
- consistent with Acropora terminology and style;
- explicit about source conflicts;
- free of unsupported product claims;
- independently verified before it becomes a reviewable proposal.

The example used for the estimate is **KZ Amino Acid High Concentrate 50 ml**.

## Proposed production chain

```text
OS product context / supplier URL
        |
        v
JEV orchestration + product identity
        |
        v
Perplexity Search + targeted URL fetches
        |
        v
GPT-6.1 Sol — evidence extraction / normalization / conflict detection
        |
        v
JEV Product Intelligence — provenance + policy + OS context
        |
        v
Claude Opus 5.5 — final Hungarian webshop copy
        |
        v
GPT-6.1 Sol — independent factual verification
        |
        v
JEV review gate
        |
        +--> PASS -> reviewable proposal
        |
        +--> FAIL -> targeted correction / human review / escalation
```

**GPT-6 Astra is proposed only as conditional escalation**, not as the default path.

## Why split the roles?

The intent is not to stack models unnecessarily. Each stage has a narrow responsibility:

- **Perplexity:** source discovery and URL retrieval.
- **GPT-6.1 Sol:** structured evidence extraction and later independent QA.
- **JEV:** provenance, source precedence, conflict handling, product context, policy and escalation.
- **Claude Opus 5.5:** natural Hungarian commercial prose from already reconciled evidence.
- **GPT-6 Astra:** difficult cases only.

A benchmark may show that some of these stages are redundant. That is one of the questions for Marveen.

## JEV's role

JEV should not act as another generic copywriter. It should own the parts that are specific to Acropora and the existing product-enrichment model:

- product identity from OS data, SKU/EAN/manufacturer part number;
- existing Product Master / UNAS context;
- `FIELD_SPECS`, tiers and claim policy;
- source provenance and retrieval metadata;
- source precedence;
- explicit conflicts instead of silent winner selection;
- distinction between factual data and manufacturer marketing claims;
- Acropora terminology and copy rules;
- normal vs escalation path;
- per-run telemetry;
- reviewable proposal state.

The proposal should reuse the concepts already present in the product-enrichment work, including:

- `MANUFACTURER_PAGE`
- `MANUFACTURER_DOCUMENT`
- `SUPPLIER_PAGE`
- `SUPPLIER_DOCUMENT`
- `OS_PRODUCT_MASTER`
- `UNAS_CURRENT`
- `KNOWLEDGE_BASE`
- `CONFLICTING_SOURCES`
- `POSSIBLE_WRONG_VALUE`
- claim policy
- evidence/provenance

## Example flow: KZ Amino Acid High Concentrate 50 ml

Initial supplier source:

`https://www.marine-aquatics.eu/kz-amino-acid-aminokyseliny-koncentrat-50ml`

### Research

Search for:

- exact product identity;
- official Korallen-Zucht product page;
- official instructions/documentation where available;
- supplier page;
- one additional reliable distributor source only if needed.

Fetch only pages that can materially contribute evidence.

### Structured evidence

Conceptual output:

```text
manufacturer
productName
variant / volume
manufacturerSku / EAN where available
purpose
suitableFor
application
dosingText
composition where published
verifiedClaims[]
manufacturerClaims[]
conflicts[]
sources[]
retrievedAt
extractionConfidence
```

If supplier and manufacturer instructions disagree, the conflict must remain visible. A model preference must never become evidence.

### Copy

The copywriter receives the reconciled evidence package, not an unrestricted "research and write" prompt.

Expected sections:

- title;
- short lead;
- long description;
- key benefits;
- use/dosing;
- suitable applications;
- pack size / manufacturer;
- careful attribution where a statement is only a manufacturer claim.

### Verification

The checker receives:

1. evidence package;
2. source/provenance excerpts;
3. final Hungarian copy.

It marks unsupported, exaggerated, contradictory or mistranslated claims.

## Price assumptions

Prices were checked on **2026-10-03** against the providers' official pricing pages.

### OpenAI — Standard processing

- GPT-6.1 Sol: **$2 / 1M input tokens**, **$10 / 1M output tokens**
- GPT-6 Astra: **$10 / 1M input tokens**, **$50 / 1M output tokens**
- GPT-6 Luna: **$0.10 / 1M input tokens**, **$0.50 / 1M output tokens**

Source:

- https://developers.openai.com/api/docs/pricing

### Anthropic

Claude Opus 5.5:

- **$4 / 1M input tokens**
- **$20 / 1M output tokens**

Source:

- https://www.anthropic.com/claude/opus
- https://www.anthropic.com/claude-opus-5-5

### Perplexity

Working assumption used here:

- Search API: **$0.005 / successful request**
- targeted URL fetch: **$0.0005 / invocation**

Source:

- https://docs.perplexity.ai/docs/getting-started/pricing

### FX assumption

For readability only:

**1 USD = 327.44 HUF** on 2026-10-03.

Production telemetry should store provider cost in USD and convert separately.

## Per-product estimate — KZ Amino-sized product

These token counts are **assumptions to measure**, not production measurements.

### A. Web research

Assumption:

- 1 Perplexity search request;
- 3 URL fetches.

```text
Search:  1 x $0.0050 = $0.0050
Fetch:   3 x $0.0005 = $0.0015
Total:                 = $0.0065
```

**~2.13 HUF**

### B. Evidence extraction / normalization

Model: GPT-6.1 Sol

Assumption:

- 5,000 input tokens;
- 1,200 output/reasoning tokens.

```text
Input:  5,000 x $2 / 1M  = $0.010
Output: 1,200 x $10 / 1M = $0.012
Total:                    = $0.022
```

**~7.20 HUF**

### C. JEV validation/orchestration

Most of this should be deterministic code / existing JEV logic.

If a lightweight GPT-6 Luna validation pass is required, illustrative budget:

- 2,000 input;
- 600 output.

```text
Input:  2,000 x $0.10 / 1M = $0.0002
Output:   600 x $0.50 / 1M = $0.0003
Total:                       = $0.0005
```

**~0.16 HUF**

Target: rule-based where possible.

### D. Hungarian webshop copy

Model: Claude Opus 5.5

Assumption:

- 3,500 input;
- 900 output.

```text
Input:  3,500 x $4 / 1M  = $0.014
Output:   900 x $20 / 1M = $0.018
Total:                    = $0.032
```

**~10.48 HUF**

### E. Independent fact-check

Model: GPT-6.1 Sol

Assumption:

- 3,000 input;
- 400 output.

```text
Input:  3,000 x $2 / 1M  = $0.006
Output:   400 x $10 / 1M = $0.004
Total:                    = $0.010
```

**~3.27 HUF**

## Baseline total

```text
Perplexity research          $0.0065
GPT-6.1 Sol extraction       $0.0220
JEV lightweight validation   $0.0005
Claude Opus 5.5 copy         $0.0320
GPT-6.1 Sol fact-check       $0.0100
------------------------------------
TOTAL                        $0.0710
```

At the example FX rate:

**~23.25 HUF / product**

Planning range before measurement:

- simple product: **15–25 HUF**
- normal product similar to KZ Amino: **20–40 HUF**
- difficult/conflicting product: **50–100+ HUF**

## Astra escalation

Astra should not run on every routine product.

Illustrative triggers:

```text
identity_uncertain
OR critical_field_disagreement
OR evidence_insufficient
OR conflict_requires_deeper_reasoning
OR verifier_fail_after_targeted_retry
```

Example Astra pass with 5,000 input / 1,200 output tokens:

```text
Input:  5,000 x $10 / 1M = $0.050
Output: 1,200 x $50 / 1M = $0.060
Total:                    = $0.110
```

**~36.02 HUF for the escalation call itself.**

Added after the normal path, the example rises from ~23 HUF to roughly **59 HUF** before any additional rewrite.

## Scale examples

Using a simple **25 HUF average/product** planning assumption:

| Products | Estimated AI/tool cost |
| ---: | ---: |
| 100 | ~2,500 HUF |
| 500 | ~12,500 HUF |
| 1,000 | ~25,000 HUF |
| 5,000 | ~125,000 HUF |
| 10,000 | ~250,000 HUF |

Excluded:

- engineering;
- infrastructure;
- database/storage;
- observability;
- human review;
- VAT/tax;
- future provider price changes.

## Where optimization matters

The current hypothesis is that reducing ~23 HUF to ~15 HUF is less important than factual reliability.

The more valuable optimizations are:

### Reuse manufacturer research

Cache/store:

- trusted manufacturer domains;
- product family knowledge;
- manufacturer documents;
- source freshness/hash;
- glossary and approved Hungarian terminology.

### Reuse family-level evidence

Separate family facts from variant facts where products differ only by pack size/model/connector/color/etc.

### Search only when needed

If trusted manufacturer evidence already exists and is fresh, use freshness validation instead of a full search.

### Cache stable prompt/policy context

The Acropora style contract, field schema and policy are repeated context.

### Retry only the failed stage

A copy-style failure should not cause a new crawl. A factual conflict should not cause unnecessary prose generations.

## Proposed quality gates

No generated description should become publishable merely because a model returned text.

Suggested minimum gates:

1. exact product identity resolved;
2. acceptable independent/primary evidence exists for required factual fields;
3. provenance retained;
4. conflicts explicit;
5. critical fields do not silently choose a winner;
6. no unsupported prose claim;
7. dosing/safety/composition get stricter handling;
8. independent verifier passes;
9. review state is visible in OS;
10. human approval remains available/required according to Council decision.

## Telemetry required before architecture selection

Record per stage:

- provider;
- model + model version;
- prompt/policy version;
- input tokens;
- cached input;
- output/reasoning tokens;
- tool calls;
- provider cost where available;
- latency;
- fetched source count/types;
- retry count;
- escalation reason;
- verifier result;
- human accept/edit/reject;
- human edits / structured field changes.

Without this, the **~23 HUF/product** figure remains only a planning estimate.

## Suggested benchmark

Run the same real products through competing chains.

Suggested set:

- 5 easy products with clean manufacturer pages;
- 5 multi-variant products;
- 5 products with Czech/German supplier text;
- 5 products with supplier/manufacturer conflicts;
- 5 products with technical/dosing claims.

Score separately:

- identity accuracy;
- factual field accuracy;
- conflict detection;
- unsupported claims;
- Hungarian naturalness;
- marine-aquarium terminology;
- human editing effort;
- latency;
- total cost.

Do not select the production chain from general LLM leaderboards alone.

## Questions for Marveen

Please review this against the **actual current repository and current JEV architecture**, not from memory.

1. Which proposed stages are redundant with `packages/jev/src/product-enrichment/`?
2. Can the current V0 evidence/provenance types represent this without schema distortion?
3. Where should external web retrieval live: JEV package, API integration layer, or a dedicated research worker?
4. Is Perplexity Search useful here, or would direct provider search / deterministic manufacturer discovery be simpler?
5. Should GPT-6.1 Sol perform both extraction and verification, or should verification intentionally use a different model/provider?
6. Is Claude Opus 5.5 justified for copy, or should Sonnet / GPT / Gemini be benchmarked as production writers?
7. Which steps should be deterministic code instead of LLM calls?
8. What is the smallest implementation that preserves the existing **no silent winner** conflict rule?
9. How should source/family-level caching fit the current model?
10. What telemetry already exists and what is missing?
11. Which current freeze / Council decisions constrain even a measurement-only implementation?
12. What would you remove from this chain before building anything?

### Requested Marveen response

Return:

- **architecture fit:** fits / partially fits / conflicts, with code evidence;
- **recommended minimum chain;**
- **recommended benchmark chains;**
- **missing prerequisites;**
- **cost corrections;**
- **specific files/types/services to reuse;**
- **risks / hidden assumptions;**
- **whether a measurement PR is justified now.**

**Do not implement from this document alone.**

## Current recommendation to test

```text
Perplexity Search
  -> GPT-6.1 Sol structured extraction
  -> JEV reconciliation/provenance
  -> Claude Opus 5.5 Hungarian copy
  -> GPT-6.1 Sol independent verification
  -> JEV review gate
```

with GPT-6 Astra as conditional escalation only.

Baseline KZ Amino-sized estimate under the assumptions above:

**~$0.071 / ~23 HUF per product.**

The recommendation is to measure correctness, human editing and conflict handling first, and optimize token cost only after that.
