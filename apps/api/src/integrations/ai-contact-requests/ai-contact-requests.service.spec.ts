import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  AI_CHAT_SETTINGS_DEFAULTS,
  type AiChatSettings,
  type AiContactRequestInput,
  type AiContactRequestView,
  type AuthenticatedUser,
} from "@acropora/types";

import type {
  MailSender,
  OutgoingMail,
} from "../../notifications/mail/mail.port.js";
import type { AiChatSettingsService } from "../ai-chat-settings/ai-chat-settings.service.js";
import type { AiContactRequestsRepository } from "./ai-contact-requests.repository.js";
import {
  AiContactRequestsService,
  mailText,
} from "./ai-contact-requests.service.js";

/**
 * THE HAND-OVER OF A CONTACT REQUEST (card f5b8f7ba, slice 4c). MI PIROSÍT: ha egy kikapcsolt vagy címzett nélküli funkcióra tárolás
 * indul; ha egy hibás alakú kérésből rekord lesz; ha ugyanaz az üzenet két rekordot vagy két levelet ad; ha egy elbukott levél a
 * rekordot is elviszi, vagy a válasz kézbesítettnek mondja; ha az elérhetőség a tárgyba vagy a naplóba kerül; ha egy második
 * "kezelve" átírja az elsőt.
 */
const RECIPIENT = "ugyfelszolgalat@acropora.test";
const VALUE = "06301234567";
const enabled: AiChatSettings = {
  ...AI_CHAT_SETTINGS_DEFAULTS,
  contactRequestEnabled: true,
  contactRecipientEmail: RECIPIENT,
};
const body: AiContactRequestInput = {
  channel: "PHONE",
  value: VALUE,
  conversationRef: "conv-1",
  requestKey: "msg-1",
};
const admin = { id: "user-1" } as unknown as AuthenticatedUser;

function setup(settings: AiChatSettings = enabled, mailFails = false) {
  const rows = new Map<string, AiContactRequestView & { requestKey: string }>();
  const log: string[] = [];
  const mails: OutgoingMail[] = [];
  const repository = {
    store: async (input: AiContactRequestInput) => {
      const same = [...rows.values()].find(
        (row) => row.requestKey === input.requestKey,
      );
      if (same)
        return {
          id: same.id,
          created: false,
          notified: same.notifiedAt !== null,
        };
      const id = `req-${rows.size + 1}`;
      rows.set(id, {
        id,
        channel: input.channel,
        value: input.value,
        conversationRef: input.conversationRef,
        requestKey: input.requestKey,
        createdAt: "2026-11-11T11:00:00.000Z",
        notifiedAt: null,
        handledAt: null,
      });
      return { id, created: true, notified: false };
    },
    find: async (id: string) => rows.get(id) ?? null,
    markNotified: async (id: string) => {
      const row = rows.get(id)!;
      row.notifiedAt ??= "2026-11-11T11:00:01.000Z";
    },
    list: async (limit: number) => [...rows.values()].slice(0, limit),
    markHandled: async (id: string) => {
      const row = rows.get(id);
      if (!row || row.handledAt) return null;
      row.handledAt = "2026-11-11T12:00:00.000Z";
      return row;
    },
  } as unknown as AiContactRequestsRepository;
  const mail: MailSender = {
    send: async (outgoing) => {
      if (mailFails)
        throw Object.assign(new Error(`SMTP refused ${VALUE}`), {
          name: "MailError",
        });
      mails.push(outgoing);
    },
  };
  const service = new AiContactRequestsService(
    repository,
    { settings: async () => settings } as unknown as AiChatSettingsService,
    mail,
  );
  (service as unknown as { logger: object }).logger = {
    log: (line: string) => log.push(line),
    warn: (line: string) => log.push(line),
  };
  return { service, rows, mails, log };
}

