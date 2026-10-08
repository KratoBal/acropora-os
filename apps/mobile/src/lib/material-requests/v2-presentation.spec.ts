import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  MaterialRequestActions,
  MaterialRequestEventEntry,
  MaterialRequestSummary,
  MaterialRequestV2Item,
} from "./types";
import {
  cancelConsequence,
  cardItemsLine,
  formatWhen,
  handlerLine,
  headerSummary,
  itemQuantity,
  itemState,
  newRequestsBanner,
  partialReceiptChanges,
  primaryAction,
  procurementSentence,
  segmentView,
  timeline,
} from "./v2-presentation";

const item = (
  over: Partial<MaterialRequestV2Item> = {},
): MaterialRequestV2Item => ({
  id: "i1",
  name: "Kitalált idom",
  quantity: "14",
  unit: "db",
  quantityValue: "14",
  receivedQuantity: null,
  receivedAt: null,
  arrived: false,
  ...over,
});

const request = (
  over: Partial<MaterialRequestSummary> = {},
): MaterialRequestSummary => ({
  id: "mr-1",
  worksheetId: "w-1",
  projectId: null,
  status: "OPEN",
  requestedByName: "Kitalált Kérő",
  createdAt: "2026-10-01T13:40:00.000Z",
  submittedAt: "2026-10-01T13:48:00.000Z",
  receivedAt: null,
  receivedByName: null,
  handlerId: null,
  handlerName: null,
  handlerAssignedAt: null,
  orderedAt: null,
  orderedByName: null,
  cancelledAt: null,
  cancelledByName: null,
  note: null,
  neededBy: null,
  priority: null,
  items: [item()],
  worksheetNumber: "TST-2026-001",
  customerDisplayName: "Teszt Ügyfél",
  departmentName: "Teszt részleg",
  context: {
    type: "WORKSHEET",
    worksheetId: "w-1",
    worksheetNumber: "TST-2026-001",
  },
  ...over,
});

const NONE: MaterialRequestActions = {
  claim: false,
  reassign: false,
  order: false,
  receiveItems: false,
  receive: false,
  cancel: false,
  comment: false,
};

// 2026-10-02 10:00 in Budapest (CEST)
const now = new Date("2026-10-02T08:00:00.000Z");

