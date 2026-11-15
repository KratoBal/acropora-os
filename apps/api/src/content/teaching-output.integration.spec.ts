import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";

import { prisma } from "@acropora/database";
import type { TeachingSourceInput } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { ContentRepository } from "./content.repository.js";
import { TeachingOutputRepository } from "./teaching-output.repository.js";
import { TeachingOutputService } from "./teaching-output.service.js";
import { TeachingSourceRepository } from "./teaching-source.repository.js";

/**
 * THE OUTPUTS ON THE REAL DATABASE (T5.2, slice 2b). WHAT TURNS IT RED: an
 * output generated from the current version instead of the approved one; a
 * stored output body that does not come back as written; an output not
 * stale after the source's next version; the "went out" record written twice
 * by two calls; an output left behind when its item goes.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "Teaching outputs, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const prefix = `t52o-int-${Date.now() % 1_000_000}-`;
    const sources = new TeachingSourceRepository();
    const outputs = new TeachingOutputRepository();
    const service = new TeachingOutputService(outputs, () => new Date());
    const content = new ContentRepository();
    const actor = randomUUID();
    const ids: string[] = [];

    const input = (
      baseVersion: number | null,
      text: string,
    ): TeachingSourceInput => ({
      baseVersion,
      subtitle: null,
      author: "Akil",
      editor: null,
      audience: "INTERNAL",
      publicBasis: null,
      disclaimer: null,
      parts: [
        {
          key: "a",
          title: "Első rész",
          text,
          subparts: [],
          checklist: ["Mérd meg."],
          speakerNote: null,
        },
      ],
      numbers: [],
    });

    const move = (id: string, from: string, to: string) =>
      content.moveState({
        id,
        from: from as never,
        to: to as never,
        actorUserId: actor,
      });

    before(() => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
    });

    after(async () => {
      await prisma.contentItem.deleteMany({ where: { id: { in: ids } } });
      nincsMaradek([
        {
          nev: "ContentItem (teaching output test)",
          darab: await prisma.contentItem.count({ where: { id: { in: ids } } }),
        },
        {
          nev: "TeachingOutput (teaching output test)",
          darab: await prisma.teachingOutput.count({
            where: { contentId: { in: ids } },
          }),
        },
      ]);
    });

    it("T52O-INT-PATH: generated from the approved version, stale after the next one, sent once", async () => {
      const item = await prisma.contentItem.create({
        data: {
          title: `${prefix}forras`,
          channel: "TEACHING_SOURCE",
          state: "DRAFTING",
        },
      });
      ids.push(item.id);
      const id = item.id;
      assert.equal(
        (await sources.save(id, input(null, "Első változat."), actor)).kind,
        "ok",
      );
      for (const [from, to] of [
        ["DRAFTING", "AWAITING_REVIEW"],
        ["AWAITING_REVIEW", "AWAITING_APPROVAL"],
        ["AWAITING_APPROVAL", "READY_TO_SEND"],
      ])
        assert.equal(await move(id, from!, to!), true, `${from} -> ${to}`);

      const printable = await service.generate(id, "PRINTABLE", actor);
      assert.equal(printable.sourceVersion, 1);
      assert.equal(printable.stale, false);
      assert.equal(printable.approved, true);
      assert.equal(printable.body.kind, "PRINTABLE");
      assert.deepEqual(
        printable.body.kind === "PRINTABLE"
          ? printable.body.parts[0]?.paragraphs
          : null,
        ["Első változat."],
      );

      // two records at once: one wins, the other is told
      const results = await Promise.allSettled([
        service.markSent(
          id,
          printable.id,
          { to: "Belső oktatás", public: false },
          actor,
        ),
        service.markSent(
          id,
          printable.id,
          { to: "Másik hely", public: false },
          actor,
        ),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find((r) => r.status === "rejected");
      assert.ok(
        rejected &&
          (rejected as PromiseRejectedResult).reason instanceof
            ConflictException,
      );

      // the source goes back for revision and gets a second version
      assert.equal(await move(id, "READY_TO_SEND", "AWAITING_REVISION"), true);
      assert.equal(
        (await sources.save(id, input(1, "Második változat."), actor)).kind,
        "ok",
      );
      const later = (await service.list(id)).find((o) => o.id === printable.id);
      assert.equal(later?.stale, true);
      assert.equal(later?.approved, false);
      assert.equal(
        later?.sent?.to === "Belső oktatás" || later?.sent?.to === "Másik hely",
        true,
      );
      await assert.rejects(
        service.generate(id, "SLIDES", actor),
        ConflictException,
      );

      const preview = await service.preview(id, "PRINTABLE", "current");
      assert.equal(preview.stamp.sourceVersion, 2);
      assert.equal(
        await prisma.teachingOutput.count({ where: { contentId: id } }),
        1,
        "a preview stores nothing",
      );
    });
  },
);
