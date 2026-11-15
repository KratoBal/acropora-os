import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type {
  TeachingSourceDetail,
  TeachingSourceDocument,
  TeachingSourceInput,
} from "@acropora/types";

import {
  teachingApprovalBlock,
  teachingSourceHash,
  type TeachingSourceRepository,
  type TeachingSourceSaveOutcome,
} from "./teaching-source.repository.js";
import { TeachingSourceService } from "./teaching-source.service.js";

/*
  THE TEACHING SOURCE SERVICE (T5.2). What turns these red: a source stored
  whose text refers to a number, a form or a spoken form that does not exist,
  or uses a part's number in another part; an outcome of the store said wrongly
  (a stale save or an edit after approval must be a 409, not a 200); an open
  question that blocks the save (it must only block the approval); an approval
  let through with an open question or a broken reference; a hash that changes
  with the order of the keys (the stored JSON comes back in another order).
*/

const number = (id: string, over: Record<string, unknown> = {}) => ({
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

const body = (over: Record<string, unknown> = {}) => ({
  baseVersion: null,
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
      text: "Adag: {szám: adag, rövid}.",
      subparts: [],
      checklist: [],
      speakerNote: null,
    },
  ],
  numbers: [number("adag")],
  ...over,
});

function setup(
  outcome: TeachingSourceSaveOutcome = {
    kind: "ok",
    version: 1,
    changed: true,
  },
) {
  const saved: TeachingSourceInput[] = [];
  const repository = {
    detail: async () => null,
    editable: async () => true,
    save: async (_id: string, input: TeachingSourceInput) => {
      saved.push(input);
      return outcome;
    },
  } as unknown as TeachingSourceRepository;
  return { service: new TeachingSourceService(repository), saved };
}

describe("TeachingSourceService.save", () => {
  it("stores a source whose text and table agree", async () => {
    const { service, saved } = setup();
    await service.save("c1", body(), "u1");
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.numbers[0]?.id, "adag");
  });

  it("refuses a malformed input before the store", async () => {
    const { service, saved } = setup();
    await assert.rejects(
      service.save("c1", body({ extra: 1 }), "u1"),
      BadRequestException,
    );
    assert.equal(saved.length, 0);
  });

  it("refuses a text that does not match the table, naming each reference", async () => {
    const { service, saved } = setup();
    await assert.rejects(
      service.save(
        "c1",
        body({
          parts: [
            {
              key: "elso",
              title: "Első",
              text: "{szám: nincs} és {szám: adag, kimondott}",
              subparts: [],
              checklist: [],
              speakerNote: null,
            },
          ],
        }),
        "u1",
      ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /nincs/.test(error.message) &&
        /kimondott alakja/.test(error.message),
    );
    assert.equal(saved.length, 0);
  });

  it("stores a contradicting number: the open question stops the approval, not the save", async () => {
    const { service, saved } = setup();
    await service.save(
      "c1",
      body({
        numbers: [
          number("adag", { name: "Ciklus" }),
          number("masik", {
            name: "Ciklus",
            quantity: { value: { kind: "exact", value: 2 }, unit: "ml" },
          }),
        ],
      }),
      "u1",
    );
    assert.equal(saved.length, 1);
  });

  it("says each store outcome as its status", async () => {
    for (const [outcome, type] of [
      [{ kind: "missing" }, NotFoundException],
      [{ kind: "not-teaching-source" }, ConflictException],
      [{ kind: "not-editable" }, ConflictException],
      [{ kind: "stale", currentVersion: 3 }, ConflictException],
      [{ kind: "stale", currentVersion: null }, ConflictException],
    ] as const) {
      const { service } = setup(outcome as TeachingSourceSaveOutcome);
      await assert.rejects(
        service.save("c1", body(), "u1"),
        type,
        outcome.kind,
      );
    }
  });
});

describe("TeachingSourceService.get", () => {
  it("returns the source with its analysis, or nulls before the first save", async () => {
    const { service } = setup();
    assert.deepEqual(await service.get("c1"), {
      source: null,
      analysis: null,
      editable: true,
    });
    const detail = {
      ...(body() as unknown as TeachingSourceDocument),
      contentId: "c1",
      version: 2,
      contentHash: "h",
      approvedVersion: null,
      versions: [],
      updatedAt: "2026-11-15T08:00:00.000Z",
    } as TeachingSourceDetail;
    const repository = {
      detail: async () => detail,
      editable: async () => false,
    } as unknown as TeachingSourceRepository;
    const data = await new TeachingSourceService(repository).get("c1");
    assert.equal(data.editable, false);
    assert.deepEqual(data.analysis?.usages, [
      {
        numberId: "adag",
        locations: [
          { partKey: "elso", subpartKey: null, field: "text", index: null },
        ],
      },
    ]);
  });
});

describe("teachingApprovalBlock", () => {
  const doc = (numbers: unknown[], text = "{szám: a}") =>
    ({
      parts: [
        {
          key: "p",
          title: "P",
          text,
          subparts: [],
          checklist: [],
          speakerNote: null,
        },
      ],
      numbers,
    }) as unknown as Pick<TeachingSourceDocument, "parts" | "numbers">;

  it("lets a clean source through", () => {
    assert.equal(teachingApprovalBlock(doc([number("a")])), null);
  });

  it("stops an open question, marked or contradicting, and names the numbers", () => {
    const marked = teachingApprovalBlock(
      doc([number("a", { state: "OPEN_QUESTION" })]),
    );
    assert.match(marked ?? "", /nyitott kérdés.*\(a\)/);
    const conflict = teachingApprovalBlock(
      doc([
        number("a", { name: "X" }),
        number("b", { name: "X", approx: true }),
      ]),
    );
    assert.match(conflict ?? "", /\(a, b\)/);
  });

  it("stops a broken reference even if it reached the store", () => {
    assert.match(
      teachingApprovalBlock(doc([number("a")], "{szám: b}")) ?? "",
      /hibás/,
    );
  });
});

describe("teachingSourceHash", () => {
  const source = body() as unknown as TeachingSourceDocument;

  it("does not depend on the order of the keys", () => {
    const shuffled = {
      ...Object.fromEntries(Object.entries(source).reverse()),
      numbers: source.numbers.map((n) =>
        Object.fromEntries(Object.entries(n).reverse()),
      ),
    } as unknown as TeachingSourceDocument;
    assert.equal(
      teachingSourceHash("Cím", shuffled),
      teachingSourceHash("Cím", source),
    );
  });

  it("changes with the title, a header field, a number", () => {
    const base = teachingSourceHash("Cím", source);
    assert.notEqual(teachingSourceHash("Más cím", source), base);
    assert.notEqual(
      teachingSourceHash("Cím", { ...source, disclaimer: "Kitétel" }),
      base,
    );
    assert.notEqual(
      teachingSourceHash("Cím", {
        ...source,
        numbers: source.numbers.map((n) => ({ ...n, short: "2 ml" })),
      }),
      base,
    );
  });
});
