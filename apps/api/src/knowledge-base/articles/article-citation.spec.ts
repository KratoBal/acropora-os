import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "reflect-metadata";
import { HttpStatus } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { claimScope, type ScopeRow } from "../claims/claim-store.js";
import {
  ArticleCitationController,
  ArticleCitationService,
  type ArticleCitationStore,
} from "./article-citation.controller.js";
import {
  approvalBlockMessage,
  articleText,
  parseAnswerInput,
  parseCitationInput,
  sentenceHash,
} from "./article-citation.js";
import {
  ArticleCitationConflict,
  ArticleCitationInvalid,
  ArticleCitationNotFound,
  type ArticleCitationReport,
} from "./article-citation.repository.js";

/**
 * AN ARTICLE'S CITATIONS (S5): one target per citation, a reason for every
 * "not technical" mark and every answered warning, the scope the sentence
 * check reads never wider than the weakest supporting row, and every write
 * behind knowledge.manage.
 */
const USER = { id: "u-1" } as AuthenticatedUser;

const status = async (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { getStatus?: () => number }) => e.getStatus?.() ?? 0,
  );

describe("parseCitationInput", () => {
  it("takes a claim citation with the sentence normalised", () => {
    assert.deepEqual(
      parseCitationInput({
        sentence: "  Egy \n mondat. ",
        kind: "CLAIM",
        claimId: "c1",
      }),
      {
        ok: true,
        value: { sentence: "Egy mondat.", kind: "CLAIM", targetId: "c1" },
      },
    );
  });

  it("refuses two targets, a target-less citation and a reason on a citation", () => {
    for (const body of [
      { sentence: "M.", kind: "CLAIM", claimId: "c1", conclusionId: "k1" },
      { sentence: "M.", kind: "CONCLUSION" },
      { sentence: "M.", kind: "CLAIM", claimId: "c1", reason: "mert" },
      {
        sentence: "M.",
        kind: "NOT_TECHNICAL",
        reason: "bevezető",
        claimId: "c1",
      },
      { sentence: "M.", kind: "OTHER", claimId: "c1" },
      { sentence: " ", kind: "CLAIM", claimId: "c1" },
    ])
      assert.equal(parseCitationInput(body).ok, false, JSON.stringify(body));
  });

  it("requires the reason of a not-technical mark", () => {
    assert.equal(
      parseCitationInput({ sentence: "M.", kind: "NOT_TECHNICAL" }).ok,
      false,
    );
    assert.deepEqual(
      parseCitationInput({
        sentence: "M.",
        kind: "NOT_TECHNICAL",
        reason: " bevezető ",
      }),
      {
        ok: true,
        value: { sentence: "M.", kind: "NOT_TECHNICAL", reason: "bevezető" },
      },
    );
  });
});

describe("parseAnswerInput", () => {
  it("takes the codes as the check wrote them, with a reason", () => {
    assert.deepEqual(
      parseAnswerInput({
        codes: ["QUANTITY_OUT_OF_RANGE", "QUANTITY_OUT_OF_RANGE"],
        reason: "ok",
      }),
      { ok: true, value: { codes: ["QUANTITY_OUT_OF_RANGE"], reason: "ok" } },
    );
  });

  it("refuses an answer without a reason or without a code", () => {
    assert.equal(parseAnswerInput({ codes: ["X"] }).ok, false);
    assert.equal(parseAnswerInput({ codes: [], reason: "ok" }).ok, false);
    assert.equal(
      parseAnswerInput({ codes: ["not a code"], reason: "ok" }).ok,
      false,
    );
  });
});

describe("approvalBlockMessage", () => {
  const counts = {
    sentences: 3,
    uncited: 1,
    invalid: 0,
    unansweredWarnings: 2,
    orphaned: 0,
  };

  it("names each count that blocks", () => {
    assert.match(
      approvalBlockMessage({ counts, blockers: [] }),
      /\(1 hivatkozás nélküli mondat, 2 megválaszolatlan figyelmeztetés\)/,
    );
  });

  it("names a blocker it does not know, never an empty list", () => {
    const message = approvalBlockMessage({
      counts: { ...counts, uncited: 0, unansweredWarnings: 0 },
      blockers: ["VOCABULARY_SOMETHING_NEW"],
    });
    assert.match(
      message,
      /\(a szótár-ellenőrzés nem futhat \(VOCABULARY_SOMETHING_NEW\)\)/,
    );
    assert.doesNotMatch(message, /\(\)/);
  });
});

