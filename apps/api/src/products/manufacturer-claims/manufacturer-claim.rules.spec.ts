import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  claimOutput,
  DISPUTED_PLACEHOLDER,
  knowledgeLinkState,
  MANUFACTURER_ATTRIBUTION,
  reviewQueueRank,
  statusChangeRefusal,
} from "./manufacturer-claim.rules.js";

const LIVE = { archivedAt: null };

describe("gyártói állítás: kiírási szabály (T5.3, 2. pont)", () => {
  it("gyártói forrással egyező: kiírható, a gyártó szerint jelöléssel", () => {
    const out = claimOutput(
      { claimType: "EFFECT", status: "MATCHES_MANUFACTURER", ...LIVE },
      "NONE",
    );
    assert.equal(out.mode, "PUBLISHABLE");
    assert.equal(out.attribution, MANUFACTURER_ATTRIBUTION);
    assert.deepEqual(out.reasons, []);
  });

  it("független forrással megerősítve: kiírható, jelölés nélkül", () => {
    const out = claimOutput(
      { claimType: "EFFECT", status: "INDEPENDENTLY_CONFIRMED", ...LIVE },
      "NONE",
    );
    assert.equal(out.mode, "PUBLISHABLE");
    assert.equal(out.attribution, null);
  });

  it("vitatott: nem írható ki, a hiányjelzés marad", () => {
    const out = claimOutput(
      { claimType: "EFFECT", status: "DISPUTED", ...LIVE },
      "NONE",
    );
    assert.equal(out.mode, "BLOCKED");
    assert.equal(out.placeholder, DISPUTED_PLACEHOLDER);
    assert.deepEqual(out.reasons, ["DISPUTED"]);
  });

  it("ellenőrizetlen: csak vázlatba", () => {
    const out = claimOutput(
      { claimType: "COMPOSITION", status: "UNVERIFIED", ...LIVE },
      "NONE",
    );
    assert.equal(out.mode, "DRAFT_ONLY");
    assert.deepEqual(out.reasons, ["UNVERIFIED"]);
  });

  it("adagolás és biztonság: kiküldés előtt kötelező az ellenőrzés, a többinél nem jelölt", () => {
    for (const claimType of ["DOSING", "SAFETY"] as const)
      assert.equal(
        claimOutput({ claimType, status: "UNVERIFIED", ...LIVE }, "NONE")
          .checkRequiredBeforeSend,
        true,
      );
    assert.equal(
      claimOutput(
        { claimType: "EFFECT", status: "UNVERIFIED", ...LIVE },
        "NONE",
      ).checkRequiredBeforeSend,
      false,
    );
  });

  it("reklám: szó szerint csak független megerősítés után", () => {
    const matches = claimOutput(
      { claimType: "ADVERTISING", status: "MATCHES_MANUFACTURER", ...LIVE },
      "NONE",
    );
    assert.equal(matches.verbatimAllowed, false);
    assert.deepEqual(matches.reasons, ["ADVERTISING_NOT_CONFIRMED"]);
    const confirmed = claimOutput(
      { claimType: "ADVERTISING", status: "INDEPENDENTLY_CONFIRMED", ...LIVE },
      "NONE",
    );
    assert.equal(confirmed.verbatimAllowed, true);
  });

  it("archivált: nem írható ki, akármilyen az állapota", () => {
    const out = claimOutput(
      {
        claimType: "EFFECT",
        status: "INDEPENDENTLY_CONFIRMED",
        archivedAt: new Date(),
      },
      "NONE",
    );
    assert.equal(out.mode, "BLOCKED");
    assert.equal(out.reasons[0], "ARCHIVED");
  });

  it("megváltozott Product Knowledge tény: az ellenőrzött állítás ellenőrizetlennek számít", () => {
    const out = claimOutput(
      { claimType: "DOSING", status: "INDEPENDENTLY_CONFIRMED", ...LIVE },
      "CHANGED",
    );
    assert.equal(out.mode, "DRAFT_ONLY");
    assert.equal(out.effectiveStatus, "UNVERIFIED");
    assert.equal(out.attribution, MANUFACTURER_ATTRIBUTION);
    assert.deepEqual(out.reasons, ["KNOWLEDGE_FACT_CHANGED"]);
  });

  it("be nem kötött adagolás-állítás, a terméknek van ténye: ellenőrizetlennek számít", () => {
    const out = claimOutput(
      { claimType: "DOSING", status: "MATCHES_MANUFACTURER", ...LIVE },
      "MISSING_LINK",
    );
    assert.equal(out.mode, "DRAFT_ONLY");
    assert.deepEqual(out.reasons, ["KNOWLEDGE_FACT_NOT_LINKED"]);
  });

  it("vitatott marad vitatott, ha a tény is változott", () => {
    const out = claimOutput(
      { claimType: "DOSING", status: "DISPUTED", ...LIVE },
      "CHANGED",
    );
    assert.equal(out.mode, "BLOCKED");
    assert.deepEqual(out.reasons, ["DISPUTED", "KNOWLEDGE_FACT_CHANGED"]);
  });
});

