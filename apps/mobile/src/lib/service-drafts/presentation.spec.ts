import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptBlocker,
  acceptInput,
  canReviewServiceDrafts,
  draftFilterLabel,
  draftMetaLine,
} from "./presentation";

describe("canReviewServiceDrafts", () => {
  it("lets in the internal owner and admin only, as the server's requireDraftAdmin", () => {
    assert.equal(canReviewServiceDrafts({ role: "OWNER" }), true);
    assert.equal(
      canReviewServiceDrafts({ role: "ADMIN", customerId: null }),
      true,
    );
    // MI PIROSIT: ha a szerepkor-lista tagabb a szervernel (biztos 403)
    assert.equal(canReviewServiceDrafts({ role: "MANAGER" }), false);
    assert.equal(canReviewServiceDrafts({ role: "SERVICE" }), false);
    // MI PIROSIT: ha a partner-kotes nem zar ki
    assert.equal(
      canReviewServiceDrafts({ role: "ADMIN", customerId: "c1" }),
      false,
    );
    assert.equal(
      canReviewServiceDrafts({ role: "OWNER", supplierId: "s1" }),
      false,
    );
    assert.equal(canReviewServiceDrafts(null), false);
  });
});

describe("draftFilterLabel", () => {
  it("marks uncertain and promoted always, unfiltered only when filtering is on", () => {
    assert.equal(
      draftFilterLabel({ filterState: "UNCERTAIN" }, false),
      "Bizonytalan",
    );
    assert.equal(
      draftFilterLabel({ filterState: "PROMOTED" }, false),
      "Kiszűrtből visszahozva",
    );
    assert.equal(
      draftFilterLabel({ filterState: "UNFILTERED" }, true),
      "Nem szűrt",
    );
    assert.equal(draftFilterLabel({ filterState: "UNFILTERED" }, false), null);
    assert.equal(draftFilterLabel({ filterState: "PASSED" }, true), null);
  });
});

describe("draftMetaLine", () => {
  it("names the date, the reporter, a repeat and the attachments, and leaves out what is missing", () => {
    assert.equal(
      draftMetaLine({
        reportDate: "2026-10-06",
        reporterPersonName: "Kiss Anna",
        occurrence: 2,
        attachments: [{ id: "a1" }],
      }),
      "2026-10-06 · Kiss Anna · 2. alkalom · 1 melléklet",
    );
    assert.equal(
      draftMetaLine({
        reportDate: "2026-10-06",
        reporterPersonName: "  ",
        occurrence: 1,
        attachments: [],
      }),
      "2026-10-06",
    );
  });
});

describe("accepting a draft", () => {
  it("needs the opener first, then a location, as on the web", () => {
    // MI PIROSIT: ha a nyito hianya nem allit meg (a szerver elutasitana)
    assert.match(acceptBlocker("dep-1", null)!, /partnerfelhasználójának/);
    // MI PIROSIT: ha helyszin nelkul is engedne
    assert.equal(
      acceptBlocker("", { id: "u1" }),
      "Válassz helyszínt az elfogadáshoz.",
    );
    assert.equal(acceptBlocker("dep-1", { id: "u1" }), null);
  });

  it("sends the trimmed author, cut at 200, and null for an empty one", () => {
    assert.deepEqual(acceptInput("dep-1", "  Kiss Anna "), {
      departmentId: "dep-1",
      reporterPersonName: "Kiss Anna",
    });
    assert.deepEqual(acceptInput("dep-1", "   "), {
      departmentId: "dep-1",
      reporterPersonName: null,
    });
    assert.equal(
      acceptInput("dep-1", "x".repeat(250)).reporterPersonName!.length,
      200,
    );
  });
});
