import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GmailMailSender } from "../notifications/mail/gmail-mail.sender.js";
import { assertReefClubEnvironment } from "./reefclub-environment.js";
import { createReefClubMailSender } from "./reefclub-mail.js";
import {
  assertReefClubSmtpComplete,
  ReefClubMailSendError,
  reefClubSmtpConfig,
  reefClubSmtpProblems,
  reefClubSmtpRequested,
  ReefClubSmtpMailSender,
  reefClubSmtpTransportOptions,
  type SmtpTransport,
} from "./reefclub-smtp-mail.js";

/**
 * THE REEFCLUB'S SMTP SENDER (Brevo). What must fail: a half-set configuration
 * starting the process, or being named by a value; the SMTP key in an error
 * message or a log line; port 587 without a required STARTTLS (a plain-text
 * fallback); the Gmail sender chosen although SMTP is set (or the reverse);
 * a caller choosing the identity the public process sends as.
 */
const SECRET = "not-a-real-smtp-key";
const FULL = {
  REEFCLUB_SMTP_HOST: "smtp.example.test",
  REEFCLUB_SMTP_PORT: "587",
  REEFCLUB_SMTP_USER: "login@example.test",
  REEFCLUB_SMTP_PASSWORD: SECRET,
  REEFCLUB_MAIL_FROM: "reefclub@example.test",
};

describe("the configuration", () => {
  it("reads the five names and the optional display name", () => {
    assert.deepEqual(reefClubSmtpConfig(FULL), {
      host: "smtp.example.test",
      port: 587,
      user: "login@example.test",
      password: SECRET,
      from: "reefclub@example.test",
      fromName: "Acropora ReefClub",
    });
    assert.equal(
      reefClubSmtpConfig({ ...FULL, REEFCLUB_MAIL_FROM_NAME: " Saját név " })
        .fromName,
      "Saját név",
    );
  });

  it("names every missing or unusable one, in one message, and never a value", () => {
    assert.deepEqual(reefClubSmtpProblems({}), [
      "REEFCLUB_SMTP_HOST",
      "REEFCLUB_SMTP_PORT",
      "REEFCLUB_SMTP_USER",
      "REEFCLUB_SMTP_PASSWORD",
      "REEFCLUB_MAIL_FROM",
    ]);
    assert.deepEqual(
      reefClubSmtpProblems({ ...FULL, REEFCLUB_SMTP_PASSWORD: " " }),
      ["REEFCLUB_SMTP_PASSWORD"],
    );
    assert.deepEqual(
      reefClubSmtpProblems({ ...FULL, REEFCLUB_SMTP_PORT: "levél" }),
      ["REEFCLUB_SMTP_PORT"],
    );
    assert.deepEqual(
      reefClubSmtpProblems({ ...FULL, REEFCLUB_SMTP_PORT: "70000" }),
      ["REEFCLUB_SMTP_PORT"],
    );
    assert.throws(
      () => reefClubSmtpConfig({ ...FULL, REEFCLUB_SMTP_HOST: "" }),
      (error: Error) => {
        assert.match(error.message, /REEFCLUB_SMTP_HOST\.$/);
        assert.ok(!error.message.includes(SECRET));
        return true;
      },
    );
  });
});

describe("the transport options", () => {
  it("587 requires STARTTLS and is not TLS from the start; 465 is TLS from the start", () => {
    const a = reefClubSmtpTransportOptions(reefClubSmtpConfig(FULL));
    assert.equal(a.secure, false);
    assert.equal(a.requireTLS, true);
    assert.deepEqual(a.auth, { user: "login@example.test", pass: SECRET });
    const b = reefClubSmtpTransportOptions(
      reefClubSmtpConfig({ ...FULL, REEFCLUB_SMTP_PORT: "465" }),
    );
    assert.equal(b.secure, true);
    assert.equal(b.requireTLS, false);
  });
});

function senderWith(transport: SmtpTransport) {
  return new ReefClubSmtpMailSender(reefClubSmtpConfig(FULL), () => transport);
}

