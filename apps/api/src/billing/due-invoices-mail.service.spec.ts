import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DueInvoiceItem, DueInvoicesResponse } from "@acropora/types";

import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";
import {
  DueInvoicesMailService,
  dueInvoicesDefaultFrom,
  dueInvoicesFromHeader,
  dueInvoicesMailContent,
  firstLoadOnDay,
} from "./due-invoices-mail.service.js";
import { DUE_INVOICES_PDF_FILENAME } from "./due-invoices-pdf.js";

/*
  A LEJÁRÓ SZÁMLÁK HETI LEVELE (Balázs, 2026-11-20; acrobot 58228, 58230). MI PIROSÍT: ha a levél nem a megadott címzetteknek megy (vagy
  címzett nélkül is küld, vagy ugyanaz a cím kétszer szerepel); ha a melléklet neve nem „Lejáró számlák - Utalási jegyzék.pdf”, nem PDF, vagy
  nem a lista PDF-je; ha a tárgy és a szöveg nem a listából épül (darabszám, lejárt, hátralék, az utolsó banki adat ideje); ha a „nem jött
  új banki adat” értesítés a szövegből hiányzik késői küldésnél; ha a küldő hibáját a szolgáltatás elnyeli (az ütemező akkor elküldöttnek
  jelölné); ha a levél a lista betöltése nélkül is kimegy.
*/
const item = (over: Partial<DueInvoiceItem> = {}): DueInvoiceItem => ({
  id: "row-1",
  documentNumber: "SZ-2026-7",
  supplierName: "Alfa Kft.",
  dueDate: "2026-11-25",
  overdue: false,
  daysOverdue: null,
  supplierBankAccount: "11700000-12345678-00000000",
  supplierBankAccountSource: "OWN",
  outstanding: "127000",
  currency: "HUF",
  reference: "SZ-2026-7",
  referenceIsDefault: true,
  paymentMethod: "Átutalás",
  missing: { dueDate: false, supplierBankAccount: false, paymentMethod: false },
  ...over,
});
const LIST: DueInvoicesResponse = {
  asOf: "2026-11-23",
  items: [
    item({ overdue: true, daysOverdue: 3, dueDate: "2026-11-20" }),
    item({ id: "row-2" }),
  ],
  probablyNotTransfer: [],
  summary: {
    count: 2,
    overdue: 1,
    withMissingData: 0,
    totals: [{ currency: "HUF", outstanding: "254000" }],
    probablyNotTransfer: { count: 0, totals: [] },
  },
};
const LAST_BANK = new Date("2026-11-23T07:15:00Z");

function setup(over: { fail?: boolean; list?: DueInvoicesResponse } = {}) {
  const sent: OutgoingMail[] = [];
  const loads: Date[] = [];
  const sender: MailSender = {
    send: async (mail) => {
      if (over.fail) throw new Error("A küldés nem sikerült");
      sent.push(mail);
    },
  };
  const service = new DueInvoicesMailService({} as never, {} as never, sender);
  service.loadList = async (now) => {
    loads.push(now);
    return over.list ?? LIST;
  };
  service.readLastBankData = async () => LAST_BANK;
  return { service, sent, loads };
}
const NOW = new Date("2026-11-23T08:20:00Z");

describe("the weekly due-invoices mail", () => {
  it("goes to the given recipients, once each, with the PDF named 'Lejáró számlák - Utalási jegyzék.pdf'", async () => {
    const { service, sent } = setup();
    const result = await service.send({
      recipients: ["a@acropora.hu", " b@acropora.hu ", "a@acropora.hu", ""],
      lateNotice: false,
      now: NOW,
    });
    assert.deepEqual(result, { kind: "sent", recipients: 2, count: 2 });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.to, ["a@acropora.hu", "b@acropora.hu"]);
    const [attachment] = sent[0]!.attachments!;
    assert.equal(attachment!.filename, "Lejáró számlák - Utalási jegyzék.pdf");
    assert.equal(attachment!.filename, DUE_INVOICES_PDF_FILENAME);
    assert.equal(attachment!.contentType, "application/pdf");
    assert.equal(
      Buffer.from(attachment!.bytes.subarray(0, 5)).toString("latin1"),
      "%PDF-",
    );
  });

  it("the subject and the text come from the list: count, overdue, outstanding, the last bank data, the measuring day", async () => {
    const { service, sent } = setup();
    await service.send({
      recipients: ["a@acropora.hu"],
      lateNotice: false,
      now: NOW,
    });
    assert.equal(
      sent[0]!.subject,
      "Lejáró számlák - Utalási jegyzék, 2026. 11. 23.",
    );
    const text = sent[0]!.text;
    assert.ok(text.includes("2 számla, ebből 1 lejárt"), text);
    assert.ok(text.includes("254 000 HUF"), text);
    assert.ok(text.includes("Utolsó banki adat: 2026. 11. 23. 08:15"), text);
    assert.ok(!text.includes("Ma még nem érkezett új banki adat"), text);
  });

  it("a late send says in the text that no new bank data came today", async () => {
    const { service, sent } = setup();
    await service.send({
      recipients: ["a@acropora.hu"],
      lateNotice: true,
      now: NOW,
    });
    assert.ok(sent[0]!.text.includes("Ma még nem érkezett új banki adat"));
  });

  it("the missing-data count is named in the text when there is any", () => {
    const content = dueInvoicesMailContent({
      list: { ...LIST, summary: { ...LIST.summary, withMissingData: 3 } },
      lastBankData: null,
      lateNotice: false,
    });
    assert.ok(content.text.includes("3 sorból hiányzik adat"));
    assert.ok(
      content.text.includes("Utolsó banki adat: nincs betöltött bankadat."),
    );
  });

  it("without recipients nothing is loaded and nothing is sent", async () => {
    const { service, sent, loads } = setup();
    assert.deepEqual(
      await service.send({ recipients: [], lateNotice: false }),
      {
        kind: "no-recipients",
      },
    );
    assert.deepEqual(
      await service.send({ recipients: ["  ", ""], lateNotice: false }),
      {
        kind: "no-recipients",
      },
    );
    assert.equal(sent.length, 0);
    assert.equal(loads.length, 0);
  });

  it("the list is loaded for the send time, and the sender's failure is not swallowed", async () => {
    const ok = setup();
    await ok.service.send({
      recipients: ["a@acropora.hu"],
      lateNotice: false,
      now: NOW,
    });
    assert.deepEqual(ok.loads, [NOW]);
    const failing = setup({ fail: true });
    await assert.rejects(
      failing.service.send({
        recipients: ["a@acropora.hu"],
        lateNotice: false,
        now: NOW,
      }),
      /A küldés nem sikerült/,
    );
  });
});

