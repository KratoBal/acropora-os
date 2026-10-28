import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import {
  GOLD_SOURCE_COUNT,
  judgeRow,
  judgeSourceRow,
  placeClaims,
  sampleClaims,
  parseCompleteness,
  parseFreezeInput,
  parseMissedClaim,
  proposeGoldSet,
  scoreGoldSet,
  wilsonLower,
  GoldSetInputError,
  type GoldClaimField,
  type GoldClaimInput,
  type GoldSourceField,
  type GoldSourceScoreInput,
  type SourceRowJudgement,
  type RowJudgement,
} from "./gold-set.js";
import { GoldSetService, type GoldSetStore } from "./gold-set.controller.js";
import {
  GoldSetConflict,
  GoldSetNotFound,
  type GoldSetView,
} from "./gold-set.repository.js";

const field = (
  name: string,
  decision: GoldClaimField["decision"],
  machineValue: string | null = "x",
): GoldClaimField => ({ field: name, machineValue, decision });

const claim = (over: Partial<GoldClaimInput> = {}): GoldClaimInput => ({
  id: "c1",
  status: "VERIFIED",
  fields: [field("species", "ACCEPTED"), field("quantity", "ACCEPTED")],
  editorWithdrew: false,
  ...over,
});

describe("T3 row: the editor's stored decisions make the verdict", () => {
  it("a verified claim with every machine field accepted is correct and found", () => {
    const row = judgeRow(claim());
    assert.equal(row.verdict, "CORRECT");
    assert.deepEqual(row.errors, []);
    assert.equal(row.found, true);
    assert.equal(row.critical, false);
  });

  it("a corrected or rejected machine field makes it wrong, named; still found", () => {
    const row = judgeRow(
      claim({
        fields: [
          field("species", "CORRECTED"),
          field("direction", "REJECTED"),
          field("effect", "ACCEPTED"),
        ],
      }),
    );
    assert.equal(row.verdict, "WRONG");
    assert.deepEqual(row.errors, ["species", "direction"]);
    assert.equal(row.found, true);
    assert.equal(row.critical, false);
  });

  it("a wrong quantity (value, unit or basis) is critical", () => {
    const row = judgeRow(claim({ fields: [field("quantity", "CORRECTED")] }));
    assert.equal(row.verdict, "WRONG");
    assert.equal(row.critical, true);
  });

  it("an editor's question answered is no error: the machine asserted no value", () => {
    const row = judgeRow(
      claim({ fields: [field("species", "CORRECTED", null)] }),
    );
    assert.equal(row.verdict, "CORRECT");
    assert.deepEqual(row.questions, ["species"]);
  });

  it("a candidate waits; a discarded claim is wrong as a whole and not found", () => {
    assert.equal(judgeRow(claim({ status: "CANDIDATE" })).verdict, "PENDING");
    const discarded = judgeRow(
      claim({ status: "WITHDRAWN", editorWithdrew: true }),
    );
    assert.equal(discarded.verdict, "WRONG");
    assert.deepEqual(discarded.errors, ["CLAIM"]);
    assert.equal(discarded.found, false);
  });

  it("a claim withdrawn by a re-extraction, disputed or gone is out, with its reason", () => {
    assert.equal(
      judgeRow(claim({ status: "WITHDRAWN" })).outReason,
      "REEXTRACTED",
    );
    assert.equal(judgeRow(claim({ status: "DISPUTED" })).outReason, "DISPUTED");
    assert.equal(
      judgeRow(claim({ status: "SUPERSEDED" })).outReason,
      "SUPERSEDED",
    );
    assert.equal(judgeRow(claim({ status: null })).outReason, "MISSING");
  });
});

