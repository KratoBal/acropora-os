import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  buildTeachingOutput,
  type TeachingOutputKind,
  type TeachingOutputSource,
} from "@acropora/types";

import type {
  TeachingOutputRepository,
  TeachingOutputRow,
  TeachingOutputSourceState,
} from "./teaching-output.repository.js";
import { TeachingOutputService } from "./teaching-output.service.js";

/*
  THE OUTPUTS OF A TEACHING SOURCE (T5.2, slice 2b). What turns these red: an
  output stored from an unapproved source, or from the current version instead
  of the approved one; a stale output not marked, or recorded as sent; an
  internal source recorded as sent to a public channel (spec v2, point 1); an
  output recorded as sent twice; an output whose approval was withdrawn
  recorded as sent.
*/

const NOW = new Date("2026-11-15T09:00:00.000Z");

const source = (version: number): TeachingOutputSource => ({
  title: "Az első hat hét",
  version,
  subtitle: null,
  author: "Akil",
  editor: null,
  audience: "INTERNAL",
  publicBasis: null,
  disclaimer: null,
  parts: [
    {
      key: "a",
      title: "A",
      text: `Verzió ${version}.`,
      subparts: [],
      checklist: [],
      speakerNote: null,
    },
  ],
  numbers: [],
});

const row = (over: Partial<TeachingOutputRow> = {}): TeachingOutputRow => ({
  id: "o1",
  kind: "SLIDES",
  sourceVersion: 2,
  body: buildTeachingOutput("SLIDES", source(2), NOW.toISOString()),
  audience: "INTERNAL",
  generatedById: "u1",
  generatedAt: NOW,
  sentTo: null,
  sentPublic: null,
  sentById: null,
  sentAt: null,
  ...over,
});

function setup(
  state: Partial<TeachingOutputSourceState> | null = {},
  rows: TeachingOutputRow[] = [],
  marks = true,
) {
  const created: { kind: TeachingOutputKind; sourceVersion: number }[] = [];
  const sent: unknown[] = [];
  const repository = {
    state: async () =>
      state === null
        ? null
        : {
            channel: "TEACHING_SOURCE",
            itemState: "READY_TO_SEND",
            version: 2,
            approvedVersion: 2,
            ...state,
          },
    versionSource: async (_id: string, v: number) =>
      v <= 3 ? source(v) : null,
    create: async (input: {
      kind: TeachingOutputKind;
      sourceVersion: number;
    }) => {
      created.push(input);
      rows.unshift(
        row({
          id: "new",
          kind: input.kind,
          sourceVersion: input.sourceVersion,
        }),
      );
      return "new";
    },
    list: async () => rows,
    get: async (_c: string, id: string) =>
      rows.find((r) => r.id === id) ?? null,
    markSent: async (input: unknown) => {
      sent.push(input);
      return marks;
    },
  } as unknown as TeachingOutputRepository;
  return {
    service: new TeachingOutputService(repository, () => NOW),
    created,
    sent,
  };
}

describe("TeachingOutputService.generate", () => {
  it("stores an output from the approved version, not the current one", async () => {
    const { service, created } = setup({ version: 3, approvedVersion: 2 });
    const out = await service.generate("c1", "PRINTABLE", "u1");
    assert.deepEqual(
      created.map((c) => [c.kind, c.sourceVersion]),
      [["PRINTABLE", 2]],
    );
    assert.equal(out.sourceVersion, 2);
    assert.equal(out.stale, true, "the source moved on to 3");
  });

  it("refuses an unapproved source, an unknown kind, another channel, no source", async () => {
    for (const [state, kind, type] of [
      [
        { itemState: "AWAITING_APPROVAL", approvedVersion: null },
        "SLIDES",
        ConflictException,
      ],
      [{ approvedVersion: null }, "SLIDES", ConflictException],
      [{}, "VIDEO", BadRequestException],
      [{ channel: "ARTICLE" }, "SLIDES", ConflictException],
      [{ version: null, approvedVersion: null }, "SLIDES", ConflictException],
      [null, "SLIDES", NotFoundException],
    ] as const) {
      const { service, created } = setup(state as never);
      await assert.rejects(
        service.generate("c1", kind, "u1"),
        type,
        JSON.stringify(state),
      );
      assert.equal(created.length, 0);
    }
  });
});

