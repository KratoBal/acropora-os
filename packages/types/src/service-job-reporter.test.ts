import assert from "node:assert/strict";
import test from "node:test";
import { serviceJobReporterName } from "./service-job-reporter.js";
test("reporter appends the person only when present", () => {
  assert.equal(
    serviceJobReporterName("Cápasuli", "Szilveszter Roland"),
    "Cápasuli (Szilveszter Roland)",
  );
  assert.equal(serviceJobReporterName("Cápasuli", null), "Cápasuli");
  assert.equal(serviceJobReporterName("Cápasuli", "  "), "Cápasuli");
  assert.equal(serviceJobReporterName(null, null), null);
});
