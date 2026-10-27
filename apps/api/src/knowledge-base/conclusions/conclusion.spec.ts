import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "reflect-metadata";
import { HttpStatus } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import {
  ConclusionController,
  ConclusionService,
  type ConclusionStore,
} from "./conclusion.controller.js";
import {
  CONCLUSION_LIMITS,
  parseConclusionInput,
  parseReason,
} from "./conclusion.js";
import {
  ConclusionConflict,
  ConclusionNotFound,
  type ConclusionView,
} from "./conclusion.repository.js";

/**
 * OWN CONCLUSIONS (S5): a conclusion always stands on claims, a draft is the
 * only thing that changes, and approving or withdrawing one is the approver's
 * right, not the editor's.
 */
const USER = { id: "u-1" } as AuthenticatedUser;
const VALID = { text: "Következtetés.", reasoning: "Mert.", claimIds: ["c1"] };

const status = async (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { getStatus?: () => number }) => e.getStatus?.() ?? 0,
  );

describe("parseConclusionInput", () => {
  it("takes text, reasoning and the claims, trimmed and deduplicated", () => {
    assert.deepEqual(
      parseConclusionInput({
        text: "  Szöveg ",
        reasoning: " Ok ",
        claimIds: ["a", "b", "a"],
      }),
      {
        ok: true,
        value: { text: "Szöveg", reasoning: "Ok", claimIds: ["a", "b"] },
      },
    );
  });

  it("refuses a conclusion without a claim, a text or a reasoning", () => {
    for (const body of [
      { ...VALID, claimIds: [] },
      { ...VALID, claimIds: "c1" },
      { ...VALID, claimIds: [""] },
      { ...VALID, text: " " },
      { ...VALID, reasoning: undefined },
      null,
    ])
      assert.equal(parseConclusionInput(body).ok, false, JSON.stringify(body));
  });

  it("bounds the text and the number of claims", () => {
    assert.equal(
      parseConclusionInput({
        ...VALID,
        text: "x".repeat(CONCLUSION_LIMITS.text + 1),
      }).ok,
      false,
    );
    assert.equal(
      parseConclusionInput({
        ...VALID,
        claimIds: Array.from(
          { length: CONCLUSION_LIMITS.claims + 1 },
          (_, i) => `c${i}`,
        ),
      }).ok,
      false,
    );
  });

  it("requires a reason to withdraw", () => {
    assert.equal(parseReason({ reason: " " }).ok, false);
    assert.deepEqual(parseReason({ reason: " elavult " }), {
      ok: true,
      value: "elavult",
    });
  });
});

describe("ConclusionService", () => {
  const conclusion = { id: "k1", status: "DRAFT" } as ConclusionView;
  const store = (fail?: Error): ConclusionStore => {
    const run = async () => {
      if (fail) throw fail;
      return conclusion;
    };
    return {
      list: async () => [conclusion],
      detail: run,
      create: run,
      update: run,
      approve: run,
      withdraw: run,
    };
  };

  it("answers 400 on a bad input before the repository is asked", async () => {
    let asked = false;
    const s = new ConclusionService({
      ...store(),
      create: async () => {
        asked = true;
        return conclusion;
      },
    });
    assert.equal(await status(s.create({}, USER)), HttpStatus.BAD_REQUEST);
    assert.equal(asked, false);
  });

  it("maps a missing conclusion to 404 and a state conflict to 409", async () => {
    assert.equal(
      await status(
        new ConclusionService(store(new ConclusionNotFound("k"))).approve(
          "k",
          USER,
        ),
      ),
      HttpStatus.NOT_FOUND,
    );
    assert.equal(
      await status(
        new ConclusionService(
          store(new ConclusionConflict("nem tervezet")),
        ).update("k", VALID, USER),
      ),
      HttpStatus.CONFLICT,
    );
  });

  it("passes the caller as the actor", async () => {
    let actor = "";
    const s = new ConclusionService({
      ...store(),
      withdraw: async (_id, _reason, userId) => {
        actor = userId;
        return conclusion;
      },
    });
    await s.withdraw("k1", { reason: "elavult" }, USER);
    assert.equal(actor, "u-1");
  });
});

describe("ConclusionController permissions", () => {
  const proto = ConclusionController.prototype;
  const of = (handler: unknown) =>
    Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler as object);

  it("reads with knowledge.view", () => {
    for (const handler of [proto.list, proto.detail])
      assert.deepEqual(of(handler), [PERMISSIONS.KNOWLEDGE_VIEW]);
  });

  it("writes a draft with knowledge.manage", () => {
    for (const handler of [proto.create, proto.update])
      assert.deepEqual(of(handler), [PERMISSIONS.KNOWLEDGE_MANAGE]);
  });

  it("approves and withdraws only with knowledge.approve", () => {
    for (const handler of [proto.approve, proto.withdraw])
      assert.deepEqual(of(handler), [PERMISSIONS.KNOWLEDGE_APPROVE]);
  });
});
