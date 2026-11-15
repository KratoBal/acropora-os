import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { CalendarEventRepository } from "./calendar-event.repository.js";
import { CalendarEventService } from "./calendar-event.service.js";

/*
  THE HAND-ENTERED CALENDAR EVENTS ON THE DATABASE (T5.5 S2). Days far in the future (2031-06), so no other test's
  rows meet them.

  What turns this red: a day stored shifted by the time zone (a date column read back as the day before); a write or a
  delete without its audit row, or an audit row that does not say what changed or what was deleted; a stale edit
  overwriting a newer record; an edit that changes nothing still logged; a machine or inactive account offered or
  accepted as responsible; the responsible set taken from the role template instead of the effective permission; a deleted event still readable.
*/
const gate = integrationDatabaseGate(process.env);

describe(
  "Calendar events, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const tag = `t55s2-int-${Date.now() % 1_000_000}`;
    const events: string[] = [];
    const users: string[] = [];
    let actor = { id: "", role: "MANAGER" as const };
    let responsible = "";
    const others: Record<string, string> = {};
    const service = new CalendarEventService(new CalendarEventRepository());

    const audit = (entityId: string) =>
      prisma.auditLog.findMany({
        where: { entityType: "CalendarEvent", entityId },
        orderBy: { createdAt: "asc" },
        select: { action: true, userId: true, metadata: true },
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      for (const [key, nickname, role, isActive] of [
        ["actor", null, "MANAGER", true],
        ["responsible", "Luca", "MANAGER", true],
        ["agent", null, "CONTENT_AGENT", true],
        ["inactive", null, "MANAGER", false],
        // the effective permission decides, not the role template alone
        ["granted", null, "SERVICE", true],
        ["revoked", null, "MANAGER", true],
      ] as const) {
        const user = await prisma.user.create({
          data: {
            email: `${tag}-${key}@example.invalid`,
            displayName: `${tag} ${key}`,
            nickname,
            role,
            isActive,
          },
          select: { id: true },
        });
        users.push(user.id);
        if (key === "actor") actor = { id: user.id, role: "MANAGER" };
        else if (key === "responsible") responsible = user.id;
        else others[key] = user.id;
      }
      await prisma.userPermissionOverride.createMany({
        data: [
          {
            userId: others.granted!,
            permission: "content.view",
            effect: "GRANT",
          },
          {
            userId: others.revoked!,
            permission: "content.view",
            effect: "REVOKE",
          },
        ],
      });
    });

    after(async () => {
      await prisma.auditLog.deleteMany({
        where: { entityType: "CalendarEvent", entityId: { in: events } },
      });
      await prisma.calendarEvent.deleteMany({ where: { id: { in: events } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      nincsMaradek([
        {
          nev: "CalendarEvent (calendar event test)",
          darab: await prisma.calendarEvent.count({
            where: { id: { in: events } },
          }),
        },
        {
          nev: "AuditLog (calendar event test)",
          darab: await prisma.auditLog.count({
            where: { entityType: "CalendarEvent", entityId: { in: events } },
          }),
        },
        {
          nev: "User (calendar event test)",
          darab: await prisma.user.count({ where: { id: { in: users } } }),
        },
      ]);
    });

    it("create keeps the days as written, names the responsible by nickname, and logs what was written", async () => {
      const created = await service.create(
        {
          kind: "SHOP_EVENT",
          title: ` ${tag} nyílt nap `,
          startsOn: "2031-06-14",
          endsOn: "2031-06-15",
          location: "Bolt",
          responsibleUserId: responsible,
        },
        actor,
      );
      events.push(created.id);
      assert.equal(created.title, `${tag} nyílt nap`);
      assert.equal(created.startsOn, "2031-06-14");
      assert.equal(created.endsOn, "2031-06-15");
      assert.deepEqual(created.responsible, { id: responsible, name: "Luca" });
      assert.deepEqual(await service.get(created.id), created);
      assert.deepEqual(await audit(created.id), [
        {
          action: "calendar_event.created",
          userId: actor.id,
          metadata: {
            kind: "SHOP_EVENT",
            title: `${tag} nyílt nap`,
            startsOn: "2031-06-14",
            endsOn: "2031-06-15",
            location: "Bolt",
            responsibleUserId: responsible,
          },
        },
      ]);
    });

    it("an edit logs each changed field from and to; a stale form is a 409 and changes nothing", async () => {
      const created = await service.create(
        { kind: "HOLIDAY", title: `${tag} zárva`, startsOn: "2031-06-20" },
        actor,
      );
      events.push(created.id);
      const updated = await service.update(
        created.id,
        {
          expectedUpdatedAt: created.updatedAt,
          endsOn: "2031-06-21",
          location: "Mindkét bolt",
        },
        actor,
      );
      assert.equal(updated.endsOn, "2031-06-21");
      const log = await audit(created.id);
      assert.deepEqual(log[1], {
        action: "calendar_event.updated",
        userId: actor.id,
        metadata: {
          endsOn: { from: "2031-06-20", to: "2031-06-21" },
          location: { from: null, to: "Mindkét bolt" },
        },
      });
      await assert.rejects(
        service.update(
          created.id,
          { expectedUpdatedAt: created.updatedAt, title: "régi űrlap" },
          actor,
        ),
        ConflictException,
      );
      const current = await service.get(created.id);
      assert.equal(current.title, `${tag} zárva`);
      assert.equal((await audit(created.id)).length, 2);
      // an edit that changes nothing writes nothing: no log line, the same updatedAt
      const same = await service.update(
        created.id,
        { expectedUpdatedAt: current.updatedAt, title: current.title },
        actor,
      );
      assert.equal(same.updatedAt, current.updatedAt);
      assert.equal((await audit(created.id)).length, 2);
    });

    it("the responsible choices are the active people who see content: the machine account and the inactive one are neither offered nor accepted", async () => {
      const offered = (await service.responsibleOptions()).map((o) => o.id);
      assert.ok(offered.includes(responsible));
      assert.ok(!offered.includes(others.agent!));
      assert.ok(!offered.includes(others.inactive!));
      // a colleague granted content.view one by one is offered; one whose role has it but who lost it is not
      assert.ok(offered.includes(others.granted!));
      assert.ok(!offered.includes(others.revoked!));
      for (const id of [others.agent!, others.inactive!, others.revoked!])
        await assert.rejects(
          service.create(
            {
              kind: "SHOP_EVENT",
              title: `${tag} nem mehet`,
              startsOn: "2031-06-26",
              responsibleUserId: id,
            },
            actor,
          ),
          BadRequestException,
        );
    });

    it("a delete removes the event, and the log keeps what it was", async () => {
      const created = await service.create(
        { kind: "SHOP_EVENT", title: `${tag} előadás`, startsOn: "2031-06-25" },
        actor,
      );
      events.push(created.id);
      await service.delete(created.id, actor);
      await assert.rejects(service.get(created.id), NotFoundException);
      await assert.rejects(
        service.delete(created.id, actor),
        NotFoundException,
      );
      const log = await audit(created.id);
      assert.deepEqual(
        log.map((row) => row.action),
        ["calendar_event.created", "calendar_event.deleted"],
      );
      assert.deepEqual(log[1]!.metadata, {
        kind: "SHOP_EVENT",
        title: `${tag} előadás`,
        startsOn: "2031-06-25",
        endsOn: "2031-06-25",
        location: null,
        responsibleUserId: null,
      });
    });
  },
);
