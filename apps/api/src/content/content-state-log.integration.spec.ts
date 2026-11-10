import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { ContentRepository } from "./content.repository.js";

/**
 * THE STATE LOG ON THE REAL DATABASE (T5.1, card db640e6a). The log row is written in the move's own transaction, so only
 * the real database can show that a refused move leaves no row and that a created item starts its log.
 *
 * WHAT TURNS IT RED: a creation without its first row; a move without a row, or with the wrong from, to, actor or note; a
 * refused move (the item moved meanwhile) that still leaves a row or changes the state; the table missing or not cascading
 * with its item (the cleanup would then leave rows behind).
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "The content state log, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const content = new ContentRepository();
    const actor = randomUUID();
    const ids: string[] = [];
    const title = `statelog-${Date.now() % 1_000_000}`;

    const events = (contentId: string) =>
      prisma.contentStateEvent.findMany({
        where: { contentId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

    before(() => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
    });

    after(async () => {
      await prisma.contentItem.deleteMany({ where: { id: { in: ids } } });
      nincsMaradek([
        {
          nev: "ContentItem (state log test)",
          darab: await prisma.contentItem.count({ where: { id: { in: ids } } }),
        },
        {
          nev: "ContentStateEvent (state log test)",
          darab: await prisma.contentStateEvent.count({
            where: { contentId: { in: ids } },
          }),
        },
      ]);
    });

    it("a created item starts its log: from nothing to the state it was created in, by the author", async () => {
      const item = await content.create({
        title,
        channel: "OTHER",
        authorId: actor,
        state: "DRAFTING",
      });
      ids.push(item.id);
      const log = await events(item.id);
      assert.equal(log.length, 1);
      assert.equal(log[0]!.fromState, null);
      assert.equal(log[0]!.toState, "DRAFTING");
      assert.equal(log[0]!.actorUserId, actor);
    });

    it("a move writes one row with who, from, to and the note; a refused move writes nothing", async () => {
      const item = await content.create({
        title: `${title}-b`,
        channel: "OTHER",
        authorId: actor,
        state: "DRAFTING",
      });
      ids.push(item.id);

      assert.equal(
        await content.moveState({
          id: item.id,
          from: "DRAFTING",
          to: "AWAITING_REVIEW",
          actorUserId: actor,
        }),
        true,
      );
      assert.equal(
        await content.moveState({
          id: item.id,
          from: "AWAITING_REVIEW",
          to: "AWAITING_REVISION",
          actorUserId: actor,
          note: { authorId: actor, body: "az ár hiányzik" },
        }),
        true,
      );

      // the item is no longer where this caller thinks: refused, no row, state unchanged
      assert.equal(
        await content.moveState({
          id: item.id,
          from: "AWAITING_REVIEW",
          to: "AWAITING_APPROVAL",
          actorUserId: actor,
        }),
        false,
      );

      const log = await events(item.id);
      assert.deepEqual(
        log.map((row) => [row.fromState, row.toState, row.note]),
        [
          [null, "DRAFTING", null],
          ["DRAFTING", "AWAITING_REVIEW", null],
          ["AWAITING_REVIEW", "AWAITING_REVISION", "az ár hiányzik"],
        ],
      );
      assert.ok(log.every((row) => row.actorUserId === actor));
      const stored = await prisma.contentItem.findUnique({
        where: { id: item.id },
        select: { state: true },
      });
      assert.equal(stored?.state, "AWAITING_REVISION");
    });
  },
);