describe("TeachingOutputService.preview", () => {
  it("builds from the current or a named version, and stores nothing", async () => {
    const { service, created } = setup({ version: 3, approvedVersion: null });
    const current = await service.preview("c1", "PRINTABLE", undefined);
    assert.equal(current.stamp.sourceVersion, 3);
    const older = await service.preview("c1", "PRINTABLE", "1");
    assert.equal(older.stamp.sourceVersion, 1);
    await assert.rejects(
      service.preview("c1", "PRINTABLE", "9"),
      NotFoundException,
    );
    await assert.rejects(
      service.preview("c1", "PRINTABLE", "x"),
      BadRequestException,
    );
    assert.equal(created.length, 0);
  });
});

describe("TeachingOutputService.list", () => {
  it("marks a stale output and an output of the approved version, with the flags", async () => {
    const { service } = setup({ version: 3, approvedVersion: 3 }, [
      row({ id: "old", sourceVersion: 2 }),
      row({
        id: "now",
        sourceVersion: 3,
        body: buildTeachingOutput("NARRATION", source(3), NOW.toISOString()),
        kind: "NARRATION",
      }),
    ]);
    const list = await service.list("c1");
    assert.deepEqual(
      list.map((o) => [o.id, o.stale, o.approved, o.chaptersWithoutNarration]),
      [
        ["old", true, false, 0],
        ["now", false, true, 1],
      ],
    );
  });
});

describe("TeachingOutputService.markSent", () => {
  it("records where an approved, current output went", async () => {
    const { service, sent } = setup({}, [row()]);
    await service.markSent(
      "c1",
      "o1",
      { to: "Belső oktatás, 2026-11-20", public: false },
      "u2",
    );
    assert.equal(sent.length, 1);
  });

  it("refuses an internal source to a public channel", async () => {
    const { service, sent } = setup({}, [row()]);
    await assert.rejects(
      service.markSent("c1", "o1", { to: "Hírlevél", public: true }, "u2"),
      (e: unknown) =>
        e instanceof ConflictException && /Belső forrásból/.test(e.message),
    );
    assert.equal(sent.length, 0);
    const pub = setup({}, [row({ audience: "PUBLIC" })]);
    await pub.service.markSent(
      "c1",
      "o1",
      { to: "Hírlevél", public: true },
      "u2",
    );
    assert.equal(pub.sent.length, 1);
  });

  it("refuses a stale, a withdrawn, an already sent output, and says a lost race", async () => {
    for (const [state, r] of [
      [{ version: 3, approvedVersion: 3 }, row()],
      [{ approvedVersion: null, itemState: "AWAITING_REVISION" }, row()],
      [{}, row({ sentAt: NOW, sentTo: "x", sentPublic: false })],
    ] as const) {
      const { service, sent } = setup(state, [r]);
      await assert.rejects(
        service.markSent("c1", "o1", { to: "x", public: false }, "u2"),
        ConflictException,
        JSON.stringify(state),
      );
      assert.equal(sent.length, 0);
    }
    const race = setup({}, [row()], false);
    await assert.rejects(
      race.service.markSent("c1", "o1", { to: "x", public: false }, "u2"),
      ConflictException,
    );
  });

  it("refuses a malformed record and an unknown output", async () => {
    const { service } = setup({}, [row()]);
    for (const bad of [
      {},
      { to: "", public: false },
      { to: "x" },
      { to: "x", public: false, extra: 1 },
    ])
      await assert.rejects(
        service.markSent("c1", "o1", bad, "u2"),
        BadRequestException,
      );
    await assert.rejects(
      service.markSent("c1", "nincs", { to: "x", public: false }, "u2"),
      NotFoundException,
    );
  });
});