describe("articleText and sentenceHash", () => {
  it("reads the title, the lead and the body, one block each", () => {
    assert.equal(
      articleText({
        title: "Cím?",
        excerpt: "",
        bodyHtml: "<p>Első.</p><ul><li><p>tétel</p></li></ul>",
      }),
      "Cím?\n\nElső.\n\n- tétel",
    );
  });

  it("hashes the normalised sentence", () => {
    assert.equal(sentenceHash(" Egy  mondat. "), sentenceHash("Egy mondat."));
    assert.notEqual(sentenceHash("Egy mondat."), sentenceHash("Egy mondat!"));
  });
});

describe("claimScope", () => {
  const row = (over: Partial<ScopeRow> = {}): ScopeRow => ({
    stance: "SUPPORTS",
    species: ["ACROPORA"],
    environment: "FIELD",
    applicability: "DIRECT",
    retracted: false,
    ...over,
  });
  const scope = (
    rows: ScopeRow[],
    min: number | null = 0.03,
    max: number | null = 0.09,
  ) =>
    claimScope({
      rows,
      normalizedMinMgL: min,
      normalizedMaxMgL: max,
      effect: "CALCIFICATION",
      direction: "DECREASE",
      evidenceLevel: "SINGLE_EXPERIMENT",
    });

  it("reads only the supporting rows on sources not retracted", () => {
    const s = scope([
      row(),
      row({
        stance: "CONTRADICTS",
        species: ["MONTIPORA"],
        environment: "LAB",
      }),
      row({
        retracted: true,
        species: ["POCILLOPORA"],
        environment: "MESOCOSM",
      }),
    ]);
    assert.deepEqual(s.taxa, ["ACROPORA"]);
    assert.deepEqual(s.environments, ["FIELD"]);
  });

  it("takes the most restrictive applicability, and none when a row is undecided", () => {
    assert.equal(
      scope([row(), row({ applicability: "LIMITED" })]).homeReefApplicability,
      "LIMITED",
    );
    assert.equal(
      scope([row(), row({ applicability: null })]).homeReefApplicability,
      null,
    );
  });

  it("leaves an open side of the range unbounded, and no range without a value", () => {
    assert.deepEqual(scope([row()], null, 0.09).quantity, {
      minMgL: 0,
      maxMgL: 0.09,
    });
    assert.deepEqual(scope([row()], 0.03, null).quantity, {
      minMgL: 0.03,
      maxMgL: Number.POSITIVE_INFINITY,
    });
    assert.equal(scope([row()], null, null).quantity, null);
  });
});

describe("ArticleCitationService", () => {
  const report = { contentId: "a1", clean: false } as ArticleCitationReport;
  const store = (fail?: Error): ArticleCitationStore => {
    const run = async () => {
      if (fail) throw fail;
      return report;
    };
    return { report: run, add: run, remove: run, answer: run };
  };

  it("answers 400 on a bad input before the repository is asked", async () => {
    let asked = false;
    const s = new ArticleCitationService({
      ...store(),
      add: async () => {
        asked = true;
        return report;
      },
    });
    assert.equal(
      await status(s.add("a1", { sentence: "M.", kind: "CLAIM" }, USER)),
      HttpStatus.BAD_REQUEST,
    );
    assert.equal(asked, false);
  });

  it("maps the repository's refusals", async () => {
    const cases: [Error, number][] = [
      [new ArticleCitationNotFound("nincs"), HttpStatus.NOT_FOUND],
      [new ArticleCitationInvalid("nincs a szövegben"), HttpStatus.BAD_REQUEST],
      [new ArticleCitationConflict("nem szerkeszthető"), HttpStatus.CONFLICT],
    ];
    for (const [error, code] of cases)
      assert.equal(
        await status(
          new ArticleCitationService(store(error)).add(
            "a1",
            { sentence: "M.", kind: "CLAIM", claimId: "c1" },
            USER,
          ),
        ),
        code,
        error.name,
      );
  });
});

describe("ArticleCitationController permissions", () => {
  const proto = ArticleCitationController.prototype;
  const of = (handler: unknown) =>
    Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler as object);

  it("reads the report with knowledge.view", () => {
    assert.deepEqual(of(proto.report), [PERMISSIONS.KNOWLEDGE_VIEW]);
  });

  it("writes and answers only with knowledge.manage", () => {
    for (const handler of [proto.add, proto.remove, proto.answer])
      assert.deepEqual(of(handler), [PERMISSIONS.KNOWLEDGE_MANAGE]);
  });
});