const rows = (
  correct: number,
  wrong = 0,
  critical = 0,
  pending = 0,
  discarded = 0,
): RowJudgement[] => [
  ...Array.from({ length: correct }, () => judgeRow(claim())),
  ...Array.from({ length: wrong }, () =>
    judgeRow(claim({ fields: [field("effect", "CORRECTED")] })),
  ),
  ...Array.from({ length: critical }, () =>
    judgeRow(claim({ fields: [field("quantity", "REJECTED")] })),
  ),
  ...Array.from({ length: pending }, () =>
    judgeRow(claim({ status: "CANDIDATE" })),
  ),
  ...Array.from({ length: discarded }, () =>
    judgeRow(claim({ status: "WITHDRAWN", editorWithdrew: true })),
  ),
];

/** Ten sources; the rows and the missed claims go on the first one. */
const RIGHT_SOURCE: SourceRowJudgement = {
  verdict: "CORRECT",
  errors: [],
  questions: [],
  levelChanged: false,
};

const sheet = (
  first: RowJudgement[],
  missed = 0,
  checked = true,
  sourceRows: SourceRowJudgement[] = [],
): GoldSourceScoreInput[] =>
  Array.from({ length: GOLD_SOURCE_COUNT }, (_, i) => ({
    sourceId: `s${i}`,
    rows: i === 0 ? first : [],
    missed: i === 0 ? missed : 0,
    completenessChecked: checked,
    sourceRow: sourceRows[i] ?? RIGHT_SOURCE,
  }));

describe("T3 score: the plan's thresholds", () => {
  it("27 of 30 with no critical error and 21 of 30 found passes", () => {
    const score = scoreGoldSet(sheet(rows(27, 3), 0));
    assert.equal(score.verdict, "PASS");
    assert.equal(score.precision.maxErrors, 3);
    assert.equal(score.completeness.gold, 30);
  });

  it("4 errors in 30 fail on precision", () => {
    const score = scoreGoldSet(sheet(rows(26, 4)));
    assert.equal(score.verdict, "FAIL");
    assert.deepEqual(score.failures, ["PRECISION"]);
  });

  it("one value, unit or basis error fails, even inside the error budget", () => {
    const score = scoreGoldSet(sheet(rows(29, 0, 1)));
    assert.equal(score.verdict, "FAIL");
    assert.deepEqual(score.failures, ["CRITICAL_ERRORS"]);
  });

  it("completeness counts the missed claims: 30 found and 13 missed is below 21 of 30", () => {
    // gold 43, minFound ceil(43 * 21 / 30) = 31, found 30
    const score = scoreGoldSet(sheet(rows(30), 13));
    assert.equal(score.completeness.minFound, 31);
    assert.deepEqual(score.failures, ["COMPLETENESS"]);
    // and 12 missed is exactly on the line: ceil(42 * 21 / 30) = 30
    assert.equal(scoreGoldSet(sheet(rows(30), 12)).verdict, "PASS");
  });

  it("a discarded row is an error but not a found claim", () => {
    const score = scoreGoldSet(sheet(rows(30, 0, 0, 0, 2)));
    assert.equal(score.precision.wrong, 2);
    assert.equal(score.completeness.found, 30);
  });

  it("is not ready while a row waits, a source is open, or the set is short", () => {
    assert.deepEqual(scoreGoldSet(sheet(rows(29, 0, 0, 1))).problems, [
      "PENDING_ROWS",
      "TOO_FEW_SCORED",
      "GOLD_TOO_SMALL",
    ]);
    assert.deepEqual(scoreGoldSet(sheet(rows(30), 0, false)).problems, [
      "COMPLETENESS_OPEN",
    ]);
    const empty = scoreGoldSet([]);
    assert.equal(empty.verdict, "NOT_READY");
    assert.deepEqual(empty.problems, ["NOT_FROZEN"]);
    // failures are only named once the sheet is ready
    assert.deepEqual(
      scoreGoldSet(sheet(rows(20, 9, 1), 0, false)).failures,
      [],
    );
  });

  it("shows the plan's Wilson bounds: about 74% at 27/30 and 52% at 21/30", () => {
    assert.equal(Math.round(wilsonLower(27, 30)! * 100), 74);
    assert.equal(Math.round(wilsonLower(21, 30)! * 100), 52);
    assert.equal(wilsonLower(0, 0), null);
  });
});

