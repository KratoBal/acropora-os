import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "reflect-metadata";
import { HttpStatus } from "@nestjs/common";
import {
  conclusionInputs,
  FIXTURE_QUANTITIES,
  T12_CONCLUSION_CASES,
  vocabularyV1,
  type PackageClaim,
} from "@acropora/knowledge-base";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import {
  ModelFlagController,
  ModelFlagService,
  type ModelFlagStore,
} from "./model-flag.controller.js";
import {
  claimFlagItem,
  conclusionFlagItem,
  FLAG_LIMITS,
  judgeFlags,
  parseFlagWrite,
  parseLimit,
  pendingItems,
  type ClaimFlagItem,
  type FlagWrite,
} from "./model-flag.js";

/**
 * THE SECOND MODEL'S FLAGS (S4, 7a 3.): the model's input is built from the
 * item and digested, a write is held to that digest, the store only appends,
 * and the right to read and to write are the knowledge rights.
 */
const vocabulary = vocabularyV1();
const USER = { id: "u-1" } as AuthenticatedUser;
const HASH = "a".repeat(64);

/** The test set's c1sci and c2hob (not exported from the package): the T12 basis claims. */
const ACROPORA_FIELD: PackageClaim["scope"] = {
  taxa: ["ACROPORA"],
  environments: ["FIELD"],
  homeReefApplicability: "LIMITED",
  quantity: { minMgL: 0.0285, maxMgL: 0.095 },
  effect: "CALCIFICATION",
  direction: "DECREASE",
  evidenceLevel: "SINGLE_EXPERIMENT",
};
const FIXTURE_CLAIMS: readonly PackageClaim[] = [
  { id: "c1sci", layer: "SCIENTIFIC", scope: ACROPORA_FIELD, citation: "Koop" },
  {
    id: "c2hob",
    layer: "HOBBY_EXPERIENCE",
    scope: {
      taxa: ["ACROPORA"],
      environments: ["HOME_AQUARIUM"],
      homeReefApplicability: "DIRECT",
      quantity: { minMgL: 0.03, maxMgL: 0.1 },
      effect: "COLORATION",
      direction: "INCREASE",
      evidenceLevel: "SINGLE_REPORT",
    },
    citation: "Holmes-Farley",
  },
];

const CLAIM = {
  id: "c1",
  effect: "CALCIFICATION",
  direction: "DECREASE",
  taxa: ["ACROPORA"],
  passages: ["Calcification decreased at 0.3 µM phosphate."],
  vocabulary,
};

const built = (r: ReturnType<typeof claimFlagItem>): ClaimFlagItem => {
  assert.ok(r.ok, JSON.stringify(r));
  return r.item;
};

describe("claimFlagItem", () => {
  it("gives the claim's fields, the effect's first form and the passages", () => {
    const item = built(claimFlagItem(CLAIM));
    assert.equal(item.targetType, "CLAIM");
    assert.deepEqual(item.claim, {
      effect: "CALCIFICATION",
      effectLabel: vocabulary.effects
        .find((t) => t.key === "CALCIFICATION")!
        .forms[0]!.join(" "),
      direction: "DECREASE",
      taxa: ["ACROPORA"],
    });
    assert.deepEqual(item.passages, CLAIM.passages);
    assert.match(item.targetHash, /^[0-9a-f]{64}$/);
  });

  it("digests every model-visible part: a change to any one is a new digest", () => {
    const base = built(claimFlagItem(CLAIM)).targetHash;
    assert.equal(built(claimFlagItem({ ...CLAIM })).targetHash, base);
    for (const changed of [
      { ...CLAIM, effect: "COLORATION" },
      { ...CLAIM, direction: "INCREASE" },
      { ...CLAIM, taxa: ["ACROPORA_MILLEPORA"] },
      { ...CLAIM, passages: [...CLAIM.passages, "Another passage."] },
      { ...CLAIM, passages: ["Calcification decreased at 0.4 µM phosphate."] },
    ])
      assert.notEqual(built(claimFlagItem(changed)).targetHash, base);
  });

  it("says why a claim cannot be given to the model, instead of dropping it", () => {
    const why = (over: Record<string, unknown>) => {
      const r = claimFlagItem({ ...CLAIM, ...over } as Parameters<
        typeof claimFlagItem
      >[0]);
      return r.ok ? "OFFERED" : r.notOffered.reason;
    };
    assert.equal(why({ effect: null }), "NO_EFFECT");
    assert.equal(why({ effect: "NOT_A_TERM" }), "EFFECT_NOT_IN_VOCABULARY");
    assert.equal(why({ direction: null }), "NO_DIRECTION");
    assert.equal(why({ taxa: [] }), "NO_TAXON");
    assert.equal(why({ passages: [] }), "NO_VERBATIM_PASSAGE");
  });
});

