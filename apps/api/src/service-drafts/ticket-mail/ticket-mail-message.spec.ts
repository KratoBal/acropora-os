import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authenticationVerdict,
  cleanMailBody,
  cleanSubject,
  parseSingleAddress,
  skipReason,
} from "./ticket-mail-message.js";

/**
 * THE PURE RULES OF AN INCOMING TICKET@ MAIL (card ec7b947b, S2a).
 *
 * WHAT TURNS RED: a forged `From` believed (a bottom Authentication-Results header rescuing a failing top one, another system's authserv-id, a pass
 * for another domain); a machine's mail taken as a report (own address, no-reply, Auto-Submitted, Precedence, List-Id); a report cut wrongly (the
 * quoted reply or the signature left in, or real text cut off); a name or an address redacted in the reading copy (that is a separate, later step).
 */
const PASS =
  "mx.google.com; dkim=pass header.i=@acropora.hu header.s=g; spf=pass (google.com: domain of anna@acropora.hu designates 1.2.3.4 as permitted sender) smtp.mailfrom=anna@acropora.hu; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=acropora.hu";
const FAIL =
  "mx.google.com; dkim=fail header.i=@acropora.hu; spf=fail smtp.mailfrom=anna@acropora.hu; dmarc=fail (p=REJECT sp=REJECT dis=REJECT) header.from=acropora.hu";

describe("parseSingleAddress", () => {
  it("reads one address from a display name form, lower case", () => {
    assert.equal(
      parseSingleAddress('"Kovács Anna" <Anna.Kovacs@Acropora.hu>'),
      "anna.kovacs@acropora.hu",
    );
  });
  it("reads a bare address", () => {
    assert.equal(parseSingleAddress("anna@acropora.hu"), "anna@acropora.hu");
  });
  it("CONTROL: several addresses, none, or garbage is no sender", () => {
    assert.equal(parseSingleAddress("a@acropora.hu, b@acropora.hu"), null);
    assert.equal(parseSingleAddress("A <a@x.hu>, B <b@x.hu>"), null);
    assert.equal(parseSingleAddress("Anna"), null);
    assert.equal(parseSingleAddress(null), null);
    assert.equal(parseSingleAddress("<>"), null);
  });
});

describe("authenticationVerdict", () => {
  it("believes a Gmail header with dmarc=pass for the From domain", () => {
    assert.deepEqual(authenticationVerdict([PASS], "anna@acropora.hu"), {
      verified: true,
      reason: "DMARC_PASS",
    });
  });
  it("CONTROL: a failing top header is not rescued by a passing one the sender put below it", () => {
    assert.deepEqual(authenticationVerdict([FAIL, PASS], "anna@acropora.hu"), {
      verified: false,
      reason: "DMARC_NOT_PASS",
    });
  });
  it("CONTROL: only the topmost header counts: a passing header below an absent top is not read", () => {
    assert.equal(
      authenticationVerdict([], "anna@acropora.hu").reason,
      "NO_HEADER",
    );
  });
  it("CONTROL: another system's authserv-id is not our verdict", () => {
    const foreign = PASS.replace("mx.google.com", "mx.evil.example");
    assert.deepEqual(authenticationVerdict([foreign], "anna@acropora.hu"), {
      verified: false,
      reason: "FOREIGN_AUTHSERV",
    });
  });
  it("CONTROL: a pass for another domain than the From address is not believed", () => {
    assert.deepEqual(authenticationVerdict([PASS], "anna@masik.hu"), {
      verified: false,
      reason: "FROM_DOMAIN_MISMATCH",
    });
  });
  it("CONTROL: dmarc=none or a missing dmarc result is not a pass", () => {
    const none = PASS.replace("dmarc=pass", "dmarc=none");
    assert.equal(
      authenticationVerdict([none], "anna@acropora.hu").reason,
      "DMARC_NOT_PASS",
    );
    const missing = "mx.google.com; spf=pass smtp.mailfrom=anna@acropora.hu";
    assert.equal(
      authenticationVerdict([missing], "anna@acropora.hu").reason,
      "DMARC_NOT_PASS",
    );
  });
  it("CONTROL: no From address is no verdict", () => {
    assert.equal(authenticationVerdict([PASS], null).reason, "NO_FROM");
  });
});