describe("T3 proposal", () => {
  const src = (id: string, claims: number, year: number | null = 2020) => ({
    sourceId: id,
    title: id,
    year,
    claims,
  });

  it("takes the ten sources with the most machine claims, then the newest, then the id; at most three from one", () => {
    const candidates = [
      ...Array.from({ length: 11 }, (_, i) => src(`a${i}`, 4)),
      src("big", 12),
      src("none", 0),
      src("new", 4, 2024),
    ];
    const proposal = proposeGoldSet(candidates);
    assert.equal(proposal.sources.length, 10);
    assert.deepEqual(
      proposal.sources.slice(0, 3).map((s) => [s.sourceId, s.inSet]),
      [
        ["big", 3],
        ["new", 3],
        ["a0", 3],
      ],
    );
    assert.equal(proposal.claims, 30);
    assert.deepEqual(proposal.required, {
      sources: 10,
      claims: 30,
      perSource: 3,
    });
    assert.equal(proposal.enough, true);
  });

  it("the stage after the PDF path (acrobot 37410): fifteen sources give ten of three, thirty", () => {
    const proposal = proposeGoldSet(
      [12, 12, 7, 4, 4, 4, 1, 1, 10, 6, 5, 5, 3, 3, 1].map((n, i) =>
        src(`t${i}`, n),
      ),
    );
    assert.equal(proposal.sources.length, 10);
    assert.equal(proposal.claims, 30);
    assert.equal(proposal.enough, true);
  });

  it("is not enough below ten sources or thirty claims in the set", () => {
    // nine sources of four: 27 claims, and one source short
    assert.equal(
      proposeGoldSet(Array.from({ length: 9 }, (_, i) => src(`c${i}`, 4)))
        .enough,
      false,
    );
    // ten sources of two: 20 claims, below thirty
    assert.equal(
      proposeGoldSet(Array.from({ length: 10 }, (_, i) => src(`b${i}`, 2)))
        .enough,
      false,
    );
  });
});

describe("T3 sample of one source", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

  it("takes all up to three, above it an even spread from the first, the same every time", () => {
    assert.deepEqual(sampleClaims(ids(2)), ids(2));
    assert.deepEqual(sampleClaims(ids(3)), ids(3));
    assert.deepEqual(sampleClaims(ids(12)), ["c0", "c4", "c8"]);
    assert.deepEqual(sampleClaims(ids(12)), sampleClaims(ids(12)));
    assert.equal(new Set(sampleClaims(ids(4))).size, 3);
  });
});

describe("T3 placement", () => {
  it("a claim on two sources counts once, at its first evidence row's source", () => {
    const placed = placeClaims([
      { claimId: "c1", sourceId: "a" },
      { claimId: "c2", sourceId: "a" },
      { claimId: "c1", sourceId: "b" },
      { claimId: "c3", sourceId: "b" },
    ]);
    assert.deepEqual(placed.get("a"), ["c1", "c2"]);
    assert.deepEqual(placed.get("b"), ["c3"]);
  });
});

describe("T3 input", () => {
  const ten = Array.from({ length: GOLD_SOURCE_COUNT }, (_, i) => `s${i}`);

  it("freezes exactly the set's count of distinct source ids", () => {
    assert.deepEqual(parseFreezeInput({ sourceIds: ten }), ten);
    const code = (body: unknown) => {
      try {
        parseFreezeInput(body);
        return "OK";
      } catch (e) {
        return (e as GoldSetInputError).code;
      }
    };
    assert.equal(code({}), "BAD_BODY");
    assert.equal(code({ sourceIds: ten.slice(1) }), "SOURCE_COUNT");
    assert.equal(
      code({ sourceIds: [...ten.slice(1), "s0", "s0"] }),
      "DUPLICATE_SOURCE",
    );
    assert.equal(code({ sourceIds: [...ten.slice(1), 7] }), "BAD_SOURCE_ID");
  });

  it("a missed claim needs its text; the locator is optional", () => {
    assert.deepEqual(parseMissedClaim({ text: "  PO4 0,1 mg/l  " }), {
      text: "PO4 0,1 mg/l",
      locator: null,
    });
    assert.deepEqual(parseMissedClaim({ text: "x", locator: " 2. tábla " }), {
      text: "x",
      locator: "2. tábla",
    });
    assert.throws(() => parseMissedClaim({ text: "  " }), GoldSetInputError);
    assert.throws(
      () => parseMissedClaim({ text: "x".repeat(501) }),
      GoldSetInputError,
    );
    assert.throws(
      () => parseMissedClaim({ text: "x", locator: 3 }),
      GoldSetInputError,
    );
    assert.equal(parseCompleteness({ checked: true }), true);
    assert.throws(
      () => parseCompleteness({ checked: "yes" }),
      GoldSetInputError,
    );
  });
});

