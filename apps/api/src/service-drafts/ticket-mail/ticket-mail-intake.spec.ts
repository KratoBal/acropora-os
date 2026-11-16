import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  announcesArrival,
  decideIntake,
  draftContentOf,
  EMPTY_BODY_TEXT,
  NO_SUBJECT_TITLE,
  withoutNul,
  type ResolvedSender,
} from "./ticket-mail-intake.js";

/**
 * WHAT BECOMES OF AN INCOMING TICKET@ MAIL (card ec7b947b, S2b).
 *
 * WHAT TURNS RED: a forged sender (the From of a switched-on colleague without a believable header) getting that colleague's name, place or the
 * AI branch; a switched-off colleague getting a place or the AI branch; a machine's mail becoming a draft; an unknown sender over the hourly guard
 * still listed; several assigned places guessed as one; the report day taken in UTC instead of Budapest.
 */
const colleague = (
  overrides: Partial<ResolvedSender> = {},
): ResolvedSender => ({
  userId: "user-1",
  displayName: "Kovács Anna",
  watching: true,
  departmentIds: ["dep-1"],
  ...overrides,
});
const base = {
  skip: null,
  verified: true,
  sender: colleague(),
  recentFromSender: 0,
  unknownSenderPerHour: 5,
  recentUnknownTotal: 0,
  unknownTotalPerHour: 30,
} as const;

describe("decideIntake", () => {
  it("a verified switched-on colleague: the AI branch, their name and their one place", () => {
    assert.deepEqual(decideIntake(base), {
      kind: "DRAFT",
      intakeState: "AI_UNAVAILABLE",
      senderUserId: "user-1",
      reporterPersonName: "Kovács Anna",
      proposedDepartmentId: "dep-1",
    });
  });

  it("several assigned places: none is guessed (the manager chooses); no place: none", () => {
    const several = decideIntake({
      ...base,
      sender: colleague({ departmentIds: ["dep-1", "dep-2"] }),
    });
    const none = decideIntake({
      ...base,
      sender: colleague({ departmentIds: [] }),
    });
    for (const outcome of [several, none]) {
      assert.equal(outcome.kind, "DRAFT");
      assert.equal(
        outcome.kind === "DRAFT" && outcome.proposedDepartmentId,
        null,
      );
    }
  });

  it("a verified switched-off colleague: WATCH_OFF, their name, NO place and no AI branch", () => {
    assert.deepEqual(
      decideIntake({ ...base, sender: colleague({ watching: false }) }),
      {
        kind: "DRAFT",
        intakeState: "WATCH_OFF",
        senderUserId: "user-1",
        reporterPersonName: "Kovács Anna",
        proposedDepartmentId: null,
      },
    );
  });

  it("CONTROL (forged sender): a sender whose From was not believed is an unknown sender, with no name, no user and no place, even if a record is passed", () => {
    assert.deepEqual(decideIntake({ ...base, verified: false }), {
      kind: "DRAFT",
      intakeState: "UNKNOWN_SENDER",
      senderUserId: null,
      reporterPersonName: null,
      proposedDepartmentId: null,
    });
  });

  it("an address that is no user: an unknown sender", () => {
    const outcome = decideIntake({ ...base, sender: null });
    assert.equal(
      outcome.kind === "DRAFT" && outcome.intakeState,
      "UNKNOWN_SENDER",
    );
  });

  it("CONTROL: a machine's mail is skipped, whoever the sender is", () => {
    assert.deepEqual(decideIntake({ ...base, skip: "AUTO_SUBMITTED" }), {
      kind: "SKIP",
      reason: "AUTO_SUBMITTED",
    });
  });

  it("an unknown sender is listed up to the hourly guard and capped from it on", () => {
    const unknown = { ...base, verified: false, unknownSenderPerHour: 5 };
    assert.equal(
      decideIntake({ ...unknown, recentFromSender: 4 }).kind,
      "DRAFT",
    );
    assert.equal(
      decideIntake({ ...unknown, recentFromSender: 5 }).kind,
      "CAPPED",
    );
    assert.equal(
      decideIntake({ ...unknown, recentFromSender: 50 }).kind,
      "CAPPED",
    );
  });

  it("an unknown sender is capped by the mailbox-wide total too, however few mails their own address left", () => {
    const unknown = {
      ...base,
      verified: false,
      recentFromSender: 0,
      unknownTotalPerHour: 30,
    };
    assert.equal(
      decideIntake({ ...unknown, recentUnknownTotal: 29 }).kind,
      "DRAFT",
    );
    assert.equal(
      decideIntake({ ...unknown, recentUnknownTotal: 30 }).kind,
      "CAPPED",
    );
  });

  it("CONTROL: a known colleague is never capped (the guard is for unknown senders)", () => {
    assert.equal(
      decideIntake({ ...base, recentFromSender: 500, recentUnknownTotal: 500 })
        .kind,
      "DRAFT",
    );
  });
});

