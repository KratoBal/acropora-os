import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "reflect-metadata";

import { HttpStatus } from "@nestjs/common";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type AuthenticatedUser,
} from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { SourceScreeningController } from "./source-screening.controller.js";
import {
  parseScreeningDecision,
  parseSourceListQuery,
  parseStudyTypeDecision,
} from "./source-screening.js";
import {
  SourceClassifyRefused,
  SourceNotFound,
} from "./source-screening.repository.js";
import {
  SourceScreeningService,
  type SourceScreeningStore,
} from "./source-screening.service.js";

/**
 * SOURCE SCREENING, WITHOUT A DATABASE (S4). WHAT TURNS IT RED: an exclusion
 * without a reason, "other" without a note, a reason on an inclusion, a
 * filter guessed instead of refused, the decision route without
 * knowledge.manage, or a MANAGER who may decide.
 */
describe("the list's query", () => {
  it("defaults to what waits for a decision, the first page of 25", () => {
    const q = parseSourceListQuery({});
    assert.ok(q.ok);
    assert.deepEqual(q.value, {
      status: "PENDING",
      kind: null,
      yearFrom: null,
      yearTo: null,
      openAccess: null,
      page: 1,
      pageSize: 25,
    });
  });

  it("reads every filter, ALL as no status", () => {
    const q = parseSourceListQuery({
      status: "ALL",
      kind: "REVIEW",
      yearFrom: "2010",
      yearTo: "2020",
      openAccess: "true",
      page: "3",
      pageSize: "50",
    });
    assert.ok(q.ok);
    assert.deepEqual(
      [
        q.value.status,
        q.value.kind,
        q.value.yearFrom,
        q.value.yearTo,
        q.value.openAccess,
        q.value.page,
        q.value.pageSize,
      ],
      [null, "REVIEW", 2010, 2020, true, 3, 50],
    );
  });

  it("lists every bad filter at once, guessing none", () => {
    const q = parseSourceListQuery({
      status: "MAYBE",
      kind: "NOVEL",
      yearFrom: "2020",
      yearTo: "2010",
      openAccess: "yes",
      pageSize: "500",
    });
    assert.ok(!q.ok);
    assert.equal(q.problems.length, 5);
  });
});

describe("the decision's body", () => {
  it("include, exclude with a reason, reset", () => {
    assert.deepEqual(parseScreeningDecision({ decision: "INCLUDE" }), {
      ok: true,
      value: { status: "INCLUDED", reason: null, note: null },
    });
    assert.deepEqual(
      parseScreeningDecision({
        decision: "EXCLUDE",
        reason: "NOT_MARINE",
        note: "  édesvízi  ",
      }),
      {
        ok: true,
        value: { status: "EXCLUDED", reason: "NOT_MARINE", note: "édesvízi" },
      },
    );
    assert.deepEqual(parseScreeningDecision({ decision: "RESET", note: "x" }), {
      ok: true,
      value: { status: "PENDING", reason: null, note: null },
    });
  });

  it("refuses an exclusion without a reason, 'other' without a note, a reason on an inclusion", () => {
    for (const body of [
      { decision: "EXCLUDE" },
      { decision: "EXCLUDE", reason: "BORING" },
      { decision: "EXCLUDE", reason: "OTHER" },
      { decision: "EXCLUDE", reason: "OTHER", note: "   " },
      { decision: "INCLUDE", reason: "NOT_CORAL" },
      { decision: "EXCLUDE", reason: "NOT_CORAL", note: "x".repeat(501) },
      { decision: "MAYBE" },
      null,
    ])
      assert.equal(
        parseScreeningDecision(body).ok,
        false,
        JSON.stringify(body),
      );
  });
});

describe("the study type's body (research-diagram-irany)", () => {
  it("a listed type and a note; the control group is said or left unsaid, never guessed", () => {
    assert.deepEqual(
      parseStudyTypeDecision({
        studyType: "CONTROLLED_LAB",
        note: "  Methods: tank experiment, three phosphate levels ",
      }),
      {
        ok: true,
        value: {
          studyType: "CONTROLLED_LAB",
          controlled: null,
          note: "Methods: tank experiment, three phosphate levels",
        },
      },
    );
    const withControl = parseStudyTypeDecision({
      studyType: "FIELD_EXPERIMENT",
      controlled: true,
      note: "x",
    });
    assert.ok(withControl.ok && withControl.value.controlled === true);
  });

  it("refuses an unknown type, a note left out, a control group not a boolean, all at once", () => {
    const r = parseStudyTypeDecision({
      studyType: "EXPERIMENT",
      controlled: "yes",
    });
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.deepEqual(
      r.problems.map((p) => p.split(":")[0]),
      ["studyType", "controlled", "note"],
    );
    assert.equal(
      parseStudyTypeDecision({ studyType: "REVIEW", note: "x".repeat(501) }).ok,
      false,
    );
  });
});

