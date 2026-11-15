import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type {
  ContentCalendarEntry,
  ContentCalendarFeed,
} from "@acropora/types";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import type { CalendarFeedService } from "./calendar-feed.service.js";
import { CalendarSlotsRepository } from "./calendar-slots.repository.js";
import { CalendarSlotsService } from "./calendar-slots.service.js";
import { ContentTemplateRepository } from "./content-template.repository.js";

/*
  OPENING THE CONTENT SLOTS ON THE DATABASE (T5.5 S5). The template is the real one (the migration's seeded rows and
  this file's own shop-event row); the feed is this file's own entries, so the run opens slots for this file's events
  only and never for another test's.

  What turns this red: a second run opening the same slots again (the unique index or the existing-check missing); a
  slot that is not an IDEA without an author, or whose day is not the row's day in Budapest; the first log line not
  naming who opened it; a machine account opening slots.
*/
const gate = integrationDatabaseGate(process.env);

describe(
  "Content calendar slots, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const tag = `t55s5-int-${Date.now() % 1_000_000}`;
    const users: string[] = [];
    const rules: string[] = [];
    let actor = { id: "", role: "MANAGER" as const };
    const entries: ContentCalendarEntry[] = [
      {
        kind: "LIVESTOCK_ARRIVAL",
        key: `livestock:${tag}`,
        title: `${tag} Zoanthus`,
        startsOn: "2031-08-20",
        endsOn: "2031-08-20",
        arrivalId: tag,
        livestockKind: "CORAL",
        status: "ORDERED",
        quantity: null,
        preorderable: true,
        productId: null,
      },
      {
        kind: "EVENT",
        key: `event:${tag}`,
        title: `${tag} Nyílt nap`,
        startsOn: "2031-08-22",
        endsOn: "2031-08-23",
        eventId: tag,
        eventKind: "SHOP_EVENT",
        location: null,
        responsible: null,
      },
    ];
    const feed = {
      feed: async (from: string, to: string): Promise<ContentCalendarFeed> => ({
        queriedAt: new Date().toISOString(),
        from,
        to,
        entries,
        withoutDay: { purchaseOrders: 0 },
      }),
    } as unknown as CalendarFeedService;
    const service = new CalendarSlotsService(
      feed,
      new ContentTemplateRepository(),
      new CalendarSlotsRepository(),
      () => new Date("2031-08-01T10:00:00Z"),
    );
    const ours = () =>
      prisma.contentItem.findMany({
        where: { calendarEventKey: { in: entries.map((e) => e.key) } },
        select: {
          title: true,
          state: true,
          authorId: true,
          channel: true,
          plannedFor: true,
          templateRuleId: true,
          stateEvents: { select: { actorUserId: true, note: true } },
        },
        orderBy: { plannedFor: "asc" },
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      const user = await prisma.user.create({
        data: {
          email: `${tag}-actor@example.invalid`,
          displayName: `${tag} actor`,
          role: "MANAGER",
        },
        select: { id: true },
      });
      users.push(user.id);
      actor = { id: user.id, role: "MANAGER" };
      rules.push(
        (
          await prisma.contentTemplateRule.create({
            data: {
              eventKind: "SHOP_EVENT",
              label: `${tag} meghívó`,
              channel: "NEWSLETTER",
              anchor: "START",
              offsetDays: -5,
            },
            select: { id: true },
          })
        ).id,
      );
    });

    after(async () => {
      await prisma.contentItem.deleteMany({
        where: { calendarEventKey: { in: entries.map((e) => e.key) } },
      });
      await prisma.contentTemplateRule.deleteMany({
        where: { id: { in: rules } },
      });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      nincsMaradek([
        {
          nev: "ContentItem (slots test)",
          darab: await prisma.contentItem.count({
            where: { calendarEventKey: { in: entries.map((e) => e.key) } },
          }),
        },
        {
          nev: "ContentTemplateRule (slots test)",
          darab: await prisma.contentTemplateRule.count({
            where: { id: { in: rules } },
          }),
        },
        {
          nev: "User (slots test)",
          darab: await prisma.user.count({ where: { id: { in: users } } }),
        },
      ]);
    });

    it("opens one IDEA slot per event and row at the row's Budapest day, without an author, its first log line naming the opener", async () => {
      const result = await service.open("2031-08-18", "2031-08-24", actor);
      // the live arrival: the three seeded rows; the shop event: this file's row
      assert.equal(result.opened.length, 4);
      assert.equal(result.existing, 0);
      const items = await ours();
      assert.deepEqual(
        items.map((item) => [
          item.title,
          item.state,
          item.authorId,
          item.channel,
          new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Europe/Budapest",
          }).format(item.plannedFor!),
        ]),
        [
          [
            `Előjegyzés-felhívás: ${tag} Zoanthus`,
            "IDEA",
            null,
            "FACEBOOK_POST",
            "2031-08-13",
          ],
          [
            `${tag} meghívó: ${tag} Nyílt nap`,
            "IDEA",
            null,
            "NEWSLETTER",
            "2031-08-17",
          ],
          [
            `Mi érkezett: ${tag} Zoanthus`,
            "IDEA",
            null,
            "FACEBOOK_POST",
            "2031-08-20",
          ],
          [
            `Akklimatizáció és tartás: ${tag} Zoanthus`,
            "IDEA",
            null,
            "FACEBOOK_POST",
            "2031-08-21",
          ],
        ],
      );
      for (const item of items) {
        assert.equal(item.stateEvents.length, 1);
        assert.equal(item.stateEvents[0]!.actorUserId, actor.id);
        assert.match(item.stateEvents[0]!.note ?? "", /sablon-sor nyitotta/);
      }
    });

    it("a second run opens nothing, and says the slots exist", async () => {
      const result = await service.open("2031-08-18", "2031-08-24", actor);
      assert.equal(result.opened.length, 0);
      assert.equal(result.existing, 4);
      assert.equal((await ours()).length, 4);
    });

    it("a machine account opens nothing", async () => {
      await assert.rejects(
        service.open("2031-08-18", "2031-08-24", {
          id: actor.id,
          role: "CONTENT_AGENT",
        }),
        ForbiddenException,
      );
      assert.equal((await ours()).length, 4);
    });
  },
);
