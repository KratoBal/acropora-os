import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  christmasCandidates,
  drawGameWinner,
  drawGameWinnerInOrder,
  isGameAnswerCorrect,
  normalizeGameAnswer,
  normalizeGameEmail,
} from "./game.js";

/*
  THE GIVEAWAY'S RULES (card 31445d0f). What turns these red: a right answer rejected for its case, accents or spaces
  (Balázs: these do not matter), or a wrong one taken; an empty accepted list accepting anything; a CHOICE matched
  loosely; a draw that picks another winner for the same seed and candidates (it is shown live, and must be repeatable),
  or depends on the order the candidates came in; a weight not counted (who plays more weeks is in the hat more times).
*/
describe("the answer", () => {
  it("case, accents and spaces do not matter, the letters do", () => {
    assert.equal(normalizeGameAnswer("  Ördög-hal  "), "ordoghal");
    assert.equal(
      isGameAnswerCorrect("TEXT", "acropora  MILLEPORA", [
        "Acropora millepora",
      ]),
      true,
    );
    assert.equal(isGameAnswerCorrect("TEXT", "Acroporá", ["acropora"]), true);
    assert.equal(
      isGameAnswerCorrect("TEXT", "Montipora", ["acropora", "akropora"]),
      false,
    );
    assert.equal(
      isGameAnswerCorrect("TEXT", "akropóra", ["acropora", "akropora"]),
      true,
    );
  });

  it("nothing accepted accepts nothing; an empty answer is never right; a choice matches by its id exactly", () => {
    assert.equal(isGameAnswerCorrect("TEXT", "barmi", []), false);
    assert.equal(isGameAnswerCorrect("TEXT", " - ", ["-"]), false);
    assert.equal(isGameAnswerCorrect("CHOICE", "b", ["b"]), true);
    assert.equal(isGameAnswerCorrect("CHOICE", "B", ["b"]), false);
  });

  it("the e-mail is kept trimmed and in lower case, a malformed one is refused", () => {
    assert.equal(
      normalizeGameEmail("  Jatekos@Example.COM "),
      "jatekos@example.com",
    );
    assert.equal(normalizeGameEmail("nem-email"), null);
    assert.equal(normalizeGameEmail("a@b"), null);
  });
});

describe("the draw", () => {
  const candidates = [
    { email: "c@x.hu", weight: 1 },
    { email: "a@x.hu", weight: 3 },
    { email: "b@x.hu", weight: 1 },
  ];

  it("the same seed and candidates pick the same winner, in whatever order they came", () => {
    const first = drawGameWinner(candidates, "mag-2026-12-20");
    const again = drawGameWinner([...candidates].reverse(), "mag-2026-12-20");
    assert.deepEqual(again, first);
    assert.equal(first!.tickets, 5);
  });

  it("every ticket is somebody's, and a heavier candidate wins in proportion", () => {
    const wins = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      const result = drawGameWinner(candidates, `seed-${i}`)!;
      assert.ok(result.ticket >= 0 && result.ticket < result.tickets);
      wins.set(result.winner.email, (wins.get(result.winner.email) ?? 0) + 1);
    }
    // a@ holds 3 of the 5 tickets: about 3000 of 5000
    assert.ok(
      wins.get("a@x.hu")! > 2700 && wins.get("a@x.hu")! < 3300,
      String(wins.get("a@x.hu")),
    );
    assert.ok(wins.get("b@x.hu")! > 800 && wins.get("c@x.hu")! > 800);
  });

  it("on a list already in order, the kept-order draw picks what the draw picks; on another order it does not sort", () => {
    const sorted = [...candidates].sort((a, b) => (a.email < b.email ? -1 : 1));
    for (let i = 0; i < 200; i++)
      assert.deepEqual(
        drawGameWinnerInOrder(sorted, `seed-${i}`),
        drawGameWinner(candidates, `seed-${i}`),
      );
    // the same weights renamed so that they sort the other way round: the kept order still decides
    const renamed = sorted.map((c, i) => ({ ...c, email: `z${9 - i}` }));
    for (let i = 0; i < 200; i++) {
      const kept = drawGameWinnerInOrder(renamed, `seed-${i}`)!;
      const original = drawGameWinner(candidates, `seed-${i}`)!;
      assert.equal(
        sorted[renamed.indexOf(kept.winner)]!.email,
        original.winner.email,
      );
    }
  });

  it("no candidate with a weight: no winner", () => {
    assert.equal(drawGameWinner([], "x"), null);
    assert.equal(drawGameWinner([{ email: "a@x.hu", weight: 0 }], "x"), null);
  });

  it("the Christmas weight is the number of weeks with a confirmed correct entry", () => {
    assert.deepEqual(
      christmasCandidates([
        { email: "a@x.hu", questionId: "w45" },
        { email: "a@x.hu", questionId: "w46" },
        { email: "b@x.hu", questionId: "w46" },
        { email: "a@x.hu", questionId: "w46" },
      ]).sort((x, y) => x.email.localeCompare(y.email)),
      [
        { email: "a@x.hu", weight: 2 },
        { email: "b@x.hu", weight: 1 },
      ],
    );
  });
});