describe("the screening service and its routes", () => {
  const USER = { id: "u-1" } as AuthenticatedUser;
  const status = async (p: Promise<unknown>) =>
    p.then(
      () => 200,
      (e: { getStatus?: () => number }) => e.getStatus?.() ?? 0,
    );
  const fake = (over: Partial<SourceScreeningStore> = {}) => {
    const calls: unknown[][] = [];
    const store: SourceScreeningStore = {
      list: async (q) => {
        calls.push(["list", q]);
        return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
      },
      summary: async () => {
        throw new Error("not used");
      },
      decide: async (id, decision, actor) => {
        calls.push(["decide", id, decision, actor]);
        return {} as never;
      },
      classify: async (id, decision, actor) => {
        calls.push(["classify", id, decision, actor]);
        return {} as never;
      },
      ...over,
    };
    return { svc: new SourceScreeningService(store), calls };
  };

  it("a bad query or body is a 400, before the store", async () => {
    const t = fake();
    assert.equal(
      await status(t.svc.list({ status: "MAYBE" })),
      HttpStatus.BAD_REQUEST,
    );
    assert.equal(
      await status(t.svc.decide("s1", { decision: "EXCLUDE" }, USER)),
      HttpStatus.BAD_REQUEST,
    );
    assert.deepEqual(t.calls, []);
  });

  it("a decision goes to the store with the caller as the actor; an unknown source is a 404", async () => {
    const t = fake();
    await t.svc.decide("s1", { decision: "INCLUDE" }, USER);
    assert.deepEqual(t.calls, [
      ["decide", "s1", { status: "INCLUDED", reason: null, note: null }, "u-1"],
    ]);
    const missing = fake({
      decide: async (id) => {
        throw new SourceNotFound(id);
      },
    });
    assert.equal(
      await status(missing.svc.decide("x", { decision: "INCLUDE" }, USER)),
      HttpStatus.NOT_FOUND,
    );
  });

  it("a classification goes to the store with the caller; a bad body is a 400 before it, a refusal a 409 in the editor's words", async () => {
    const t = fake();
    assert.equal(
      await status(t.svc.classify("s1", { studyType: "REVIEW" }, USER)),
      HttpStatus.BAD_REQUEST,
    );
    assert.deepEqual(t.calls, []);
    await t.svc.classify("s1", { studyType: "REVIEW", note: "review" }, USER);
    assert.deepEqual(t.calls, [
      [
        "classify",
        "s1",
        { studyType: "REVIEW", controlled: null, note: "review" },
        "u-1",
      ],
    ]);
    for (const code of [
      "NOT_INCLUDED",
      "RETRACTED",
      "ALREADY_CLASSIFIED",
      "PENDING_ANCHOR",
    ] as const) {
      const refused = fake({
        classify: async () => {
          throw new SourceClassifyRefused(code);
        },
      });
      await assert.rejects(
        refused.svc.classify("s1", { studyType: "REVIEW", note: "x" }, USER),
        (e: { getStatus?: () => number; message: string }) =>
          e.getStatus?.() === HttpStatus.CONFLICT &&
          e.message === new SourceClassifyRefused(code).message,
      );
    }
    const missing = fake({
      classify: async (id) => {
        throw new SourceNotFound(id);
      },
    });
    assert.equal(
      await status(
        missing.svc.classify("x", { studyType: "REVIEW", note: "x" }, USER),
      ),
      HttpStatus.NOT_FOUND,
    );
  });

  it("reading needs knowledge.view, deciding knowledge.manage", () => {
    const proto = SourceScreeningController.prototype;
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto.list),
      [PERMISSIONS.KNOWLEDGE_VIEW],
    );
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto.summary),
      [PERMISSIONS.KNOWLEDGE_VIEW],
    );
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto.decide),
      [PERMISSIONS.KNOWLEDGE_MANAGE],
    );
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto.classify),
      [PERMISSIONS.KNOWLEDGE_MANAGE],
    );
  });

  it("knowledge.manage is OWNER and ADMIN only; a MANAGER reads but does not decide", () => {
    const holders = (p: string) =>
      Object.entries(ROLE_PERMISSIONS)
        .filter(([, perms]) => (perms as readonly string[]).includes(p))
        .map(([role]) => role)
        .sort();
    assert.deepEqual(holders(PERMISSIONS.KNOWLEDGE_MANAGE), ["ADMIN", "OWNER"]);
    assert.deepEqual(holders(PERMISSIONS.KNOWLEDGE_VIEW), [
      "ADMIN",
      "MANAGER",
      "OWNER",
    ]);
  });
});
