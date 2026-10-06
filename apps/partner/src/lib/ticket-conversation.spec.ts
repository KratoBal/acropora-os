import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PartnerConversationMessage } from "@acropora/types";

import {
  authorLine,
  mergeConversation,
  newClientMessageId,
  sendableText,
} from "./ticket-conversation.js";

/*
  A HIBAJEGY BESZÉLGETÉSE A PORTÁLON (kártya 084e2c24). MI PIROSÍT:
  - egy üzenet kétszer jelenik meg (frissítés és küldés válasza), vagy nem
    időrendben, vagy a szerkesztett szöveg nem frissül;
  - üres vagy túl hosszú szöveg küldhetőnek látszik;
  - az újraküldés azonosítója nem fér a szerver korlátjába (8-64), vagy két
    üzenet ugyanazt kapja;
  - a szerző sora nem mondja meg, ki írta (Ön, a partner kollégája, Acropora).
*/
const msg = (
  id: string,
  createdAt: string,
  over: Partial<PartnerConversationMessage> = {},
): PartnerConversationMessage => ({
  id,
  text: `szöveg ${id}`,
  createdAt,
  editedAt: null,
  side: "ACROPORA",
  authorName: "Kovács Feri",
  mine: false,
  ...over,
});

describe("the ticket conversation on the portal", () => {
  it("merges pages once per message, oldest first, and the newer copy wins", () => {
    const merged = mergeConversation(
      [
        msg("b", "2026-10-06T12:01:00.000Z"),
        msg("a", "2026-10-06T12:00:00.000Z"),
      ],
      [
        msg("b", "2026-10-06T12:01:00.000Z", { text: "javított" }),
        msg("c", "2026-10-06T12:02:00.000Z"),
      ],
    );
    assert.deepEqual(
      merged.map((m) => [m.id, m.text]),
      [
        ["a", "szöveg a"],
        ["b", "javított"],
        ["c", "szöveg c"],
      ],
    );
  });

  it("only a non-blank text within the limit is sendable, trimmed", () => {
    assert.equal(sendableText("  Mikor jönnek?  "), "Mikor jönnek?");
    assert.equal(sendableText("   \n "), null);
    assert.equal(sendableText("x".repeat(4000)), "x".repeat(4000));
    assert.equal(sendableText("x".repeat(4001)), null);
  });

  it("the resend id fits the server's 8-64 and differs per message", () => {
    const one = newClientMessageId();
    const two = newClientMessageId();
    assert.ok(one.length >= 8 && one.length <= 64, one);
    assert.notEqual(one, two);
  });

  it("the author line says who wrote it", () => {
    const at = "2026-10-06T12:00:00.000Z";
    assert.equal(
      authorLine(msg("a", at, { mine: true, side: "PARTNER" })),
      "Ön",
    );
    assert.equal(authorLine(msg("b", at)), "Kovács Feri · Acropora");
    assert.equal(
      authorLine(msg("c", at, { side: "PARTNER", authorName: "Kiss Anna" })),
      "Kiss Anna",
    );
  });
});
