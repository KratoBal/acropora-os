import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dryReport } from "./invoice-collection-reread.cli.js";

describe("the dry re-read report", () => {
  it("lists a failed file even when its verdict did not change (acrobot 25852)", () => {
    const report = dryReport([
      {
        source: "INFO_MAIL",
        externalId: "m-1",
        fileName: "Hetzner.pdf",
        before: "UNMATCHED",
        after: "STORED",
      },
      {
        source: "INFO_MAIL",
        externalId: "m-1",
        fileName: "scan.pdf",
        before: "UNREADABLE",
        after: "UNREADABLE",
      },
      {
        source: "INFO_MAIL",
        externalId: "m-2",
        fileName: "(túl nagy melléklet)",
        before: null,
        after: "TOO_LARGE",
      },
      // a forrás hibája nem fájl: a változások közt áll, a hiba-sorok közt nem
      {
        source: "DRIVE",
        externalId: "",
        fileName: "(forrás)",
        before: null,
        after: "UNREADABLE",
        detail: "DRIVE:GOOGLE_AUTH_FAILED",
      },
      {
        source: "INFO_MAIL",
        externalId: "m-3",
        fileName: "level.pdf",
        before: "NOT_INVOICE",
        after: "NOT_INVOICE",
      },
    ]);
    const [changed, failed] = report.split(/^hiba-sor: /m);
    assert.match(changed!, /^változna: 3 fájl \(látott: 5\)\n/);
    assert.match(changed!, /Hetzner\.pdf\tUNMATCHED -> STORED/);
    assert.doesNotMatch(changed!, /scan\.pdf/);
    assert.match(failed!, /^2 \(a változatlan is\)\n/);
    assert.match(failed!, /m-1\tscan\.pdf\tUNREADABLE -> UNREADABLE/);
    assert.match(failed!, /m-2\t\(túl nagy melléklet\)\t\(új\) -> TOO_LARGE/);
    assert.doesNotMatch(failed!, /forrás|level\.pdf/);
  });
});