describe("conclusionFlagItem", () => {
  const c1 = FIXTURE_CLAIMS.find((c) => c.id === "c1sci")!;
  const planted = T12_CONCLUSION_CASES.find(
    (c) => c.id === "t12-certainty-planted",
  )!;

  it("states the basis as the T12 set does: the runner's checked input shape", () => {
    const r = conclusionFlagItem({
      id: "k1",
      text: planted.text,
      basis: [{ claim: c1, quantity: FIXTURE_QUANTITIES.c1sci! }],
      vocabulary,
    });
    assert.ok(r.ok);
    const t12 = conclusionInputs(vocabulary, [planted]).inputs[0]!;
    assert.deepEqual(
      { conclusion: r.item.conclusion, basis: r.item.basis },
      { conclusion: t12.conclusion, basis: t12.basis },
    );
  });

  it("a new text or a new basis is a new digest", () => {
    const hash = (text: string, ids: string[]) => {
      const r = conclusionFlagItem({
        id: "k1",
        text,
        basis: ids.map((id) => ({
          claim: FIXTURE_CLAIMS.find((c) => c.id === id)!,
          quantity: FIXTURE_QUANTITIES[id] ?? null,
        })),
        vocabulary,
      });
      assert.ok(r.ok);
      return r.item.targetHash;
    };
    const base = hash(planted.text, ["c1sci"]);
    assert.notEqual(hash(`${planted.text} `, ["c1sci"]), base);
    assert.notEqual(hash(planted.text, ["c1sci", "c2hob"]), base);
  });

  it("names the claim whose statement fails, and a conclusion without a basis", () => {
    const noLevel = {
      ...c1,
      id: "cx",
      scope: { ...c1.scope, evidenceLevel: null },
    };
    const r = conclusionFlagItem({
      id: "k1",
      text: "Szöveg.",
      basis: [{ claim: noLevel, quantity: null }],
      vocabulary,
    });
    assert.deepEqual(r.ok ? null : r.notOffered, {
      targetId: "k1",
      reason: "BASIS_NOT_STATED",
      detail: { claimId: "cx", failure: "NO_EVIDENCE_LEVEL" },
    });
    const none = conclusionFlagItem({
      id: "k2",
      text: "Szöveg.",
      basis: [],
      vocabulary,
    });
    assert.equal(none.ok ? null : none.notOffered.reason, "NO_BASIS");
  });
});

describe("pendingItems", () => {
  const item = (id: string, hash: string) => ({
    ...built(claimFlagItem(CLAIM)),
    targetId: id,
    targetHash: hash,
  });

  it("keeps an item whose CURRENT digest has no flag, in id order, up to the limit", () => {
    const items = [item("c3", "h3"), item("c1", "h1"), item("c2", "h2new")];
    const stored = new Map([
      ["c1", new Set(["h1"])],
      ["c2", new Set(["h2old"])],
    ]);
    const r = pendingItems(items, stored, 1);
    assert.deepEqual(
      { ids: r.items.map((i) => i.targetId), total: r.total },
      { ids: ["c2"], total: 2 },
    );
  });
});

describe("parseFlagWrite", () => {
  const VALID = {
    source: "gpt-runner",
    runId: "t13-2026-11-01T11:00:00Z",
    model: "gpt-5.1",
    promptSha256: HASH,
    flags: [
      { targetType: "CLAIM", targetId: "c1", targetHash: HASH, flagged: true },
    ],
  };

  it("takes a run and its flags", () => {
    assert.deepEqual(parseFlagWrite(VALID), { ok: true, value: VALID });
  });

  it("refuses a bad shape, an unknown target, a duplicate item and too many flags", () => {
    const flag = VALID.flags[0]!;
    for (const body of [
      null,
      { ...VALID, source: "GPT Runner" },
      { ...VALID, promptSha256: "abc" },
      { ...VALID, runId: "" },
      { ...VALID, flags: [] },
      { ...VALID, flags: [{ ...flag, targetType: "ARTICLE" }] },
      { ...VALID, flags: [{ ...flag, flagged: "true" }] },
      { ...VALID, flags: [{ ...flag, targetHash: HASH.toUpperCase() }] },
      { ...VALID, flags: [flag, { ...flag, flagged: false }] },
      {
        ...VALID,
        flags: Array.from({ length: FLAG_LIMITS.perRequest + 1 }, (_, i) => ({
          ...flag,
          targetId: `c${i}`,
        })),
      },
    ])
      assert.equal(
        parseFlagWrite(body).ok,
        false,
        JSON.stringify(body)?.slice(0, 120),
      );
  });

  it("the limit is 1 to the runner's maximum, 40 by default", () => {
    assert.equal(parseLimit(undefined), FLAG_LIMITS.defaultPending);
    assert.equal(parseLimit("50"), 50);
    for (const bad of ["0", "51", "-1", "1e1", "x"])
      assert.equal(parseLimit(bad), null, bad);
  });
});