describe("AiContactRequestsService.receive", () => {
  it("stores the request, mails the configured recipient once, and answers recorded and notified", async () => {
    const w = setup();
    const receipt = await w.service.receive(body);
    assert.deepEqual(receipt, {
      id: "req-1",
      recorded: true,
      duplicate: false,
      notified: true,
    });
    assert.equal(w.rows.size, 1);
    assert.equal(w.mails.length, 1);
    assert.deepEqual(w.mails[0]!.to, [RECIPIENT]);
    assert.ok(w.rows.get("req-1")!.notifiedAt);
  });

  it("the subject carries no contact value; the body does (the recipient has to call or write to it)", async () => {
    const w = setup();
    await w.service.receive(body);
    assert.ok(!w.mails[0]!.subject.includes(VALUE));
    assert.ok(w.mails[0]!.text.includes(VALUE));
    assert.ok(w.mails[0]!.text.includes("telefonszám"));
  });

  it("refuses when the contact request is switched off or has no recipient, and stores nothing", async () => {
    for (const settings of [
      AI_CHAT_SETTINGS_DEFAULTS,
      { ...enabled, contactRequestEnabled: false },
      { ...enabled, contactRecipientEmail: null },
    ]) {
      const w = setup(settings);
      await assert.rejects(w.service.receive(body), ConflictException);
      assert.equal(w.rows.size, 0);
      assert.equal(w.mails.length, 0);
    }
  });

  it("refuses a bad body (not a contact, wrong channel, bad references) and stores nothing", async () => {
    const w = setup();
    for (const bad of [
      { ...body, value: "123456" },
      { ...body, channel: "SMS" },
      { ...body, requestKey: "" },
      { ...body, conversationRef: "a b" },
      null,
      "text",
    ])
      await assert.rejects(w.service.receive(bad), BadRequestException);
    assert.equal(w.rows.size, 0);
    assert.equal(w.mails.length, 0);
  });

  it("a failed e-mail does NOT undo the record: the answer says recorded and not notified, and the log holds neither the value nor the error text", async () => {
    const w = setup(enabled, true);
    const receipt = await w.service.receive(body);
    assert.deepEqual(receipt, {
      id: "req-1",
      recorded: true,
      duplicate: false,
      notified: false,
    });
    assert.equal(w.rows.size, 1);
    assert.equal(w.rows.get("req-1")!.notifiedAt, null);
    assert.ok(
      w.log.some((line) => line.includes("contact_request_mail_failed")),
    );
    assert.ok(w.log.every((line) => !line.includes(VALUE)));
    assert.ok(w.log.every((line) => !line.includes("SMTP refused")));
  });

  it("the same message handed over again is one request and one mail; if the first mail never went out, the repeat sends it", async () => {
    const w = setup();
    await w.service.receive(body);
    const again = await w.service.receive(body);
    assert.deepEqual(again, {
      id: "req-1",
      recorded: true,
      duplicate: true,
      notified: true,
    });
    assert.equal(w.rows.size, 1);
    assert.equal(w.mails.length, 1);

    const failing = setup(enabled, true);
    await failing.service.receive(body);
    // the mail system recovers: the repeat of the same hand-over notifies now
    (failing.service as unknown as { mail: MailSender }).mail = {
      send: async (outgoing) => {
        failing.mails.push(outgoing);
      },
    };
    const retry = await failing.service.receive(body);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.notified, true);
    assert.equal(failing.rows.size, 1);
    assert.equal(failing.mails.length, 1);
  });

  it("the log line names the id, the channel and the outcome, never the value", async () => {
    const w = setup();
    await w.service.receive(body);
    assert.ok(
      w.log.some((line) =>
        line.includes("contact_request id=req-1 channel=PHONE"),
      ),
    );
    assert.ok(w.log.every((line) => !line.includes(VALUE)));
  });
});

describe("AiContactRequestsService handled and list", () => {
  it("marks a request handled once; a second mark and an unknown id are 404", async () => {
    const w = setup();
    await w.service.receive(body);
    const view = await w.service.handled("req-1", admin);
    assert.ok(view.handledAt);
    await assert.rejects(w.service.handled("req-1", admin), NotFoundException);
    await assert.rejects(w.service.handled("nope", admin), NotFoundException);
  });

  it("clamps the list size: garbage and zero read as the default, and the cap holds", async () => {
    const w = setup();
    for (let i = 0; i < 3; i += 1)
      await w.service.receive({ ...body, requestKey: `msg-${i}` });
    assert.equal((await w.service.list(Number.NaN)).length, 3);
    assert.equal((await w.service.list(0)).length, 3);
    assert.equal((await w.service.list(2)).length, 2);
    assert.equal((await w.service.list(10_000)).length, 3);
  });
});

describe("mailText", () => {
  it("shows the channel, the value, the Budapest time, both references and no dash", () => {
    const text = mailText({
      id: "req-9",
      channel: "EMAIL",
      value: "vasarlo@example.hu",
      conversationRef: "conv-9",
      createdAt: "2026-11-11T11:00:00.000Z",
      notifiedAt: null,
      handledAt: null,
    });
    assert.match(text, /Elérhetőség \(e-mail cím\): vasarlo@example\.hu/);
    assert.match(text, /Beérkezett: .*12:00/);
    assert.match(text, /conv-9/);
    assert.match(text, /req-9/);
    assert.ok(!text.includes("—") && !text.includes(" -- "));
  });
});