describe("draftContentOf", () => {
  const message = (overrides: object = {}) => ({
    id: "gmail-1",
    subject: "Re: Szűrő hiba",
    text: "A szűrő csöpög.\n-- \nAnna",
    receivedAt: new Date("2026-11-16T12:00:00.000Z"),
    ...overrides,
  });

  it("the title is the subject without the reply prefix; the text is the report text", () => {
    const content = draftContentOf(message());
    assert.equal(content.title, "Szűrő hiba");
    assert.equal(content.originalProblem, "A szűrő csöpög.");
  });

  it("without a subject the title is the first line of the text; without either, fixed words", () => {
    assert.equal(
      draftContentOf(message({ subject: null })).title,
      "A szűrő csöpög.",
    );
    const bare = draftContentOf(message({ subject: "Re:", text: "" }));
    assert.equal(bare.title, NO_SUBJECT_TITLE);
    assert.equal(bare.originalProblem, EMPTY_BODY_TEXT);
  });

  it("the report day is the BUDAPEST day: 23:30 UTC in winter is already the next day", () => {
    const content = draftContentOf(
      message({ receivedAt: new Date("2026-11-16T23:30:00.000Z") }),
    );
    assert.equal(content.reportDate.toISOString(), "2026-11-17T00:00:00.000Z");
    const noon = draftContentOf(message());
    assert.equal(noon.reportDate.toISOString(), "2026-11-16T00:00:00.000Z");
  });

  it("the fingerprint is one digest per message id", () => {
    const a = draftContentOf(message({ id: "gmail-1" })).fingerprint;
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(draftContentOf(message({ id: "gmail-1" })).fingerprint, a);
    assert.notEqual(draftContentOf(message({ id: "gmail-2" })).fingerprint, a);
  });
});

describe("announcesArrival", () => {
  it("only the drafts of a switched-on colleague announce themselves", () => {
    assert.equal(announcesArrival("AI_DRAFT"), true);
    assert.equal(announcesArrival("AI_UNAVAILABLE"), true);
  });
  it("CONTROL: a switched-off colleague's, an unknown sender's and a rule-based draft send nothing", () => {
    for (const state of ["WATCH_OFF", "UNKNOWN_SENDER", "RULE_DRAFT"] as const)
      assert.equal(announcesArrival(state), false, state);
  });
});

describe("withoutNul (barracuda, #2646: PostgreSQL's text refuses 0x00)", () => {
  it("removes every NUL character and nothing else", () => {
    assert.equal(withoutNul("a\u0000b\u0000\u0000c"), "abc");
    assert.equal(withoutNul("Szűrő csöpög\n"), "Szűrő csöpög\n");
    assert.equal(withoutNul(null), null);
  });
  it("the draft's own fields carry no NUL, whichever field the sender put it in", () => {
    const content = draftContentOf({
      id: "gmail-nul",
      subject: "Hiba\u0000 a szűrőn",
      text: "A szűrő\u0000 csöpög.\u0000",
      receivedAt: new Date("2026-11-16T12:00:00.000Z"),
    });
    assert.equal(content.title, "Hiba a szűrőn");
    assert.equal(content.originalProblem, "A szűrő csöpög.");
    for (const value of [content.title, content.originalProblem])
      assert.equal(value.includes("\u0000"), false);
  });
});
