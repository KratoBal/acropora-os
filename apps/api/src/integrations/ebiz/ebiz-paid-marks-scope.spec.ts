import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * The paid-mark plans write to Számlázz.hu. An eBIZ invoice sits in the same
 * table, so every query those plans run over it must keep to the
 * Számlázz.hu rows; otherwise an eBIZ invoice could be "marked paid" in a
 * system that never issued it.
 */
const FILES = [
  "src/integrations/szamlazz/outgoing-payment-marks.ts",
  "src/integrations/simplepay/simplepay-paid-marks.dry-run.ts",
  "src/integrations/simplepay/simplepay-paid-marks.live.ts",
  "src/integrations/gls/gls-cod-paid-marks.dry-run.ts",
  "src/integrations/foxpost/foxpost-paid-marks.dry-run.ts",
];

describe("a fizetettnek jelölés csak Számlázz.hu számlát lát", () => {
  for (const file of FILES)
    it(file, () => {
      const source = readFileSync(file, "utf8");
      const calls = [
        ...source.matchAll(/externalBillingDocument\.find\w*\(\s*\{/g),
      ];
      assert.ok(calls.length > 0, "the file still queries the table");
      for (const call of calls) {
        const where = source.slice(call.index, call.index + 400);
        const whereStart = where.indexOf("where:");
        const selectStart = where.search(/\b(select|orderBy):/);
        assert.ok(whereStart >= 0, "the query has a where");
        assert.ok(
          where
            .slice(
              whereStart,
              selectStart > whereStart ? selectStart : undefined,
            )
            .includes('source: "SZAMLAZZ"'),
          `${file}: query at ${call.index} is not limited to SZAMLAZZ`,
        );
      }
    });
});