describe("skipReason", () => {
  const own = "ticket@acropora.hu";
  const plain = { autoSubmitted: null, precedence: null, listId: null };
  const base = {
    fromAddress: "anna@acropora.hu",
    ownAddress: own,
    headers: plain,
  };
  it("a person's mail is not skipped", () => {
    assert.equal(skipReason(base), null);
    assert.equal(
      skipReason({ ...base, headers: { ...plain, autoSubmitted: "no" } }),
      null,
    );
  });
  it("skips each machine shape with its own reason", () => {
    assert.equal(skipReason({ ...base, fromAddress: null }), "NO_FROM");
    assert.equal(skipReason({ ...base, fromAddress: own }), "OWN_ADDRESS");
    assert.equal(
      skipReason({ ...base, fromAddress: "TICKET@acropora.hu".toLowerCase() }),
      "OWN_ADDRESS",
    );
    assert.equal(
      skipReason({ ...base, fromAddress: "no-reply@x.hu" }),
      "NO_REPLY",
    );
    assert.equal(
      skipReason({ ...base, fromAddress: "noreply@x.hu" }),
      "NO_REPLY",
    );
    assert.equal(
      skipReason({ ...base, fromAddress: "mailer-daemon@googlemail.com" }),
      "NO_REPLY",
    );
    assert.equal(
      skipReason({
        ...base,
        headers: { ...plain, autoSubmitted: "auto-replied" },
      }),
      "AUTO_SUBMITTED",
    );
    assert.equal(
      skipReason({ ...base, headers: { ...plain, precedence: "bulk" } }),
      "PRECEDENCE",
    );
    assert.equal(
      skipReason({
        ...base,
        headers: { ...plain, listId: "<list.example.com>" },
      }),
      "LIST",
    );
  });
  it("CONTROL: a local part that only contains the word is not a no-reply sender", () => {
    assert.equal(skipReason({ ...base, fromAddress: "reply.anna@x.hu" }), null);
    assert.equal(
      skipReason({ ...base, fromAddress: "anna.noreplyfan@x.hu" }),
      null,
    );
  });
});

describe("cleanSubject", () => {
  it("cuts reply and forward prefixes, also repeated, and collapses spaces", () => {
    assert.equal(cleanSubject("Re: RE: Fwd:  Szűrő   hiba"), "Szűrő hiba");
    assert.equal(cleanSubject("Válasz: VS: Tov: Lámpa"), "Lámpa");
  });
  it("keeps a subject that merely starts with those letters", () => {
    assert.equal(cleanSubject("Reaktor cső törött"), "Reaktor cső törött");
    assert.equal(cleanSubject("Fwdlámpa"), "Fwdlámpa");
  });
  it("empty or missing is null; the length is capped at 300", () => {
    assert.equal(cleanSubject("Re:  "), null);
    assert.equal(cleanSubject(null), null);
    assert.equal(cleanSubject("x".repeat(400))?.length, 300);
  });
});

describe("cleanMailBody", () => {
  it("leaves a plain report whole, names and numbers included (this is the reading copy, not a redaction)", () => {
    const body =
      "Szia!\n\nA 3-as medence szivattyúja leállt.\nKovács Anna, +36 30 123 4567";
    assert.deepEqual(cleanMailBody(body), { text: body, truncated: false });
  });
  it("cuts an English quoted reply and drops quote lines", () => {
    const body =
      "A szűrő csöpög.\n> régi sor\n\nOn Mon, 16 Nov 2026 at 10:00, Anna <anna@acropora.hu> wrote:\n> idézett\nmaradék";
    assert.equal(cleanMailBody(body).text, "A szűrő csöpög.");
  });
  it("cuts a quoted reply whose header wraps onto a second line", () => {
    const body =
      "Csöpög.\n\nOn Mon, 16 Nov 2026 at 10:00, Kovács Anna <anna@acropora.hu>\nwrote:\n> régi";
    assert.equal(cleanMailBody(body).text, "Csöpög.");
  });
  it("cuts a Hungarian quoted reply", () => {
    const body =
      "Megjött a szűrő.\n\n2026. nov. 16., H, 10:00 időpontban Anna <anna@acropora.hu> írta:\n> régi";
    assert.equal(cleanMailBody(body).text, "Megjött a szűrő.");
  });
  it("cuts an Outlook style header block and a forwarded divider", () => {
    const outlook =
      "Lásd lent.\n\nFrom: Anna <anna@acropora.hu>\nSent: Monday, November 16, 2026 10:00\nTo: ticket@acropora.hu\nrégi";
    assert.equal(cleanMailBody(outlook).text, "Lásd lent.");
    const forwarded =
      "Továbbítom.\n---------- Forwarded message ----------\nrégi";
    assert.equal(cleanMailBody(forwarded).text, "Továbbítom.");
  });
  it("cuts the signature delimiter and a phone footer", () => {
    assert.equal(
      cleanMailBody("Csöpög a cső.\n-- \nAnna\nAcropora Kft.").text,
      "Csöpög a cső.",
    );
    assert.equal(
      cleanMailBody("Csöpög a cső.\nSent from my iPhone").text,
      "Csöpög a cső.",
    );
  });
  it("CONTROL: a line that only starts with From: without a header block after it is report text", () => {
    const body = "From: a 2-es medencéből csöpög.\nÉs a 3-asból is.";
    assert.equal(cleanMailBody(body).text, body);
  });
  it("caps the length and says so", () => {
    const out = cleanMailBody("a".repeat(5000), 4000);
    assert.equal(out.text.length, 4000);
    assert.equal(out.truncated, true);
  });
  it("collapses runs of blank lines and normalizes CRLF", () => {
    assert.equal(
      cleanMailBody("egy\r\n\r\n\r\n\r\nkettő").text,
      "egy\n\nkettő",
    );
  });
});
