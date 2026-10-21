import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GmailMailSender } from "../notifications/mail/gmail-mail.sender.js";
import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";
import type { ReefClubAccountRepository } from "./reefclub-account.repository.js";
import { ReefClubAuthService } from "./reefclub-auth.service.js";
import { createReefClubMailSender } from "./reefclub-mail.js";
import {
  ReefClubAllowlistMailSender,
  reefClubMailAllow,
  reefClubMailAllowed,
} from "./reefclub-mail-allow.js";
import type { ReefClubSessionRepository } from "./reefclub-session.repository.js";
import { ReefClubSmtpMailSender } from "./reefclub-smtp-mail.js";

/**
 * THE TEST SITE'S MAIL GATE (acrobot 34165, task reefclub-teszt-level-kapu).
 * What must fail: a mail to an unlisted address going out on the test site; a
 * listed domain matching a look-alike or a subdomain; a typo in the value
 * opening the gate; the dropped address written to the log; a registration
 * failing because its mail was held back; and, the other way, the gate being
 * on without the variable (production must send as before).
 */
const mail = (
  to: string[],
  extra: Partial<OutgoingMail> = {},
): OutgoingMail => ({
  to,
  subject: "Erősítsd meg az e-mail címed",
  text: "x",
  ...extra,
});

function recording() {
  const sent: OutgoingMail[] = [];
  const sender: MailSender = {
    async send(m) {
      sent.push(m);
    },
  };
  return { sent, sender };
}

function gate(value: string) {
  const allow = reefClubMailAllow({ REEFCLUB_MAIL_ALLOW: value });
  assert.equal(allow.kind, "on");
  const inner = recording();
  const warnings: string[] = [];
  const sender = new ReefClubAllowlistMailSender(
    inner.sender,
    allow as Extract<typeof allow, { kind: "on" }>,
    { warn: (m: unknown) => void warnings.push(String(m)) },
  );
  return { sender, sent: inner.sent, warnings };
}

describe("REEFCLUB_MAIL_ALLOW: the value", () => {
  it("unset or blank is off, and every address may get a mail (the production state)", () => {
    for (const env of [
      {},
      { REEFCLUB_MAIL_ALLOW: "" },
      { REEFCLUB_MAIL_ALLOW: "   " },
    ]) {
      const allow = reefClubMailAllow(env);
      assert.equal(allow.kind, "off");
      assert.equal(reefClubMailAllowed(allow, "anybody@example.com"), true);
    }
  });

  it("a domain matches exactly; an address matches itself; case and spaces do not matter", () => {
    const allow = reefClubMailAllow({
      REEFCLUB_MAIL_ALLOW: " Acropora.HU , Tester@Example.com ",
    });
    assert.equal(reefClubMailAllowed(allow, "info@acropora.hu"), true);
    assert.equal(reefClubMailAllowed(allow, " Balazs@ACROPORA.hu "), true);
    assert.equal(reefClubMailAllowed(allow, "tester@example.com"), true);
    assert.equal(reefClubMailAllowed(allow, "other@example.com"), false);
    assert.equal(reefClubMailAllowed(allow, "x@evil-acropora.hu"), false);
    assert.equal(reefClubMailAllowed(allow, "x@mail.acropora.hu"), false);
    assert.equal(reefClubMailAllowed(allow, "x@acropora.hu.evil.com"), false);
    assert.equal(reefClubMailAllowed(allow, "acropora.hu"), false);
  });

  it("an @domain entry is a domain too", () => {
    const allow = reefClubMailAllow({ REEFCLUB_MAIL_ALLOW: "@acropora.hu" });
    assert.equal(reefClubMailAllowed(allow, "info@acropora.hu"), true);
  });

  it("a value that lists nothing usable blocks every address, it does not open the gate", () => {
    for (const value of ["acropora", "*", "@", "foo bar@acropora.hu", ","]) {
      const allow = reefClubMailAllow({ REEFCLUB_MAIL_ALLOW: value });
      assert.equal(allow.kind, "on", value);
      assert.equal(
        reefClubMailAllowed(allow, "info@acropora.hu"),
        false,
        value,
      );
    }
  });
});

describe("the gate on the sender", () => {
  it("a listed recipient gets the mail unchanged", async () => {
    const g = gate("acropora.hu");
    await g.sender.send(mail(["info@acropora.hu"]));
    assert.deepEqual(
      g.sent.map((m) => m.to),
      [["info@acropora.hu"]],
    );
    assert.deepEqual(g.warnings, []);
  });

  it("an unlisted recipient gets nothing; the log counts it and does not name it", async () => {
    const g = gate("acropora.hu");
    await g.sender.send(mail(["valodi.vevo@gmail.com"]));
    assert.deepEqual(g.sent, []);
    assert.equal(g.warnings.length, 1);
    assert.match(
      g.warnings[0]!,
      /1 címzettje nincs a REEFCLUB_MAIL_ALLOW listáján/,
    );
    assert.doesNotMatch(g.warnings[0]!, /valodi|gmail/);
  });

  it("a mixed list keeps only the listed recipients, cc and bcc included", async () => {
    const g = gate("acropora.hu");
    await g.sender.send(
      mail(["info@acropora.hu", "x@gmail.com"], {
        cc: ["y@gmail.com", "luca@acropora.hu"],
        bcc: ["z@gmail.com"],
      }),
    );
    assert.deepEqual(
      g.sent.map((m) => [m.to, m.cc, m.bcc]),
      [[["info@acropora.hu"], ["luca@acropora.hu"], []]],
    );
    assert.match(g.warnings[0]!, /3 címzettje/);
  });

  it("the factory wraps only when the variable is set (production: the sender as it is)", () => {
    const smtp = {
      REEFCLUB_SMTP_HOST: "smtp.example.test",
      REEFCLUB_SMTP_PORT: "587",
      REEFCLUB_SMTP_USER: "login@example.test",
      REEFCLUB_SMTP_PASSWORD: "not-a-real-key",
      REEFCLUB_MAIL_FROM: "reefclub@example.test",
    };
    assert.ok(createReefClubMailSender(smtp) instanceof ReefClubSmtpMailSender);
    assert.ok(createReefClubMailSender({}) instanceof GmailMailSender);
    assert.ok(
      createReefClubMailSender({
        ...smtp,
        REEFCLUB_MAIL_ALLOW: "acropora.hu",
      }) instanceof ReefClubAllowlistMailSender,
    );
    assert.ok(
      createReefClubMailSender({
        REEFCLUB_MAIL_ALLOW: "acropora.hu",
      }) instanceof ReefClubAllowlistMailSender,
    );
  });
});

describe("a registration behind the gate", () => {
  it("the account is created and the call returns as before; only the mail stays behind", async () => {
    const created: string[] = [];
    const accounts = {
      async findByEmail() {
        return null;
      },
      async findById() {
        return null;
      },
      async createUnverified(input: { email: string }) {
        created.push(input.email);
        return "acc-1";
      },
    };
    const g = gate("acropora.hu");
    const svc = new ReefClubAuthService(
      accounts as unknown as ReefClubAccountRepository,
      {} as unknown as ReefClubSessionRepository,
      g.sender,
    );
    svc.register("kulso@gmail.com", "helyes jelszo 123", "v1");
    await svc.settled();
    assert.deepEqual(created, ["kulso@gmail.com"]);
    assert.deepEqual(g.sent, []);
    assert.equal(g.warnings.length, 1);
  });
});