describe("the day's first bank load", () => {
  it("is the earliest time that falls on the Budapest day, and null when none does", () => {
    const times = [
      new Date("2026-11-23T08:01:00Z"),
      new Date("2026-11-23T07:15:00Z"),
      new Date("2026-11-22T10:00:00Z"),
    ];
    assert.deepEqual(
      firstLoadOnDay(times, "2026-11-23"),
      new Date("2026-11-23T07:15:00Z"),
    );
    assert.equal(firstLoadOnDay(times, "2026-11-24"), null);
    assert.equal(firstLoadOnDay([], "2026-11-23"), null);
  });

  it("goes by the Budapest day, not the UTC day: a load at 23:30 UTC belongs to the next day", () => {
    const late = new Date("2026-11-22T23:30:00Z");
    assert.deepEqual(firstLoadOnDay([late], "2026-11-23"), late);
    assert.equal(firstLoadOnDay([late], "2026-11-22"), null);
  });
});

describe("the sender of the weekly mail (acrobot 58274: not the ticket address)", () => {
  it("the default comes from the environment: the own variable first, then the water-measurement sender, else none", () => {
    assert.equal(
      dueInvoicesDefaultFrom({
        DUE_INVOICES_MAIL_FROM: " a@acropora.example ",
        AQUARIUM_MEASUREMENT_MAIL_FROM: "b@acropora.example",
      }),
      "a@acropora.example",
    );
    assert.equal(
      dueInvoicesDefaultFrom({
        AQUARIUM_MEASUREMENT_MAIL_FROM: "b@acropora.example",
      }),
      "b@acropora.example",
    );
    assert.equal(dueInvoicesDefaultFrom({}), null);
    assert.equal(
      dueInvoicesDefaultFrom({ DUE_INVOICES_MAIL_FROM: "  " }),
      null,
    );
  });

  it("the From header: the setting wins over the environment, a name is always paired, and with no address the sender's own default stays (undefined)", () => {
    assert.match(
      dueInvoicesFromHeader("penzugy@acropora.example", {
        DUE_INVOICES_MAIL_FROM: "info@acropora.example",
        DUE_INVOICES_MAIL_FROM_NAME: "Pénzügy",
      })!,
      /penzugy@acropora\.example/,
    );
    assert.match(
      dueInvoicesFromHeader(null, {
        DUE_INVOICES_MAIL_FROM: "info@acropora.example",
      })!,
      /info@acropora\.example/,
    );
    assert.match(
      dueInvoicesFromHeader(null, {
        DUE_INVOICES_MAIL_FROM: "info@acropora.example",
      })!,
      /Acropora/,
    );
    assert.equal(dueInvoicesFromHeader(null, {}), undefined);
  });

  it("the From header reaches the mail only when there is one", async () => {
    const withFrom = setup();
    await withFrom.service.send({
      recipients: ["a@acropora.hu"],
      lateNotice: false,
      now: NOW,
      from: "Acropora <info@acropora.example>",
    });
    assert.equal(withFrom.sent[0]!.from, "Acropora <info@acropora.example>");
    const without = setup();
    await without.service.send({
      recipients: ["a@acropora.hu"],
      lateNotice: false,
      now: NOW,
    });
    assert.equal("from" in without.sent[0]!, false);
  });
});
