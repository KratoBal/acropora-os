import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { LivestockArrivalsRepository } from "../../livestock-arrivals/livestock-arrivals.repository.js";
import { LivestockArrivalsService } from "../../livestock-arrivals/livestock-arrivals.service.js";
import { CalendarEventRepository } from "./calendar-event.repository.js";
import { CalendarEventService } from "./calendar-event.service.js";
import { plannedInstant } from "./calendar-slots.repository.js";

/*
  AN EVENT'S CHANGE REACHES ITS SLOTS, ON THE DATABASE (T5.5 S7). Days in 2031-10, far from other tests.

  What turns this red: a moved hand event or live arrival leaving its slots on the old day; an approved slot not
  stepped back to approval, or stepped back without a log line naming why; a scheduled one stepped back; an item without
  a comment saying what moved; a deleted event or a cancelled arrival leaving its approved slot approved.
*/
const gate = integrationDatabaseGate(process.env);

describe(
  "Content calendar slots follow their event, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const tag = `t55s7-int-${Date.now() % 1_000_000}`;
    const users: string[] = [];
    const rules: string[] = [];
    const events: string[] = [];
    const arrivals: string[] = [];
    let actor = { id: "", role: "MANAGER" as const };
    const service = new CalendarEventService(new CalendarEventRepository());
    const arrivalsService = new LivestockArrivalsService(
      new LivestockArrivalsRepository(),
    );
    const keys = () => [
      ...events.map((id) => `event:${id}`),
      ...arrivals.map((id) => `livestock:${id}`),
    ];
    const item = (id: string) =>
      prisma.contentItem.findUniqueOrThrow({
        where: { id },
        select: {
          state: true,
          plannedFor: true,
          stateEvents: {
            select: { toState: true, note: true, actorUserId: true },
            orderBy: { createdAt: "asc" },
          },
          comments: { select: { body: true, authorId: true } },
        },
      });
    const budapest = (at: Date | null) =>
      at
        ? new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Europe/Budapest",
          }).format(at)
        : null;
    const slot = async (
      eventKey: string,
      ruleId: string,
      state: "IDEA" | "READY_TO_SEND" | "SCHEDULED",
      day: string,
    ) =>
      (
        await prisma.contentItem.create({
          data: {
            title: `${tag} ${state}`,
            channel: "FACEBOOK_POST",
            state,
            plannedFor: plannedInstant(day),
            calendarEventKey: eventKey,
            templateRuleId: ruleId,
          },
          select: { id: true },
        })
      ).id;

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
      for (const [eventKind, offsetDays] of [
        ["SHOP_EVENT", -2],
        ["LIVESTOCK_ARRIVAL", -3],
      ] as const)
        rules.push(
          (
            await prisma.contentTemplateRule.create({
              data: {
                eventKind,
                label: `${tag} ${eventKind}`,
                channel: "FACEBOOK_POST",
                anchor: "START",
                offsetDays,
              },
              select: { id: true },
            })
          ).id,
        );
    });

    after(async () => {
      await prisma.contentItem.deleteMany({
        where: { calendarEventKey: { in: keys() } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityType: "CalendarEvent", entityId: { in: events } },
      });
      await prisma.calendarEvent.deleteMany({ where: { id: { in: events } } });
      await prisma.livestockArrival.deleteMany({
        where: { id: { in: arrivals } },
      });
      await prisma.contentTemplateRule.deleteMany({
        where: { id: { in: rules } },
      });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      nincsMaradek([
        {
          nev: "ContentItem (follow test)",
          darab: await prisma.contentItem.count({
            where: { calendarEventKey: { in: keys() } },
          }),
        },
        {
          nev: "CalendarEvent (follow test)",
          darab: await prisma.calendarEvent.count({
            where: { id: { in: events } },
          }),
        },
        {
          nev: "LivestockArrival (follow test)",
          darab: await prisma.livestockArrival.count({
            where: { id: { in: arrivals } },
          }),
        },
        {
          nev: "ContentTemplateRule (follow test)",
          darab: await prisma.contentTemplateRule.count({
            where: { id: { in: rules } },
          }),
        },
        {
          nev: "User (follow test)",
          darab: await prisma.user.count({ where: { id: { in: users } } }),
        },
      ]);
    });

    it("a moved hand event moves its slots, steps the approved one back with a reason, keeps the scheduled one, and tells each", async () => {
      const event = await service.create(
        {
          kind: "SHOP_EVENT",
          title: `${tag} nyílt nap`,
          startsOn: "2031-10-10",
        },
        actor,
      );
      events.push(event.id);
      const key = `event:${event.id}`;
      const ready = await slot(key, rules[0]!, "READY_TO_SEND", "2031-10-08");
      // one slot per event and row: the scheduled slot stands on a row of its own
      const schedRule = (
        await prisma.contentTemplateRule.create({
          data: {
            eventKind: "SHOP_EVENT",
            label: `${tag} ütemezett`,
            channel: "FACEBOOK_POST",
            anchor: "START",
            offsetDays: -2,
          },
          select: { id: true },
        })
      ).id;
      rules.push(schedRule);
      const scheduled = await slot(key, schedRule, "SCHEDULED", "2031-10-08");

      await service.update(
        event.id,
        {
          expectedUpdatedAt: event.updatedAt,
          startsOn: "2031-10-15",
          endsOn: "2031-10-15",
        },
        actor,
      );

      const a = await item(ready);
      assert.equal(budapest(a.plannedFor), "2031-10-13");
      assert.equal(a.state, "AWAITING_APPROVAL");
      assert.deepEqual(a.stateEvents.at(-1), {
        toState: "AWAITING_APPROVAL",
        note: "A naptár-esemény változott: a szövegben álló dátum már nem igaz.",
        actorUserId: actor.id,
      });
      assert.equal(a.comments.length, 1);
      assert.match(a.comments[0]!.body, /2031-10-08 helyett 2031-10-13/);
      assert.equal(a.comments[0]!.authorId, actor.id);

      const s = await item(scheduled);
      assert.equal(s.state, "SCHEDULED");
      assert.equal(budapest(s.plannedFor), "2031-10-13");
      assert.match(s.comments[0]!.body, /kézzel kell átírni/);

      // saving again changes nothing more: no second comment
      const again = await service.get(event.id);
      await service.update(event.id, { title: again.title }, actor);
      assert.equal((await item(ready)).comments.length, 1);
    });

    it("a deleted hand event steps its approved slot back and tells it", async () => {
      const event = await service.create(
        { kind: "SHOP_EVENT", title: `${tag} előadás`, startsOn: "2031-10-20" },
        actor,
      );
      events.push(event.id);
      const ready = await slot(
        `event:${event.id}`,
        rules[0]!,
        "READY_TO_SEND",
        "2031-10-18",
      );
      await service.delete(event.id, actor);
      const a = await item(ready);
      assert.equal(a.state, "AWAITING_APPROVAL");
      assert.equal(budapest(a.plannedFor), "2031-10-18");
      assert.match(a.comments[0]!.body, /megszűnt/);
    });

    it("a live arrival that slips moves its slot; a cancelled one tells it", async () => {
      const arrival = await arrivalsService.create(
        {
          kind: "CORAL",
          label: `${tag} Zoanthus`,
          expectedOn: "2031-10-25",
        },
        actor.id,
      );
      arrivals.push(arrival.id);
      const key = `livestock:${arrival.id}`;
      const idea = await slot(key, rules[1]!, "IDEA", "2031-10-22");
      await arrivalsService.update(
        arrival.id,
        { expectedOn: "2031-10-28", expectedUpdatedAt: arrival.updatedAt },
        actor.id,
      );
      const moved = await item(idea);
      assert.equal(budapest(moved.plannedFor), "2031-10-25");
      assert.equal(moved.state, "IDEA");
      const current = await arrivalsService.get(arrival.id);
      await arrivalsService.update(
        arrival.id,
        { status: "CANCELLED", expectedUpdatedAt: current.updatedAt },
        actor.id,
      );
      const told = await item(idea);
      assert.equal(told.comments.length, 2);
      assert.ok(told.comments.some((c) => /megszűnt/.test(c.body)));
      // a later save of the cancelled arrival tells nobody again
      const cancelledNow = await arrivalsService.get(arrival.id);
      await arrivalsService.update(
        arrival.id,
        { note: "javított", expectedUpdatedAt: cancelledNow.updatedAt },
        actor.id,
      );
      assert.equal((await item(idea)).comments.length, 2);
    });
  },
);
