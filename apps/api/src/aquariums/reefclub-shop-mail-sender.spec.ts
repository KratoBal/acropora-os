import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MailSender } from "../notifications/mail/mail.port.js";
import type { NotificationLogRepository } from "../notifications/notification-log.repository.js";
import { ReefClubAllowlistMailSender } from "../reefclub/reefclub-mail-allow.js";
import { ReefClubSmtpMailSender } from "../reefclub/reefclub-smtp-mail.js";
import { AquariumReefClubService } from "./aquarium-reefclub.service.js";
import { createReefClubShopMailSender } from "./reefclub-shop-mail-sender.js";

const SMTP = {
  REEFCLUB_SMTP_HOST: "smtp.example.test",
  REEFCLUB_SMTP_PORT: "587",
  REEFCLUB_SMTP_USER: "login@example.test",
  REEFCLUB_SMTP_PASSWORD: "not-a-real-key",
  REEFCLUB_MAIL_FROM: "reefclub@example.test",
};

describe("the shop-side ReefClub letters' sender (reefclub-c3-ertesito-proba)", () => {
  it("nothing configured on the internal API: null, so the shared sender stays (production today)", () => {
    assert.equal(createReefClubShopMailSender({}), null);
  });

  it("the ReefClub mailbox's Gmail names alone do not move the letters: the internal API takes only the SMTP route", () => {
    assert.equal(
      createReefClubShopMailSender({
        REEFCLUB_MAIL_CLIENT_ID: "id",
        REEFCLUB_MAIL_CLIENT_SECRET: "secret",
        REEFCLUB_MAIL_REFRESH_TOKEN: "token",
        REEFCLUB_MAIL_FROM: "reefclub@example.test",
      }),
      null,
    );
  });

  it("REEFCLUB_SMTP_* set: the ReefClub's own SMTP sender, the same one the ReefClub process builds", () => {
    assert.ok(
      createReefClubShopMailSender(SMTP) instanceof ReefClubSmtpMailSender,
    );
  });

  it("on the test site the allow-list gate wraps it, as in the ReefClub process", () => {
    assert.ok(
      createReefClubShopMailSender({
        ...SMTP,
        REEFCLUB_MAIL_ALLOW: "acropora.hu",
      }) instanceof ReefClubAllowlistMailSender,
    );
  });

  it("a half-set SMTP configuration stops the start, naming what is missing", () => {
    assert.throws(
      () =>
        createReefClubShopMailSender({
          REEFCLUB_SMTP_HOST: "smtp.example.test",
        }),
      /REEFCLUB_SMTP_PASSWORD/,
    );
  });
});

describe("which sender the service holds", () => {
  const log = {} as NotificationLogRepository;
  const shared: MailSender = { async send() {} };
  const reefClub: MailSender = { async send() {} };
  const held = (service: AquariumReefClubService) =>
    (service as unknown as { sender: MailSender | null }).sender;

  it("the ReefClub sender when there is one", () => {
    assert.equal(
      held(new AquariumReefClubService(log, shared, reefClub)),
      reefClub,
    );
  });

  it("the shared sender when the ReefClub one is null (unchanged behaviour)", () => {
    assert.equal(held(new AquariumReefClubService(log, shared, null)), shared);
  });

  it("no sender at all stays no sender (the code's 'not configured' branches still apply)", () => {
    assert.equal(held(new AquariumReefClubService(log, null, null)), null);
  });
});
