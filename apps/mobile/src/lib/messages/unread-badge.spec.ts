import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appIconBadgeCount,
  refreshesUnread,
  unreadBadgeLabel,
} from "./unread-badge";

/*
  AZ OLVASATLAN-JELVÉNY A TELEFONON (Balázs, 2026-10-05). Ami pirosít:
  - nullánál vagy hiányzó számnál jelvény látszik;
  - 99 fölött a szám szétfeszíti a jelvényt;
  - kijelentkezve az app ikonja számot mutat;
  - egy olvasás vagy új üzenet nem kéri újra a számot.
*/
describe("az olvasatlan-jelvény", () => {
  it("a navigáció felirata", () => {
    assert.equal(unreadBadgeLabel(0), null);
    assert.equal(unreadBadgeLabel(undefined), null);
    assert.equal(unreadBadgeLabel(-3), null);
    assert.equal(unreadBadgeLabel(7), "7");
    assert.equal(unreadBadgeLabel(99), "99");
    assert.equal(unreadBadgeLabel(140), "99+");
  });

  it("az app ikonja: kijelentkezve nulla, egyébként a szám", () => {
    assert.equal(appIconBadgeCount(5, true), 5);
    assert.equal(appIconBadgeCount(5, false), 0);
    assert.equal(appIconBadgeCount(undefined, true), 0);
    assert.equal(appIconBadgeCount(Number.NaN, true), 0);
  });

  it("melyik élő esemény kéri újra", () => {
    for (const type of [
      "message.created",
      "conversation.read",
      "conversation.created",
      "resync",
    ])
      assert.equal(refreshesUnread({ type }), true, type);
    assert.equal(refreshesUnread({ type: "message.updated" }), false);
  });
});
