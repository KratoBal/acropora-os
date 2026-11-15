import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { ContentTemplateRepository } from "./content-template.repository.js";
import { ContentTemplateService } from "./content-template.service.js";

/*
  THE DEPENDENCY TEMPLATE ON THE DATABASE (T5.5 S4). What turns this red: the migration not seeding the spec's six rows
  (or seeding a purchase-arrival row, which the plan leaves out); the newsletter channel not accepted by the database; a
  write without its audit row, or one that does not say what changed; an edit that changes nothing still logged; a
  stale form overwriting a newer row.

  The seeded rows are read, never changed: other tests and the stage see them. The rows this file writes are its own
  (the label carries the tag) and are deleted after.
*/
const gate = integrationDatabaseGate(process.env);

describe(
  "Content calendar template, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const tag = `t55s4-int-${Date.now() % 1_000_000}`;
    const rules: string[] = [];
    const users: string[] = [];
    let actor = { id: "", role: "MANAGER" as const };
    const service = new ContentTemplateService(new ContentTemplateRepository());

    const audit = (entityId: string) =>
      prisma.auditLog.findMany({
        where: { entityType: "ContentTemplateRule", entityId },
        orderBy: { createdAt: "asc" },
        select: { action: true, userId: true, metadata: true },
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
    });

    after(async () => {
      await prisma.auditLog.deleteMany({
        where: { entityType: "ContentTemplateRule", entityId: { in: rules } },
      });
      await prisma.contentTemplateRule.deleteMany({
        where: { id: { in: rules } },
      });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      nincsMaradek([
        {
          nev: "ContentTemplateRule (template test)",
          darab: await prisma.contentTemplateRule.count({
            where: { id: { in: rules } },
          }),
        },
        {
          nev: "AuditLog (template test)",
          darab: await prisma.auditLog.count({
            where: {
              entityType: "ContentTemplateRule",
              entityId: { in: rules },
            },
          }),
        },
        {
          nev: "User (template test)",
          darab: await prisma.user.count({ where: { id: { in: users } } }),
        },
      ]);
    });

    it("the migration seeds the spec's six rows, in the calendar's order, and none for a purchase arrival", async () => {
      const seeded = (await service.list()).filter((row) =>
        row.id.startsWith("t55-"),
      );
      assert.deepEqual(
        seeded.map((row) => [
          row.eventKind,
          row.label,
          row.channel,
          row.anchor,
          row.offsetDays,
        ]),
        [
          [
            "LIVESTOCK_ARRIVAL",
            "Előjegyzés-felhívás",
            "FACEBOOK_POST",
            "START",
            -7,
          ],
          ["LIVESTOCK_ARRIVAL", "Mi érkezett", "FACEBOOK_POST", "START", 0],
          [
            "LIVESTOCK_ARRIVAL",
            "Akklimatizáció és tartás",
            "FACEBOOK_POST",
            "START",
            1,
          ],
          ["SALE", "Bejelentés", "FACEBOOK_POST", "START", -3],
          ["SALE", "Emlékeztető az utolsó napon", "FACEBOOK_POST", "END", 0],
          ["SALE", "Hírlevél", "NEWSLETTER", "START", 0],
        ],
      );
    });

    it("a new newsletter row is stored and logged; an edit logs what changed from and to; an edit that changes nothing logs nothing; a stale form is a 409", async () => {
      const created = await service.create(
        {
          eventKind: "SHOP_EVENT",
          label: `${tag} meghívó`,
          channel: "NEWSLETTER",
          offsetDays: -5,
        },
        actor,
      );
      rules.push(created.id);
      assert.equal(created.channel, "NEWSLETTER");
      assert.equal(created.anchor, "START");
      const moved = await service.update(
        created.id,
        { expectedUpdatedAt: created.updatedAt, offsetDays: -7 },
        actor,
      );
      const same = await service.update(
        created.id,
        { expectedUpdatedAt: moved.updatedAt, offsetDays: -7 },
        actor,
      );
      assert.equal(same.updatedAt, moved.updatedAt);
      const log = await audit(created.id);
      assert.deepEqual(
        log.map((row) => row.action),
        ["content_template_rule.created", "content_template_rule.updated"],
      );
      assert.equal(log[1]!.userId, actor.id);
      assert.deepEqual(log[1]!.metadata, { offsetDays: { from: -5, to: -7 } });
      await assert.rejects(
        service.update(
          created.id,
          { expectedUpdatedAt: created.updatedAt, label: "régi űrlap" },
          actor,
        ),
        ConflictException,
      );
    });
  },
);