describe("T3 service", () => {
  const user = { id: "u1" } as AuthenticatedUser;
  const view = { frozen: true } as GoldSetView;

  function service(fail?: Error) {
    const calls: string[] = [];
    const store: GoldSetStore = {
      view: async () => view,
      freeze: async (ids, by) => {
        calls.push(`freeze ${ids.length} ${by}`);
        if (fail) throw fail;
      },
      addMissed: async (sourceId, input, by) => {
        calls.push(`missed ${sourceId} ${input.text} ${by}`);
        if (fail) throw fail;
      },
      removeMissed: async (id, by) => {
        calls.push(`remove ${id} ${by}`);
        if (fail) throw fail;
      },
      setCompleteness: async (sourceId, checked, by) => {
        calls.push(`complete ${sourceId} ${checked} ${by}`);
        if (fail) throw fail;
      },
    };
    return { svc: new GoldSetService(store), calls };
  }

  it("a write goes to the store with the user and returns the whole sheet", async () => {
    const { svc, calls } = service();
    const ten = Array.from({ length: GOLD_SOURCE_COUNT }, (_, i) => `s${i}`);
    assert.equal(await svc.freeze({ sourceIds: ten }, user), view);
    await svc.addMissed("s1", { text: "kimaradt" }, user);
    await svc.removeMissed("m1", user);
    await svc.setCompleteness("s1", { checked: false }, user);
    assert.deepEqual(calls, [
      `freeze ${GOLD_SOURCE_COUNT} u1`,
      "missed s1 kimaradt u1",
      "remove m1 u1",
      "complete s1 false u1",
    ]);
  });

  it("a bad body is a 400 and reaches no store", async () => {
    const { svc, calls } = service();
    await assert.rejects(
      svc.freeze({ sourceIds: [] }, user),
      BadRequestException,
    );
    await assert.rejects(svc.addMissed("s1", {}, user), BadRequestException);
    assert.deepEqual(calls, []);
  });

  it("a conflict is a 409 and a missing row a 404", async () => {
    await assert.rejects(
      service(new GoldSetConflict("ALREADY_FROZEN", "x")).svc.freeze(
        {
          sourceIds: Array.from(
            { length: GOLD_SOURCE_COUNT },
            (_, i) => `s${i}`,
          ),
        },
        user,
      ),
      ConflictException,
    );
    await assert.rejects(
      service(new GoldSetNotFound("x")).svc.removeMissed("m1", user),
      NotFoundException,
    );
  });
});

const study = (
  field: string,
  decision: GoldSourceField["decision"],
  machineValue: string | null,
  correctedValue: string | null = null,
): GoldSourceField => ({ field, decision, machineValue, correctedValue });

