import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TICKET_MAIL_QUERY,
  describeTicketMailIntake,
  ticketMailConfig,
} from "./ticket-mail.config.js";

/**
 * THE TICKET@ INTAKE'S CONFIGURATION (card ec7b947b, S2a). WHAT TURNS RED: the intake on by default or on an unknown value; on without the
 * read-only credentials; the reader taking the SENDER's `GMAIL_TICKET_*` credentials; a default query without the time bound (switching on would
 * ingest the whole inbox); an out-of-range number accepted.
 */
const CREDS = {
  GMAIL_TICKET_READ_CLIENT_ID: "id",
  GMAIL_TICKET_READ_CLIENT_SECRET: "secret",
  GMAIL_TICKET_READ_REFRESH_TOKEN: "refresh",
};

describe("ticketMailConfig", () => {
  it("is off by default, and says why", () => {
    const c = ticketMailConfig({});
    assert.equal(c.enabled, false);
    assert.equal(c.switchReason, "NOT_SET");
    assert.match(describeTicketMailIntake(c), /disabled \(NOT_SET\)/);
  });
  it("is on only with the switch AND all three read credentials", () => {
    assert.equal(
      ticketMailConfig({ GMAIL_TICKET_INTAKE_ENABLED: "true", ...CREDS })
        .enabled,
      true,
    );
    assert.equal(
      ticketMailConfig({ GMAIL_TICKET_INTAKE_ENABLED: "TRUE ", ...CREDS })
        .enabled,
      true,
    );
    const missing = ticketMailConfig({
      GMAIL_TICKET_INTAKE_ENABLED: "true",
      GMAIL_TICKET_READ_CLIENT_ID: "id",
    });
    assert.equal(missing.enabled, false);
    assert.match(
      describeTicketMailIntake(missing),
      /missing GMAIL_TICKET_READ credentials/,
    );
  });
  it("CONTROL: an unknown or false switch value is off", () => {
    assert.equal(
      ticketMailConfig({ GMAIL_TICKET_INTAKE_ENABLED: "yes", ...CREDS })
        .enabled,
      false,
    );
    assert.equal(
      ticketMailConfig({ GMAIL_TICKET_INTAKE_ENABLED: "yes", ...CREDS })
        .switchReason,
      "UNRECOGNISED",
    );
    assert.equal(
      ticketMailConfig({ GMAIL_TICKET_INTAKE_ENABLED: "false", ...CREDS })
        .enabled,
      false,
    );
  });
  it("CONTROL: the sender's GMAIL_TICKET_* credentials are not taken as the reader's", () => {
    const c = ticketMailConfig({
      GMAIL_TICKET_INTAKE_ENABLED: "true",
      GMAIL_TICKET_CLIENT_ID: "send-id",
      GMAIL_TICKET_CLIENT_SECRET: "send-secret",
      GMAIL_TICKET_REFRESH_TOKEN: "send-refresh",
      GMAIL_TICKET_USER: "ticket@acropora.hu",
    });
    assert.equal(c.configured, false);
    assert.equal(c.enabled, false);
  });
  it("defaults: the mailbox, the time-bounded query, 10 minutes, 50 per run, 5 per hour", () => {
    const c = ticketMailConfig({});
    assert.equal(c.user, "ticket@acropora.hu");
    assert.equal(c.query, DEFAULT_TICKET_MAIL_QUERY);
    assert.match(c.query, /newer_than:\d+d/);
    assert.match(c.query, /-in:spam/);
    assert.equal(c.intervalMinutes, 10);
    assert.equal(c.maxMessagesPerRun, 50);
    assert.equal(c.unknownSenderPerHour, 5);
  });
  it("takes valid overrides and lower-cases the mailbox", () => {
    const c = ticketMailConfig({
      GMAIL_TICKET_READ_USER: "Ticket@Acropora.hu",
      GMAIL_TICKET_READ_QUERY: "in:inbox",
      TICKET_MAIL_INTERVAL_MINUTES: "30",
      TICKET_MAIL_MAX_PER_RUN: "10",
      TICKET_MAIL_UNKNOWN_SENDER_PER_HOUR: "2",
    });
    assert.equal(c.user, "ticket@acropora.hu");
    assert.equal(c.query, "in:inbox");
    assert.equal(c.intervalMinutes, 30);
    assert.equal(c.maxMessagesPerRun, 10);
    assert.equal(c.unknownSenderPerHour, 2);
  });
  it("CONTROL: out-of-range or non-numeric numbers fall back to the defaults", () => {
    const c = ticketMailConfig({
      TICKET_MAIL_INTERVAL_MINUTES: "1",
      TICKET_MAIL_MAX_PER_RUN: "100000",
      TICKET_MAIL_UNKNOWN_SENDER_PER_HOUR: "abc",
    });
    assert.equal(c.intervalMinutes, 10);
    assert.equal(c.maxMessagesPerRun, 50);
    assert.equal(c.unknownSenderPerHour, 5);
  });
});
