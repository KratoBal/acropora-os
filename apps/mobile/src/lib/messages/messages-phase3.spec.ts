import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SUPPRESSED_FOREGROUND,
  foregroundNotificationBehavior,
  foregroundNotificationFor,
} from "../notifications/push-foreground";
import { openConversationId, setOpenConversation } from "./open-conversation";
import {
  fileTypeLabel,
  messageActions,
  notificationLabel,
  notificationOptions,
  pinnedMeta,
  searchCountLabel,
  searchHitMeta,
  shortWhen,
  suppressForegroundPush,
} from "./phase3";

/*
  AZ ÜZENETEK 3. FÁZISA A TELEFONON (terv: uzenetek-3-fazis-terv.md). Ami pirosít:
  - az idő nem a Figma alakja; a kitűzött elemnél nem az üzenet szerzője áll;
  - a „Csak említések” választható (Balázs: most nem), vagy a feloldás akkor is
    ott van, amikor nincs némítás; a lejárt némítás némításnak látszik;
  - más üzenetén Szerkesztés vagy Törlés van, a Továbbítás vagy a Kitűzés hiányzik;
  - a nyitott beszélgetés pushára mégis sáv jön, vagy egy MÁSIK beszélgetésé,
    egy nem-beszélgetés értesítés, vagy nyitott beszélgetés nélkül elnyomódik;
  - a képernyő elhagyása után a nyitott beszélgetés ott ragad.
*/

const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 5, 18, 0); // 2026. október 5., hétfő, 18:00

describe("a Figma időformája", () => {
  it("ma, tegnap, a héten, régebben", () => {
    assert.equal(shortWhen(local(2026, 10, 5, 14, 37), now), "ma 14:37");
    assert.equal(shortWhen(local(2026, 10, 4, 16, 12), now), "tegnap 16:12");
    assert.equal(shortWhen(local(2026, 10, 2), now), "péntek");
    assert.equal(shortWhen(local(2026, 9, 20), now), "szept. 20.");
  });

  it("a találat és a kitűzött elem sora; a darabszám", () => {
    assert.equal(
      searchHitMeta(
        { senderName: "Kovács Anna", createdAt: local(2026, 10, 5, 14, 37) },
        now,
      ),
      "Kovács Anna · ma 14:37",
    );
    assert.equal(
      pinnedMeta(
        { senderName: "Balázs", messageCreatedAt: local(2026, 10, 4, 9, 5) },
        now,
      ),
      "Üzenet · Balázs · tegnap 09:05",
    );
    assert.equal(searchCountLabel(3, false), "3 találat");
    assert.equal(searchCountLabel(1000, true), "1000+ találat");
  });
});

describe("az értesítési beállítás", () => {
  it("nincs „Csak említések”; feloldás csak némítva", () => {
    assert.deepEqual(
      notificationOptions({ notify: "ALL", mutedUntil: null }, now).map(
        (o) => o.label,
      ),
      ["Minden új üzenet", "Némítás 1 órára", "Némítás holnapig"],
    );
    const muted = notificationOptions(
      {
        notify: "ALL",
        mutedUntil: new Date(now.getTime() + 3_600_000).toISOString(),
      },
      now,
    ).map((o) => o.mode);
    assert.ok(muted.includes("UNMUTE"));
  });

  it("a felirat, a lejárt némítással együtt", () => {
    assert.equal(
      notificationLabel(
        { notify: "ALL", mutedUntil: local(2026, 10, 6, 8, 0) },
        now,
      ),
      "Némítva holnap 08:00-ig",
    );
    assert.equal(
      notificationLabel(
        { notify: "ALL", mutedUntil: local(2026, 10, 5, 17, 0) },
        now,
      ),
      "Minden új üzenetről",
    );
  });
});

describe("a műveleti panel jogai", () => {
  it("továbbítás és kitűzés bárkinek, szerkesztés és törlés csak a szerzőnek", () => {
    assert.deepEqual(
      messageActions({
        own: false,
        deleted: false,
        pinned: true,
        hasText: true,
      }),
      ["reply", "copy", "forward", "unpin"],
    );
    assert.deepEqual(
      messageActions({
        own: true,
        deleted: false,
        pinned: false,
        hasText: false,
      }),
      ["reply", "forward", "pin", "edit", "delete"],
    );
    assert.deepEqual(
      messageActions({
        own: true,
        deleted: true,
        pinned: false,
        hasText: true,
      }),
      [],
    );
    assert.equal(fileTypeLabel("meresek.xlsx"), "XLSX");
  });
});

describe("az értesítés, amíg az app nyitva van", () => {
  const conversationPush = { targetType: "conversation", targetId: "c1" };

  it("a NYITOTT beszélgetés pushára nincs sáv", () => {
    assert.equal(suppressForegroundPush(conversationPush, "c1"), true);
    assert.deepEqual(
      foregroundNotificationFor(conversationPush, "c1"),
      SUPPRESSED_FOREGROUND,
    );
  });

  it("minden más esetben a régi „mindig mutatjuk” marad", () => {
    const always = foregroundNotificationBehavior();
    assert.deepEqual(foregroundNotificationFor(conversationPush, "c2"), always);
    assert.deepEqual(foregroundNotificationFor(conversationPush, null), always);
    assert.deepEqual(
      foregroundNotificationFor(
        { targetType: "worksheet", targetId: "c1" },
        "c1",
      ),
      always,
    );
    assert.deepEqual(foregroundNotificationFor(undefined, "c1"), always);
    // nyitott beszélgetés nélkül egy cél nélküli push sem némul el (null === null)
    assert.deepEqual(
      foregroundNotificationFor(
        { targetType: "conversation", targetId: null },
        null,
      ),
      always,
    );
    // KONTROLL: az elnyomott alak tényleg más, különben a fenti egyezés semmit nem mondana
    assert.notDeepEqual(SUPPRESSED_FOREGROUND, always);
  });

  it("a nyitott beszélgetést a képernyő írja, és az alapértelmezés azt olvassa", () => {
    setOpenConversation("c1");
    assert.equal(openConversationId(), "c1");
    assert.deepEqual(
      foregroundNotificationFor(conversationPush),
      SUPPRESSED_FOREGROUND,
    );
    setOpenConversation(null);
    assert.equal(openConversationId(), null);
    assert.deepEqual(
      foregroundNotificationFor(conversationPush),
      foregroundNotificationBehavior(),
    );
  });
});
