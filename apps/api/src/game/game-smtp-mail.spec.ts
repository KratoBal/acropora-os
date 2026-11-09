import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGameMailSender,
  gameSmtpConfig,
  gameSmtpProblems,
  parseMailFrom,
} from "./game-smtp-mail.js";

/*
  THE GIVEAWAY'S BREVO SENDER (acrobot 44556). WHAT TURNS THIS RED: the game's mail leaving without its own settings (a fall
  back to another sender); the From not being "Acropora Nyereményjáték <jatek@acropora.hu>" as configured; the Reply-To lost;
  a secret named in an answer; port 587 without STARTTLS required; the stage redirect not holding (a player mailed from
  stage), or a missing redirect setting letting a mail through.
*/
const ENV = {
  JATEK_SMTP_HOST: "smtp-relay.brevo.com",
  JATEK_SMTP_PORT: "587",
  JATEK_SMTP_USER: "login@acropora.hu",
  JATEK_SMTP_PASS: "geheim-kulcs",
  JATEK_MAIL_FROM: "Acropora Nyereményjáték <jatek@acropora.hu>",
  JATEK_MAIL_REPLY_TO: "info@acropora.hu",
  TICKET_MAIL_REDIRECT_TO: "off",
};

function transport() {
  const sent: Record<string, any>[] = [];
  const options: Record<string, any>[] = [];
  return {
    sent,
    options,
    factory: (o: Record<string, any>) => {
      options.push(o);
      return {
        sendMail: async (mail: Record<string, unknown>) => void sent.push(mail),
      };
    },
  };
}

describe("the From setting", () => {
  it("reads a name and an address, a bare address, a quoted name; nothing else", () => {
    assert.deepEqual(
      parseMailFrom("Acropora Nyereményjáték <jatek@acropora.hu>"),
      { name: "Acropora Nyereményjáték", address: "jatek@acropora.hu" },
    );
    assert.deepEqual(parseMailFrom('"Acropora Játék" <jatek@acropora.hu>'), {
      name: "Acropora Játék",
      address: "jatek@acropora.hu",
    });
    assert.deepEqual(parseMailFrom("jatek@acropora.hu"), {
      name: "",
      address: "jatek@acropora.hu",
    });
    for (const rossz of ["", "jatek", "Név <nem-cim>", "<>", "a b@x.hu"])
      assert.equal(parseMailFrom(rossz), null, rossz);
  });
});

describe("the settings", () => {
  it("name the missing or unusable ones, never a value", () => {
    assert.deepEqual(gameSmtpProblems(ENV), []);
    const { JATEK_SMTP_HOST: _h, JATEK_SMTP_PASS: _p, ...rest } = ENV;
    assert.deepEqual(gameSmtpProblems(rest), [
      "JATEK_SMTP_HOST",
      "JATEK_SMTP_PASS",
    ]);
    assert.deepEqual(gameSmtpProblems({ ...ENV, JATEK_SMTP_PORT: "abc" }), [
      "JATEK_SMTP_PORT",
    ]);
    assert.deepEqual(gameSmtpProblems({ ...ENV, JATEK_MAIL_FROM: "nem-cim" }), [
      "JATEK_MAIL_FROM",
    ]);
    assert.deepEqual(
      gameSmtpProblems({ ...ENV, JATEK_MAIL_REPLY_TO: "nem-cim" }),
      ["JATEK_MAIL_REPLY_TO"],
    );
    // the Reply-To is optional
    const { JATEK_MAIL_REPLY_TO: _r, ...withoutReply } = ENV;
    assert.deepEqual(gameSmtpProblems(withoutReply), []);
    assert.equal(gameSmtpConfig({}), null);
  });
});

describe("the game's sender", () => {
  it("sends as the configured name and address with the Reply-To, on STARTTLS at 587", async () => {
    const t = transport();
    const sender = createGameMailSender(ENV, t.factory as never)!;
    await sender.send({
      to: ["jatekos@example.com"],
      subject: "Tárgy",
      text: "szöveg",
      from: "Valaki Más <masik@example.com>",
    });
    assert.deepEqual(t.sent[0]!.from, {
      name: "Acropora Nyereményjáték",
      address: "jatek@acropora.hu",
    });
    assert.equal(t.sent[0]!.replyTo, "info@acropora.hu");
    assert.deepEqual(t.sent[0]!.to, ["jatekos@example.com"]);
    assert.equal(t.options[0]!.requireTLS, true);
    assert.equal(t.options[0]!.secure, false);
    assert.equal(t.options[0]!.host, "smtp-relay.brevo.com");
  });

  it("is null without settings: no fall back to another sender", () => {
    assert.equal(createGameMailSender({}), null);
    assert.equal(
      createGameMailSender(
        { ...ENV, JATEK_SMTP_PASS: "" },
        transport().factory as never,
      ),
      null,
    );
  });

  it("on stage the redirect holds: the mail goes to the test address, never to the player", async () => {
    const t = transport();
    const sender = createGameMailSender(
      { ...ENV, TICKET_MAIL_REDIRECT_TO: "teszt@acropora.hu" },
      t.factory as never,
    )!;
    await sender.send({
      to: ["jatekos@example.com"],
      subject: "Tárgy",
      text: "szöveg",
    });
    assert.deepEqual(t.sent[0]!.to, ["teszt@acropora.hu"]);
    assert.doesNotMatch(JSON.stringify(t.sent[0]!.to), /jatekos@example/);
  });

  it("a missing redirect setting stops the send (the gate catches it first; this is the second wall)", async () => {
    const t = transport();
    const { TICKET_MAIL_REDIRECT_TO: _x, ...unset } = ENV;
    const sender = createGameMailSender(unset, t.factory as never)!;
    await assert.rejects(
      sender.send({ to: ["jatekos@example.com"], subject: "T", text: "s" }),
    );
    assert.equal(t.sent.length, 0);
  });

  it("a failing transport throws only its code, never the key", async () => {
    const sender = createGameMailSender(ENV, (() => ({
      sendMail: async () => {
        throw Object.assign(new Error("535 geheim-kulcs rejected"), {
          code: "EAUTH",
        });
      },
    })) as never)!;
    await assert.rejects(
      sender.send({ to: ["j@example.com"], subject: "T", text: "s" }),
      (error: Error) =>
        /EAUTH/.test(error.message) && !/geheim-kulcs/.test(error.message),
    );
  });
});