describe("gyártói állítás: a Product Knowledge kapcsolat (3. pont)", () => {
  const dosing = {
    claimType: "DOSING" as const,
    knowledgeFactId: "teny",
    knowledgeFactRevision: 3,
  };

  it("ugyanazon a revízión: CURRENT", () => {
    assert.equal(knowledgeLinkState(dosing, { revision: 3 }, true), "CURRENT");
  });

  it("a revízió azóta nőtt: CHANGED", () => {
    assert.equal(knowledgeLinkState(dosing, { revision: 4 }, true), "CHANGED");
  });

  it("a tény eltűnt (a hivatkozás nullára állt, a revízió maradt): CHANGED", () => {
    assert.equal(
      knowledgeLinkState({ ...dosing, knowledgeFactId: null }, null, false),
      "CHANGED",
    );
  });

  it("be nem kötött adagolás-állítás: a termék ténye dönt", () => {
    const unlinked = {
      claimType: "DOSING" as const,
      knowledgeFactId: null,
      knowledgeFactRevision: null,
    };
    assert.equal(knowledgeLinkState(unlinked, null, true), "MISSING_LINK");
    assert.equal(knowledgeLinkState(unlinked, null, false), "NONE");
  });

  it("nem adagolás-állítás: a termék adagolás-ténye nem érinti", () => {
    assert.equal(
      knowledgeLinkState(
        {
          claimType: "EFFECT",
          knowledgeFactId: null,
          knowledgeFactRevision: null,
        },
        null,
        true,
      ),
      "NONE",
    );
  });
});

describe("gyártói állítás: ki ellenőrizhet (6. pont, acrobot 48148)", () => {
  const person = { id: "ember", machine: false, canApprove: false };

  it("másik ember vagy másik ágens: egyező vagy vitatott lehet", () => {
    for (const actor of [
      person,
      { id: "masik-agens", machine: true, canApprove: false },
    ])
      for (const target of ["MATCHES_MANUFACTURER", "DISPUTED"] as const)
        assert.equal(
          statusChangeRefusal({
            target,
            current: "UNVERIFIED",
            recordedById: "felvivo",
            actor,
          }),
          null,
        );
  });

  it("a felvivő nem ellenőrizheti a saját állítását", () => {
    assert.match(
      statusChangeRefusal({
        target: "MATCHES_MANUFACTURER",
        current: "UNVERIFIED",
        recordedById: "felvivo",
        actor: { id: "felvivo", machine: true, canApprove: false },
      }) ?? "",
      /nem az ellenőrizheti, aki rögzítette/,
    );
  });

  it("ismeretlen rögzítő: nem ellenőrizhető", () => {
    assert.match(
      statusChangeRefusal({
        target: "MATCHES_MANUFACTURER",
        current: "UNVERIFIED",
        recordedById: null,
        actor: person,
      }) ?? "",
      /nem azonosítható/,
    );
  });

  it("független megerősítés: csak ember, jóváhagyási joggal", () => {
    const base = {
      target: "INDEPENDENTLY_CONFIRMED" as const,
      current: "MATCHES_MANUFACTURER" as const,
      recordedById: "felvivo",
    };
    assert.match(
      statusChangeRefusal({ ...base, actor: person }) ?? "",
      /csak ember adhat/,
    );
    assert.match(
      statusChangeRefusal({
        ...base,
        actor: { id: "gep", machine: true, canApprove: true },
      }) ?? "",
      /csak ember adhat/,
    );
    assert.equal(
      statusChangeRefusal({
        ...base,
        actor: { id: "luca", machine: false, canApprove: true },
      }),
      null,
    );
  });

  it("vissza ellenőrizetlenre: a felvivő is (a biztonságos irány)", () => {
    assert.equal(
      statusChangeRefusal({
        target: "UNVERIFIED",
        current: "MATCHES_MANUFACTURER",
        recordedById: "felvivo",
        actor: { id: "felvivo", machine: true, canApprove: false },
      }),
      null,
    );
  });

  it("ugyanabba az állapotba: elutasítva", () => {
    assert.match(
      statusChangeRefusal({
        target: "DISPUTED",
        current: "DISPUTED",
        recordedById: "felvivo",
        actor: person,
      }) ?? "",
      /már ebben az állapotban/,
    );
  });
});

describe("gyártói állítás: az ellenőrzésre váró sor sorrendje (4. pont)", () => {
  it("adagolás, biztonság, aztán a többi", () => {
    const sorted = (["EFFECT", "SAFETY", "ADVERTISING", "DOSING"] as const)
      .slice()
      .sort((a, b) => reviewQueueRank(a) - reviewQueueRank(b));
    assert.deepEqual(sorted.slice(0, 2), ["DOSING", "SAFETY"]);
  });
});
