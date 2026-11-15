import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { ProductDataRepository } from "../product-data/product-data.repository.js";
import { ProductDataService } from "../product-data/product-data.service.js";
import { CalendarFeedRepository } from "./calendar-feed.repository.js";
import { CalendarFeedService } from "./calendar-feed.service.js";
import {
  CalendarGapsRepository,
  CONTENT_CALENDAR_SETTING_ID,
} from "./calendar-gaps.repository.js";
import { CalendarGapsService } from "./calendar-gaps.service.js";
import { ContentTemplateRepository } from "./content-template.repository.js";

/*
  THE GAP SIGNALS ON THE DATABASE (T5.5 S6). The clock stands at 2031-09-01, so the 14 days are 2031-09-01..14, far
  from any other test's rows; the assertions look at this file's own event only.

  What turns this red: the real feed, template and slot rows not meeting (an opened idea slot not seen as the event's
  slot, or the event not listed as missing); the setting not stored, not logged with from and to, or not cleared by
  null; a machine account changing the setting.

  THE SETTING ROW IS SHARED (one row for the whole calendar): this file restores what was there before it.
*/
const gate = integrationDatabaseGate(process.env);

describe(
  "Content calendar gaps, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const tag = `t55s6-int-${Date.now() % 1_000_000}`;
    const users: string[] = [];
    const rules: string[] = [];
    const events: string[] = [];
    let actor = { id: "", role: "MANAGER" as const };
    let settingBefore: { exists: boolean; value: number | null } = {
      exists: false,
      value: null,
    };
    const clock = () => new Date("2031-09-01T10:00:00Z");
    const service = new CalendarGapsService(
      new CalendarFeedService(new CalendarFeedRepository(), clock),
      new ContentTemplateRepository(),
      new CalendarGapsRepository(),
      new ProductDataService(new ProductDataRepository(), clock),
      clock,
    );

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      const existing = await prisma.contentCalendarSetting.findUnique({
        where: { id: CONTENT_CALENDAR_SETTING_ID },
        select: { newsletterMinDays: true },
      });
      settingBefore = {
        exists: existing !== null,
        value: existing?.newsletterMinDays ?? null,
      };
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
      const rule = await prisma.contentTemplateRule.create({
        data: {
          eventKind: "SHOP_EVENT",
          label: `${tag} meghívó`,
          channel: "FACEBOOK_POST",
          anchor: "START",
          offsetDays: -2,
        },
        select: { id: true },
      });
      rules.push(rule.id);
      const event = await prisma.calendarEvent.create({
        data: {
          kind: "SHOP_EVENT",
          title: `${tag} nyílt nap`,
          startsOn: new Date("2031-09-05T00:00:00Z"),
          endsOn: new Date("2031-09-05T00:00:00Z"),
        },
        select: { id: true },
      });
      events.push(event.id);
      await prisma.contentItem.create({
        data: {
          title: `${tag} meghívó: nyílt nap`,
          channel: "FACEBOOK_POST",
          state: "IDEA",
          plannedFor: new Date("2031-09-03T08:00:00Z"),
          calendarEventKey: `event:${event.id}`,
          templateRuleId: rule.id,
        },
      });
    });

    after(async () => {
      await prisma.contentItem.deleteMany({
        where: { calendarEventKey: { in: events.map((id) => `event:${id}`) } },
      });
      await prisma.calendarEvent.deleteMany({ where: { id: { in: events } } });
      await prisma.contentTemplateRule.deleteMany({
        where: { id: { in: rules } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityType: "ContentCalendarSetting", userId: { in: users } },
      });
      if (settingBefore.exists)
        await prisma.contentCalendarSetting.update({
          where: { id: CONTENT_CALENDAR_SETTING_ID },
          data: { newsletterMinDays: settingBefore.value },
        });
      else
        await prisma.contentCalendarSetting.deleteMany({
          where: { id: CONTENT_CALENDAR_SETTING_ID },
        });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      nincsMaradek([
        {
          nev: "ContentItem (gaps test)",
          darab: await prisma.contentItem.count({
            where: {
              calendarEventKey: { in: events.map((id) => `event:${id}`) },
            },
          }),
        },
        {
          nev: "CalendarEvent (gaps test)",
          darab: await prisma.calendarEvent.count({
            where: { id: { in: events } },
          }),
        },
        {
          nev: "ContentTemplateRule (gaps test)",
          darab: await prisma.contentTemplateRule.count({
            where: { id: { in: rules } },
          }),
        },
        {
          nev: "User (gaps test)",
          darab: await prisma.user.count({ where: { id: { in: users } } }),
        },
      ]);
    });

    it("the event of the next 14 days is listed as missing, with its opened idea slot found by key and row", async () => {
      const gaps = await service.gaps();
      assert.equal(gaps.from, "2031-09-01");
      assert.equal(gaps.to, "2031-09-14");
      const ours = gaps.events.find((e) => e.eventKey === `event:${events[0]}`);
      assert.ok(ours, "the event is in the list");
      assert.equal(ours.missing, true);
      assert.deepEqual(
        ours.slots
          .filter((s) => s.ruleId === rules[0])
          .map((s) => [s.plannedOn, s.daysLeft, s.status, s.done]),
        [["2031-09-03", 2, "IDEA", false]],
      );
    });

    it("the setting is stored and logged from and to, null clears it, and a machine account cannot change it", async () => {
      const saved = await service.saveSettings(7, actor);
      assert.equal(saved.newsletterMinDays, 7);
      assert.equal((await service.settings()).newsletterMinDays, 7);
      assert.equal((await service.gaps()).newsletter.minDaysBetween, 7);
      const cleared = await service.saveSettings(null, actor);
      assert.equal(cleared.newsletterMinDays, null);
      const log = await prisma.auditLog.findMany({
        where: { entityType: "ContentCalendarSetting", userId: actor.id },
        orderBy: { createdAt: "asc" },
        select: { metadata: true },
      });
      assert.deepEqual(
        log.map((row) => row.metadata),
        [
          { newsletterMinDays: { from: settingBefore.value, to: 7 } },
          { newsletterMinDays: { from: 7, to: null } },
        ],
      );
      await assert.rejects(
        service.saveSettings(3, { id: actor.id, role: "CONTENT_AGENT" }),
        ForbiddenException,
      );
      assert.equal((await service.settings()).newsletterMinDays, null);
    });
  },
);
