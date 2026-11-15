import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { TeachingNumber, TeachingSourceInput } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { ContentRepository } from "./content.repository.js";
import {
  TeachingSourceRepository,
  TeachingSourceStepError,
} from "./teaching-source.repository.js";

/**
 * THE TEACHING SOURCE ON THE REAL DATABASE (T5.2). The version guard and the
 * approval gate run inside transactions (the save's and the state move's), so
 * only the real database shows them.
 *
 * WHAT TURNS IT RED: a save on an older version accepted (two editors
 * overwrite each other); an unchanged save that still bumps the version; a
 * version row missing or rewritten; an approval with an open question that
 * moves the state anyway (no rollback); an approval that does not record its
 * version, or a withdrawal that keeps it; an edit after approval accepted;
 * another channel touched.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "Teaching source and its versions, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const prefix = `t52-int-${Date.now() % 1_000_000}-`;
    const sources = new TeachingSourceRepository();
    const content = new ContentRepository();
    const actor = randomUUID();
    const ids: string[] = [];

    const num = (
      id: string,
      over: Partial<TeachingNumber> = {},
    ): TeachingNumber => ({
      id,
      name: id,
      context: null,
      approx: false,
      quantity: { value: { kind: "exact", value: 1 }, unit: "ml" },
      pairs: [],
      partKey: null,
      display: "1 ml",
      short: "1 ml",
      spoken: null,
      inflections: [],
      state: "OK",
      note: null,
      ...over,
    });

    const input = (
      baseVersion: number | null,
      over: Partial<TeachingSourceInput> = {},
    ): TeachingSourceInput => ({
      baseVersion,
      subtitle: null,
      author: "Akil, Modern Reef blog",
      editor: null,
      audience: "INTERNAL",
      publicBasis: null,
      disclaimer: null,
      parts: [
        {
          key: "elso",
          title: "Első rész",
          text: "Adag: {szám: adag}.",
          subparts: [],
          checklist: [],
          speakerNote: null,
        },
      ],
      numbers: [num("adag")],
      ...over,
    });

    const item = async (
      channel: "TEACHING_SOURCE" | "FACEBOOK_POST",
      state = "DRAFTING",
    ) => {
      const created = await prisma.contentItem.create({
        data: { title: `${prefix}${channel}`, channel, state: state as never },
      });
      ids.push(created.id);
      return created.id;
    };
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
          nev: "ContentItem (teaching source test)",
          darab: await prisma.contentItem.count({ where: { id: { in: ids } } }),
        },
        {
          nev: "TeachingSource (teaching source test)",
          darab: await prisma.teachingSource.count({
            where: { contentId: { in: ids } },
          }),
        },
        {
          nev: "TeachingSourceVersion (teaching source test)",
          darab: await prisma.teachingSourceVersion.count({
            where: { contentId: { in: ids } },
          }),
        },
      ]);
    });

    it("T52-INT-VERSION: each content change is a new version row; an unchanged or stale save is not", async () => {
      const id = await item("TEACHING_SOURCE");
      assert.deepEqual(await sources.save(id, input(1), actor), {
        kind: "stale",
        currentVersion: null,
      });
      assert.deepEqual(await sources.save(id, input(null), actor), {
        kind: "ok",
        version: 1,
        changed: true,
      });
      assert.deepEqual(await sources.save(id, input(1), actor), {
        kind: "ok",
        version: 1,
        changed: false,
      });
      const edited = input(1, {
        numbers: [num("adag", { display: "2 ml", short: "2 ml" })],
      });
      assert.deepEqual(await sources.save(id, edited, actor), {
        kind: "ok",
        version: 2,
        changed: true,
      });
      // a second editor still on version 1
      assert.deepEqual(
        await sources.save(id, input(1, { disclaimer: "Más" }), actor),
        {
          kind: "stale",
          currentVersion: 2,
        },
      );

      const detail = await sources.detail(id);
      assert.equal(detail?.version, 2);
      assert.equal(detail?.numbers[0]?.display, "2 ml");
      assert.deepEqual(
        detail?.versions.map((v) => v.version),
        [2, 1],
      );
      const first = await prisma.teachingSourceVersion.findUniqueOrThrow({
        where: { contentId_version: { contentId: id, version: 1 } },
      });
      assert.equal(
        (first.document as unknown as { numbers: TeachingNumber[] }).numbers[0]
          ?.display,
        "1 ml",
        "the old version keeps its own number",
      );
      assert.equal(first.title, `${prefix}TEACHING_SOURCE`);
    });

    it("T52-INT-APPROVAL: an open question stops the approval and the state stays; a clean source records its version", async () => {
      const id = await item("TEACHING_SOURCE");
      const conflicting = input(null, {
        numbers: [
          num("adag", { name: "Ciklus" }),
          num("masik", {
            name: "Ciklus",
            quantity: { value: { kind: "range", min: 2, max: 6 }, unit: "hét" },
          }),
        ],
      });
      assert.equal((await sources.save(id, conflicting, actor)).kind, "ok");
      for (const [from, to] of [
        ["DRAFTING", "AWAITING_REVIEW"],
        ["AWAITING_REVIEW", "AWAITING_APPROVAL"],
      ])
        assert.equal(await move(id, from!, to!), true, `${from} -> ${to}`);
      await assert.rejects(
        move(id, "AWAITING_APPROVAL", "READY_TO_SEND"),
        TeachingSourceStepError,
      );
      const still = await prisma.contentItem.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(
        still.state,
        "AWAITING_APPROVAL",
        "rolled back with the step",
      );
      assert.equal(
        await prisma.contentStateEvent.count({
          where: { contentId: id, toState: "READY_TO_SEND" },
        }),
        0,
      );

      // back to revision, the editor tells the two apart by their context
      assert.equal(
        await move(id, "AWAITING_APPROVAL", "AWAITING_REVISION"),
        true,
      );
      const resolved = input(1, {
        numbers: [
          num("adag", { name: "Ciklus", context: "a 4. rész szerint" }),
          num("masik", {
            name: "Ciklus",
            context: "az idővonal szerint",
            quantity: { value: { kind: "range", min: 2, max: 6 }, unit: "hét" },
          }),
        ],
      });
      assert.equal((await sources.save(id, resolved, actor)).kind, "ok");
      for (const [from, to] of [
        ["AWAITING_REVISION", "AWAITING_REVIEW"],
        ["AWAITING_REVIEW", "AWAITING_APPROVAL"],
        ["AWAITING_APPROVAL", "READY_TO_SEND"],
      ])
        assert.equal(await move(id, from!, to!), true, `${from} -> ${to}`);
      assert.equal((await sources.detail(id))?.approvedVersion, 2);

      assert.deepEqual(await sources.save(id, input(2), actor), {
        kind: "not-editable",
      });
      assert.equal(await sources.editable(id), false);

      assert.equal(await move(id, "READY_TO_SEND", "AWAITING_REVISION"), true);
      assert.equal((await sources.detail(id))?.approvedVersion, null);
    });

    it("T52-INT-CHANNEL: another channel is no teaching source, and its moves are untouched", async () => {
      const id = await item("FACEBOOK_POST");
      assert.deepEqual(await sources.save(id, input(null), actor), {
        kind: "not-teaching-source",
      });
      assert.equal(await sources.editable(id), false);
      for (const [from, to] of [
        ["DRAFTING", "AWAITING_REVIEW"],
        ["AWAITING_REVIEW", "AWAITING_APPROVAL"],
        ["AWAITING_APPROVAL", "READY_TO_SEND"],
      ])
        assert.equal(await move(id, from!, to!), true, `${from} -> ${to}`);
      assert.equal(await sources.detail(id), null);
      assert.deepEqual(
        await sources.save("c" + "z".repeat(24), input(null), actor),
        { kind: "missing" },
      );
    });

    it("T52-INT-LIST: the list shows a source with its version and audience, and no discarded one", async () => {
      const id = await item("TEACHING_SOURCE");
      assert.equal((await sources.save(id, input(null), actor)).kind, "ok");
      const discarded = await item("TEACHING_SOURCE", "DISCARDED");
      const list = await sources.list(1_000);
      const row = list.find((r) => r.contentId === id);
      assert.equal(row?.version, 1);
      assert.equal(row?.audience, "INTERNAL");
      assert.equal(row?.openQuestions, 0);
      assert.deepEqual(row?.outputs, {
        total: 0,
        current: 0,
        stale: 0,
        differing: 0,
        overFrame: 0,
        sent: 0,
      });
      assert.equal(
        list.find((r) => r.contentId === discarded),
        undefined,
      );
    });
  },
);
