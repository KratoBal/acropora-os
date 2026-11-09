# Stage anonymization: what is built, how a run goes, what is still open

Card 07b56a1f, plan `exchange/acroveliq-stage-vedelem-es-anonimizalas-terv-2026-10-12.md` (sections 3.1, 3.2, 3.5). The code is in
`packages/database/src/stage-anonymization/` and `anonymization-register*.ts`. Nothing here reads production, and nothing in the
code touches a database yet: the runner works on an adapter (`RunnerDatabase`), and the adapter is the next slice (S6).

## The modules (each a pure function set with its own tests)

| Slice    | File                                                           | What it does                                                                                                                                                             |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| register | `anonymization-register.ts`, `anonymization-register-check.ts` | one decision per text, JSON and binary column; the CI test fails on a new column without one                                                                             |
| S1       | `pseudonymizer.ts`                                             | keyed, deterministic, format-valid fakes (e-mail, names, phone, tax numbers, IBAN, account numbers, street, parcel number, IP); no real character survives a fallback    |
| S2       | `text-scrubber.ts`, `json-scrubber.ts`                         | patterns and a real-name dictionary in free text; key-name rules in JSON; credential and network keys deleted by a part of the name                                      |
| S3       | `row-transformer.ts`                                           | the register applied to one row: keep, pseudonymize, replace, delete (or drop the row); natural-person rows recognised; fail closed                                      |
| S4       | `residual-scan.ts`, `verification-gate.ts`                     | a keyed-digest dictionary of the real values scans the anonymized rows; the eight-section gate (the seven of plan 3.5 plus a check that the transform visited every row) |
| S5       | `runner.ts`                                                    | the orchestration over an abstract database, behind a guard that accepts only a temporary database name                                                                  |

## How a run goes (plan 3.1), and who does each step

1. **Dump of production, read only** (HOST: touches the production dump; not done by the runner or by an agent).
2. **Restore into a temporary database named `stage_anon_tmp_<letters, digits, underscores>`** on the stage host (HOST). The runner
   refuses any other name, so production, the stage database and a developer's database cannot be hit by a wrong argument.
3. **`runAnonymization`** (the runner; needs the S6 adapter to run against a real database): measures the source, builds the
   residual dictionary from the natural persons' values, transforms every row in the temporary database, measures again, scans
   for residual personal data, runs the working trial, runs the gate, and returns the report with `swapAllowed`.
4. **Swap** the temporary database in as the stage database (HOST), only when `swapAllowed` is true. The runner never swaps.

   **The working trial runs BEFORE the swap, on the temporary database** (owner's operating decision, 2026-11-09; it fits the
   plan's "everything happens during the copy"). The caller starts an application instance bound to the temporary database, runs
   a stub invoice, an order flow, a work sheet and a ticket against it, and hands the runner a result with NAMED checks
   (`{ passed, checks: [{ name, passed }] }`). The gate does not accept a trial that was skipped, failed, or reported no
   checks: a bare `passed: true` cannot be told from a stub, so it fails and the report says so. There is no trial after the
   swap, and so nothing to roll back after it.

   **The gate requires its checks, not only the ones it was handed.** The eight sections (rowCounts, transformCoverage, referentialIntegrity,
   residualPersonalData, formats, invariants, correlations, workingTrial) must each be present exactly once, and a missing or
   repeated one fails the gate in a `gateStructure` section that names it. The format check needs a sample of fake e-mail,
   phone, IBAN and personal tax id on every run (a source that has none of one of them is a run that did not look). A company
   tax number sample is required only while the kinds table makes company fakes: the company data is KEPT today (the open
   decision), so no company fake exists and none is required.

## What the run needs

- A pseudonymization key and a scan key, each at least 32 bytes, made for the run and kept only in the stage process. Never in the
  repository, never in a log. A new pseudonymization key gives different fakes (the stage's names change); keep it if the stage's
  fakes should stay stable between copies.
- The stage-only password hash (the hash of the password the owner hands out). Every password hash field gets it, except a
  `@unique` one (it gets a fresh token per row).
- The adapter (`prisma-adapter.ts`, S6): row streaming per model, a write-back by key, the orphan counts per foreign key, the
  business aggregates and pairings, the migration state, the health check, all as raw SQL over the Prisma client, read from the
  schema text. It measures per enum column the row count per value, per numeric column the exact sum, and per relation the
  non-null and distinct counts (columns the transform never touches); a model whose rows the transform drops is left out of the
  aggregates, since its numbers move on purpose. Its database name is what the SERVER says (`current_database()`), and the runner's
  guard refuses anything that is not a `stage_anon_tmp_...` name before a row is read.

## The command (S6)

```
cd <the repository root>
DATABASE_URL=<the temporary database> STAGE_ANON_PSEUDONYM_KEY=... STAGE_ANON_SCAN_KEY=... \
STAGE_ANON_PASSWORD_HASH=... [STAGE_ANON_TRIAL_COMMAND='["program","arg"]'] \
pnpm --filter @acropora/database stage:anonymize
```

It is run by the stage operator on the HOST, never by the API. Everything comes from the environment (no flags). The optional trial
command is a JSON array run without a shell after the transform; exit code 0 is a passed trial, and without one the gate fails.
The report is printed as JSON (table and column names and counts, never a value) and the exit code is 0 only when the gate passed,
so the swap step can chain on it. The command never swaps and never dumps; those stay host steps. `runStageAnonymization`
(`stage-run.ts`) is the same thing as a function: it checks the register against the schema first, hands the models that lose rows
to the adapter, and calls the runner.

The first run against a real Postgres is the CI integration spec
(`apps/api/src/stage-anonymization/stage-anonymization.integration.spec.ts`): it creates a scratch `stage_anon_tmp_ci_...`
database on the CI service, applies every real migration, seeds invented rows, runs the whole chain and drops the database.

## Decisions and limits, said plainly

- **Open decision (the owner): company names and tax numbers** are kept for now (`COMPANY_DATA_ACTION` in the register: one line
  changes it, and a company then gets a fake `... Kft.` name). A sole trader and a private person are always pseudonymized.
- **Open decision (the owner): typo duplicates.** The fakes are deterministic per exact value (folded for case and spacing), so two
  spellings of one customer stay two fakes. Testing typo duplicates needs a costlier, character-wise scheme.
- **A name written alone** (a bare surname) is not found or replaced: only full names (two words or more) are in the dictionary.
- **A phone number written without a prefix** is not replaced by the text scrubber (nothing says it is a phone); the residual scan
  finds it by its national digits and fails the gate.
- **Unique columns:** 18 fields with a `@unique` are changed by the register (see the S3 pull request). A pseudonymized one stays
  unique as long as distinct real values get distinct fakes; the runner records every new value and FAILS the run on a repeat.
- **The tax-number checks:** the company tax core's check digit was measured on four public numbers; the personal tax id's check
  digit is from secondary articles and was not confirmed against the law (1996. evi XX. torveny, annex 1).
- **Dates, numbers and enums** are outside the register's scope by type (its header says so); a future birth date or coordinate
  column needs the scope widened, not just a row.
