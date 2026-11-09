# Stage anonymization: what is built, how a run goes, what is still open

Card 07b56a1f, plan `exchange/acroveliq-stage-vedelem-es-anonimizalas-terv-2026-10-12.md` (sections 3.1, 3.2, 3.5). The code is in
`packages/database/src/stage-anonymization/` and `anonymization-register*.ts`. Nothing here reads production, and nothing in the
code touches a database yet: the runner works on an adapter (`RunnerDatabase`), and the adapter is the next slice (S6).

## The modules (each a pure function set with its own tests)

| Slice    | File                                                           | What it does                                                                                                                                                          |
| -------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| register | `anonymization-register.ts`, `anonymization-register-check.ts` | one decision per text, JSON and binary column; the CI test fails on a new column without one                                                                          |
| S1       | `pseudonymizer.ts`                                             | keyed, deterministic, format-valid fakes (e-mail, names, phone, tax numbers, IBAN, account numbers, street, parcel number, IP); no real character survives a fallback |
| S2       | `text-scrubber.ts`, `json-scrubber.ts`                         | patterns and a real-name dictionary in free text; key-name rules in JSON; credential and network keys deleted by a part of the name                                   |
| S3       | `row-transformer.ts`                                           | the register applied to one row: keep, pseudonymize, replace, delete (or drop the row); natural-person rows recognised; fail closed                                   |
| S4       | `residual-scan.ts`, `verification-gate.ts`                     | a keyed-digest dictionary of the real values scans the anonymized rows; the seven-section gate of plan 3.5                                                            |
| S5       | `runner.ts`                                                    | the orchestration over an abstract database, behind a guard that accepts only a temporary database name                                                               |

## How a run goes (plan 3.1), and who does each step

1. **Dump of production, read only** (HOST: touches the production dump; not done by the runner or by an agent).
2. **Restore into a temporary database named `stage_anon_tmp_<letters, digits, underscores>`** on the stage host (HOST). The runner
   refuses any other name, so production, the stage database and a developer's database cannot be hit by a wrong argument.
3. **`runAnonymization`** (the runner; needs the S6 adapter to run against a real database): measures the source, builds the
   residual dictionary from the natural persons' values, transforms every row in the temporary database, measures again, scans
   for residual personal data, runs the gate, and returns the report with `swapAllowed`.
4. **Swap** the temporary database in as the stage database (HOST), only when `swapAllowed` is true. The runner never swaps.
5. **Working trial on the stage** (a stub invoice, an order flow, a work sheet, a ticket). The caller runs it and passes the
   result; without one the gate does not pass.

## What the run needs

- A pseudonymization key and a scan key, each at least 32 bytes, made for the run and kept only in the stage process. Never in the
  repository, never in a log. A new pseudonymization key gives different fakes (the stage's names change); keep it if the stage's
  fakes should stay stable between copies.
- The stage-only password hash (the hash of the password the owner hands out). Every password hash field gets it, except a
  `@unique` one (it gets a fresh token per row).
- The adapter (S6): row streaming per model, a write-back by key, the orphan counts per foreign key, the business aggregates
  and pairings, the migration state, the health check. Which aggregates and pairings to measure is the list of plan 3.5 points 5
  and 6 (monthly order and invoice sums, stock balances, status distributions, the customer-order and customer-invoice pairings);
  a measure that the transform changes on purpose (the sessions that are dropped) does not belong on it.

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