describe("anyagigény V2 a telefonon", () => {
  it("az arány csak szám-mennyiségnél, és csak amíg nem érkezett meg minden", () => {
    assert.equal(itemQuantity(item()), "14 db");
    assert.equal(itemQuantity(item({ receivedQuantity: "12" })), "12/14 db");
    assert.equal(
      itemQuantity(item({ receivedQuantity: "14", arrived: true })),
      "14 db",
    );
    assert.equal(
      itemQuantity(
        item({
          quantity: "kb 10",
          quantityValue: null,
          receivedAt: "2026-10-01T10:00:00Z",
        }),
      ),
      "kb 10 db",
    );
  });

  it("a tétel sora az állapotot mondja", () => {
    assert.equal(itemState("OPEN", item()), "Beszerzésre vár");
    assert.equal(itemState("IN_PROGRESS", item()), "Nincs megrendelve");
    assert.equal(itemState("ORDERED", item()), "Megrendelve");
    assert.equal(
      itemState("PARTIALLY_RECEIVED", item({ receivedQuantity: "12" })),
      "Részben beérkezett",
    );
    assert.equal(itemState("RECEIVED", item({ arrived: true })), "Beérkezett");
    assert.equal(itemState("CANCELLED", item()), "Visszavonva");
  });

  it("a felelős sora: Nincs felelős csak új igényen; lezártan semmi", () => {
    assert.deepEqual(handlerLine(request()), {
      text: "Nincs felelős",
      tone: "warning",
    });
    assert.deepEqual(
      handlerLine(
        request({
          status: "ORDERED",
          handlerId: "u",
          handlerName: "Kitalált Beszerző",
        }),
      ),
      { text: "Intézi: Kitalált Beszerző", tone: "accent" },
    );
    assert.equal(handlerLine(request({ status: "RECEIVED" })), null);
    assert.equal(
      handlerLine(request({ status: "CANCELLED", handlerId: "u" })),
      null,
    );
  });

  it("budapesti napok: ma, tegnap, utána dátum", () => {
    assert.equal(formatWhen("2026-10-02T06:12:00.000Z", now), "ma 08:12");
    assert.equal(formatWhen("2026-10-01T13:48:00.000Z", now), "tegnap 15:48");
    assert.match(formatWhen("2026-09-30T08:00:00.000Z", now), /^szept\. 30\.$/);
    // 23:30 in Budapest on 1 October is yesterday, though 21:30 UTC
    assert.equal(formatWhen("2026-10-01T21:30:00.000Z", now), "tegnap 23:30");
  });

  it("a kártya tételsora legfeljebb hármat mutat", () => {
    const four = request({
      items: [
        item({ id: "a", name: "A" }),
        item({
          id: "b",
          name: "B",
          quantity: "kb 10",
          unit: "m",
          quantityValue: null,
        }),
        item({ id: "c", name: "C" }),
        item({ id: "d", name: "D" }),
      ],
    });
    assert.equal(cardItemsLine(four), "A 14 db · B kb 10 m · C 14 db · +1");
  });

  it("a fejléc és a sáv a szerver számaiból; ismeretlen számnál semmi, nem nulla", () => {
    const counts = {
      open: 1,
      inProgress: 2,
      ordered: 1,
      partiallyReceived: 0,
      receivedLast7Days: 9,
    };
    assert.equal(headerSummary(counts), "4 aktív · 1 új");
    assert.equal(newRequestsBanner(counts), "1 új anyagigény vár átvételre");
    assert.equal(newRequestsBanner({ ...counts, open: 0 }), null);
    assert.equal(headerSummary(null), null);
    assert.equal(newRequestsBanner(null), null);
  });

  it("a szegmensek a szerver nézetei", () => {
    assert.equal(segmentView("active"), "active");
    assert.equal(segmentView("mine"), "mine");
    assert.equal(segmentView("received"), "received");
  });

  it("a ragadós gomb csak azt kínálja, amit a szerver enged, ebben a sorrendben", () => {
    assert.equal(primaryAction(NONE), null);
    assert.equal(
      primaryAction({ ...NONE, claim: true, cancel: true }),
      "claim",
    );
    assert.equal(
      primaryAction({ ...NONE, order: true, receive: true }),
      "order",
    );
    assert.equal(
      primaryAction({ ...NONE, receive: true, receiveItems: true }),
      "receive",
    );
    // the withdrawal and the comment are never the sticky action
    assert.equal(
      primaryAction({ ...NONE, cancel: true, comment: true, reassign: true }),
      null,
    );
  });

  it("a Beszerzés kártya mondata: vállalási jog nélkül is megmondja, ki vállalhatja", () => {
    assert.deepEqual(procurementSentence(request(), true), {
      text: "Még senki nem vállalta el.",
      tone: "warning",
    });
    assert.match(
      procurementSentence(request(), false).text,
      /beszerzési joggal/,
    );
    assert.equal(
      procurementSentence(
        request({
          status: "IN_PROGRESS",
          handlerId: "u",
          handlerName: "Kitalált Beszerző",
        }),
        false,
      ).text,
      "Intézi: Kitalált Beszerző",
    );
  });

  it("a visszavonás megerősítése megnevezi az értesítendő felelőst", () => {
    assert.match(
      cancelConsequence({ handlerId: "u", handlerName: "Kitalált Beszerző" }),
      /Kitalált Beszerző intézi; értesítést kap/,
    );
    assert.doesNotMatch(
      cancelConsequence({ handlerId: null, handlerName: null }),
      /értesítést/,
    );
  });

  it("részleges beérkezés: csak a változott tétel megy, a vessző pontra fordul", () => {
    const items = [
      item({ id: "num", receivedQuantity: "2" }),
      item({ id: "txt", quantity: "kb 10", quantityValue: null }),
      item({ id: "done", arrived: true }),
    ];
    assert.equal(partialReceiptChanges(items, { num: "2" }, {}), null);
    assert.deepEqual(partialReceiptChanges(items, { num: " 12,5 " }, {}), {
      items: [{ itemId: "num", receivedQuantity: "12.5" }],
    });
    assert.deepEqual(
      partialReceiptChanges(items, {}, { txt: true, done: true }),
      {
        items: [{ itemId: "txt", arrived: true }],
      },
    );
  });

  it("a történet a rögzített sorokból áll; a kihagyott rendelés nem jelenik meg", () => {
    const events: MaterialRequestEventEntry[] = [
      {
        id: "e1",
        kind: "SUBMITTED",
        fromStatus: "DRAFT",
        toStatus: "OPEN",
        actorName: "Kitalált Kérő",
        createdAt: "2026-10-01T13:48:00.000Z",
      },
      {
        id: "e2",
        kind: "CLAIMED",
        fromStatus: "OPEN",
        toStatus: "IN_PROGRESS",
        actorName: "Kitalált Beszerző",
        createdAt: "2026-10-01T14:03:00.000Z",
      },
    ];
    assert.deepEqual(
      timeline("IN_PROGRESS", events, now).map((s) => [
        s.label,
        s.detail,
        s.kind,
      ]),
      [
        ["Igény beküldve", "tegnap 15:48 · Kitalált Kérő", "done"],
        ["Beszerzés átvéve", "tegnap 16:03 · Kitalált Beszerző", "current"],
        ["Megrendelve", "—", "pending"],
        ["Beérkezett", "—", "pending"],
      ],
    );
    const skipped = timeline(
      "RECEIVED",
      [
        ...events,
        {
          id: "e3",
          kind: "RECEIVED",
          fromStatus: "IN_PROGRESS",
          toStatus: "RECEIVED",
          actorName: "Kitalált Beszerző",
          createdAt: "2026-10-02T06:00:00.000Z",
        },
      ],
      now,
    );
    assert.deepEqual(
      skipped.map((s) => s.label),
      ["Igény beküldve", "Beszerzés átvéve", "Beérkezett"],
    );
    assert.equal(
      timeline("CANCELLED", events, now).some((s) => s.kind === "pending"),
      false,
    );
  });
});