describe("sending", () => {
  it("maps the mail, with the configured identity, and ignores a from the caller gives", async () => {
    const sent: Record<string, unknown>[] = [];
    await senderWith({
      sendMail: async (options) => void sent.push(options),
    }).send({
      to: ["kovacs@example.test"],
      cc: ["masolat@example.test"],
      subject: "Erősítsd meg",
      text: "Szöveg",
      html: "<p>Szöveg</p>",
      from: "mas@evil.example",
      attachments: [
        {
          filename: "a.txt",
          contentType: "text/plain",
          bytes: new Uint8Array([104, 105]),
        },
      ],
    });
    assert.equal(sent.length, 1);
    const options = sent[0]!;
    assert.deepEqual(options.from, {
      name: "Acropora ReefClub",
      address: "reefclub@example.test",
    });
    assert.deepEqual(options.to, ["kovacs@example.test"]);
    assert.deepEqual(options.cc, ["masolat@example.test"]);
    assert.equal(options.bcc, undefined);
    assert.equal(options.subject, "Erősítsd meg");
    assert.equal(options.text, "Szöveg");
    assert.equal(options.html, "<p>Szöveg</p>");
    const attachment = (
      options.attachments as { content: Buffer; filename: string }[]
    )[0]!;
    assert.equal(attachment.filename, "a.txt");
    assert.equal(attachment.content.toString(), "hi");
  });

  it("a failed send throws the code only: nothing of the original message, the SMTP key never reaches a log", async () => {
    const failing = senderWith({
      sendMail: async () => {
        throw Object.assign(
          new Error(`535 5.7.8 Authentication failed for key ${SECRET}`),
          {
            code: "EAUTH",
          },
        );
      },
    });
    await assert.rejects(
      () => failing.send({ to: ["a@example.test"], subject: "s", text: "t" }),
      (error: Error) => {
        assert.ok(error instanceof ReefClubMailSendError);
        assert.equal((error as ReefClubMailSendError).code, "EAUTH");
        assert.ok(!error.message.includes(SECRET));
        assert.ok(!String(error.stack).includes(SECRET));
        return true;
      },
    );
    // an error without a usable code is "UNKNOWN", not the error's own words
    const odd = senderWith({
      sendMail: async () => {
        throw new Error(`boom ${SECRET}`);
      },
    });
    await assert.rejects(
      () => odd.send({ to: ["a@example.test"], subject: "s", text: "t" }),
      (error: Error) =>
        /UNKNOWN/.test(error.message) && !error.message.includes(SECRET),
    );
  });
});

describe("choosing the sender and the start guard", () => {
  it("SMTP as soon as any REEFCLUB_SMTP_ name has a value; otherwise Gmail, as before", () => {
    assert.equal(reefClubSmtpRequested({}), false);
    assert.equal(
      reefClubSmtpRequested({ REEFCLUB_MAIL_FROM: "x@example.test" }),
      false,
    );
    assert.equal(reefClubSmtpRequested({ REEFCLUB_SMTP_HOST: "  " }), false);
    assert.equal(reefClubSmtpRequested({ REEFCLUB_SMTP_HOST: "h" }), true);
    assert.ok(createReefClubMailSender(FULL) instanceof ReefClubSmtpMailSender);
    assert.ok(
      createReefClubMailSender({
        REEFCLUB_MAIL_FROM: "x@example.test",
      }) instanceof GmailMailSender,
    );
    assert.ok(createReefClubMailSender({}) instanceof GmailMailSender);
  });

  it("a half-set SMTP configuration stops the start, naming the missing names; a complete or absent one passes", () => {
    assert.throws(
      () =>
        assertReefClubEnvironment({ REEFCLUB_SMTP_HOST: "smtp.example.test" }),
      (error: Error) => {
        assert.match(
          error.message,
          /REEFCLUB_SMTP_PORT, REEFCLUB_SMTP_USER, REEFCLUB_SMTP_PASSWORD, REEFCLUB_MAIL_FROM\./,
        );
        assert.ok(!error.message.includes("smtp.example.test"));
        return true;
      },
    );
    assert.doesNotThrow(() => assertReefClubSmtpComplete(FULL));
    assert.doesNotThrow(() => assertReefClubSmtpComplete({}));
    // the SMTP key sits under the REEFCLUB_ prefix: the environment guard lets it in
    assert.doesNotThrow(() => assertReefClubEnvironment(FULL));
  });
});