describe("T3b source row: the study fields, apart from the 27 of 30", () => {
  const lab = (
    decision: GoldSourceField["decision"],
    corrected: string | null = null,
    over: { controlled?: boolean | null; sampleSizes?: (number | null)[] } = {},
  ) =>
    judgeSourceRow({
      fields: [
        study("studyType", decision, "CONTROLLED_LAB", corrected),
        study("measurementMethod", "ACCEPTED", "PHOTOMETER"),
      ],
      controlled: over.controlled ?? true,
      sampleSizes: over.sampleSizes ?? [12],
    });

  it("accepted study fields are correct; a pending one waits; none is NONE", () => {
    assert.equal(lab("ACCEPTED").verdict, "CORRECT");
    assert.equal(lab("PENDING").verdict, "PENDING");
    assert.equal(
      judgeSourceRow({ fields: [], controlled: null, sampleSizes: [] }).verdict,
      "NONE",
    );
  });

  it("a study type corrected to another tier moves the level; to the same tier it does not", () => {
    // a controlled lab with 12 colonies is SINGLE_EXPERIMENT; a field survey is OBSERVATIONAL
    const moved = lab("CORRECTED", "FIELD_OBSERVATIONAL");
    assert.equal(moved.verdict, "WRONG");
    assert.deepEqual(moved.errors, ["studyType"]);
    assert.equal(moved.levelChanged, true);
    // a mesocosm is experimental too: the same tier, a wrong field, no level change
    const same = lab("CORRECTED", "MESOCOSM");
    assert.equal(same.verdict, "WRONG");
    assert.equal(same.levelChanged, false);
  });

  it("the tier reads the source's control and the claims' sample sizes", () => {
    // without a control the lab is OBSERVATIONAL already: a survey changes nothing
    assert.equal(
      lab("CORRECTED", "FIELD_OBSERVATIONAL", { controlled: false })
        .levelChanged,
      false,
    );
    // one claim with too few replicates, one with enough: the second moves
    assert.equal(
      lab("CORRECTED", "FIELD_OBSERVATIONAL", { sampleSizes: [2, 12] })
        .levelChanged,
      true,
    );
    // rejected: no study type at all is no tier, which is a change
    assert.equal(lab("REJECTED").levelChanged, true);
  });

  it("a study field on several anchors is one error", () => {
    const row = judgeSourceRow({
      fields: [
        study("studyType", "REJECTED", "CONTROLLED_LAB"),
        study("studyType", "REJECTED", "CONTROLLED_LAB"),
      ],
      controlled: true,
      sampleSizes: [12],
    });
    assert.deepEqual(row.errors, ["studyType"]);
  });

  it("a wrong measurement method is an error but moves no level", () => {
    const row = judgeSourceRow({
      fields: [
        study("studyType", "ACCEPTED", "CONTROLLED_LAB"),
        study(
          "measurementMethod",
          "CORRECTED",
          "PHOTOMETER",
          "COLORIMETRIC_KIT",
        ),
      ],
      controlled: true,
      sampleSizes: [12],
    });
    assert.deepEqual(row.errors, ["measurementMethod"]);
    assert.equal(row.levelChanged, false);
  });

  it("the score counts them apart: one wrong field passes, two fail, a level change fails", () => {
    const wrongField: SourceRowJudgement = {
      verdict: "WRONG",
      errors: ["measurementMethod"],
      questions: [],
      levelChanged: false,
    };
    const one = scoreGoldSet(sheet(rows(30), 0, true, [wrongField]));
    assert.equal(one.verdict, "PASS");
    assert.equal(one.sourceFields.verdict, "PASS");
    assert.equal(one.sourceFields.wrongFields, 1);
    const two = scoreGoldSet(
      sheet(rows(30), 0, true, [wrongField, wrongField]),
    );
    assert.equal(two.sourceFields.verdict, "FAIL");
    // the claims' verdict does not move with it
    assert.equal(two.verdict, "PASS");
    const level = scoreGoldSet(
      sheet(rows(30), 0, true, [{ ...wrongField, levelChanged: true }]),
    );
    assert.equal(level.sourceFields.verdict, "FAIL");
    assert.equal(level.sourceFields.levelChanged, 1);
    const waiting = scoreGoldSet(
      sheet(rows(30), 0, true, [{ ...RIGHT_SOURCE, verdict: "PENDING" }]),
    );
    assert.equal(waiting.sourceFields.verdict, "NOT_READY");
    assert.equal(scoreGoldSet([]).sourceFields.verdict, "NOT_READY");
  });
});