describe("judgeFlags", () => {
  const write = (flags: FlagWrite["flags"]): FlagWrite => ({
    source: "gpt-runner",
    runId: "r1",
    model: "m",
    promptSha256: HASH,
    flags,
  });
  const f = (targetId: string, targetHash: string, flagged = true) => ({
    targetType: "CLAIM" as const,
    targetId,
    targetHash,
    flagged,
  });
  const current = (_t: string, id: string) =>
    ({ c1: "h1", c2: "h2", c3: "h3" })[id] ?? null;

  it("writes a current item, refuses an unknown or edited one", () => {
    const r = judgeFlags(
      write([f("c1", "h1"), f("cX", "h1"), f("c2", "h2old")]),
      current,
      new Map(),
    );
    assert.deepEqual(r, {
      toWrite: [f("c1", "h1")],
      alreadyWritten: 0,
      rejected: [
        { targetType: "CLAIM", targetId: "cX", reason: "UNKNOWN_TARGET" },
        { targetType: "CLAIM", targetId: "c2", reason: "STALE_HASH" },
      ],
    });
  });

  it("a retry of the same run is a no-op; another verdict in the same run is refused", () => {
    const r = judgeFlags(
      write([f("c1", "h1", true), f("c2", "h2", true)]),
      current,
      new Map([
        ["CLAIM:c1", true],
        ["CLAIM:c2", false],
      ]),
    );
    assert.deepEqual(r, {
      toWrite: [],
      alreadyWritten: 1,
      rejected: [
        { targetType: "CLAIM", targetId: "c2", reason: "OTHER_VERDICT_IN_RUN" },
      ],
    });
  });
});

describe("ModelFlagController", () => {
  it("reads with knowledge.view, writes with knowledge.manage", () => {
    const proto = ModelFlagController.prototype;
    const perms = (handler: unknown) =>
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler as object);
    assert.deepEqual(perms(proto.pending), [PERMISSIONS.KNOWLEDGE_VIEW]);
    assert.deepEqual(perms(proto.latest), [PERMISSIONS.KNOWLEDGE_VIEW]);
    assert.deepEqual(perms(proto.write), [PERMISSIONS.KNOWLEDGE_MANAGE]);
  });

  it("has no update or delete route: the flags only grow", () => {
    const routes = Object.getOwnPropertyNames(ModelFlagController.prototype)
      .filter((k) => k !== "constructor")
      .sort();
    assert.deepEqual(routes, ["latest", "pending", "write"]);
  });
});

describe("ModelFlagService", () => {
  const status = async (p: Promise<unknown>) =>
    p.then(
      () => 200,
      (e: { getStatus?: () => number }) => e.getStatus?.() ?? 0,
    );
  const asked: string[] = [];
  const store: ModelFlagStore = {
    pending: async (t, limit) => {
      asked.push(`pending ${t} ${limit}`);
      return { targetType: t, items: [], total: 0, notOffered: [] };
    },
    write: async () => {
      asked.push("write");
      return { runId: "r", written: 0, alreadyWritten: 0, rejected: [] };
    },
    latest: async () => {
      asked.push("latest");
      return {};
    },
  };
  const service = new ModelFlagService({
    store,
    approvedVocabulary: async () => vocabulary,
  });

  it("answers 400 on a bad query or body before the store is asked", async () => {
    asked.length = 0;
    assert.equal(await status(service.pending({})), HttpStatus.BAD_REQUEST);
    assert.equal(
      await status(service.pending({ targetType: "CLAIM", limit: "99" })),
      HttpStatus.BAD_REQUEST,
    );
    assert.equal(await status(service.write({}, USER)), HttpStatus.BAD_REQUEST);
    assert.equal(
      await status(service.latest({ targetType: "CLAIM", ids: "a,b c" })),
      HttpStatus.BAD_REQUEST,
    );
    assert.deepEqual(asked, []);
  });

  it("passes a good query through with the default limit", async () => {
    asked.length = 0;
    await service.pending({ targetType: "CONCLUSION" });
    assert.deepEqual(asked, [
      `pending CONCLUSION ${FLAG_LIMITS.defaultPending}`,
    ]);
  });
});
