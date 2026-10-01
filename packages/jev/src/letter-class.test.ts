import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  LETTER_CLASSES,
  LetterBlocked,
  buildLetterRequest,
  type Letter,
} from "./letter-class.js";
import { Redactor, knownTable } from "./redact.js";

type LetterVector =
  | { body: string; placeholders: Record<string, number>; options: string[] }
  | { blocked: string; detail: string };
interface Vectors {
  commonWords: string[];
  known: { entries: [string, string][] };
  letter: {
    items: (Letter & { id: string })[];
    unknown: LetterVector[];
    known: LetterVector[];
  };
}

const V = JSON.parse(
  readFileSync(
    new URL("../redact-vectors/r11-expected.json", import.meta.url),
    "utf8",
  ),
) as Vectors;
const common = new Set(V.commonWords);

describe("a level-besorolo kerese: ugyanaz a torzs, mint a merese (acrobot 25784)", () => {
  for (const [mode, known] of [
    ["unknown", null],
    ["known", knownTable(V.known.entries)],
  ] as const)
    it(`${mode === "known" ? "known-entity listaval" : "lista nelkul"}`, () => {
      assert.ok(V.letter.items.length >= 8);
      V.letter.items.forEach((item, i) => {
        const want = V.letter[mode][i]!;
        let got: LetterVector;
        try {
          const q = buildLetterRequest({ commonWords: common, known }, item);
          got = {
            body: JSON.stringify({
              state: q.state,
              model: q.model,
              questions: {
                [q.questionKey]: {
                  type: "choice",
                  criteria: q.criteria,
                  instructions: q.instructions,
                },
              },
            }),
            placeholders: q.placeholders,
            options: Object.keys(q.criteria),
          };
        } catch (e) {
          if (!(e instanceof LetterBlocked)) throw e;
          got = { blocked: e.outcome, detail: e.detail };
        }
        if ("body" in want) {
          // a Python ", " es ": " elvalasztoval ir; a kulcs-sorrend es a tartalom szamit
          assert.ok("body" in got, `${item.id}: ${JSON.stringify(got)}`);
          assert.equal(
            got.body,
            JSON.stringify(JSON.parse(want.body)),
            item.id,
          );
          assert.deepEqual(got.placeholders, want.placeholders, item.id);
          assert.deepEqual(got.options, want.options, item.id);
        } else assert.deepEqual(got, want, item.id);
      });
    });

  it("a vektorok a tiltott es a vagott esetet is hordozzak", () => {
    const kinds = V.letter.unknown.map((v) =>
      "blocked" in v ? v.blocked : "body",
    );
    assert.ok(kinds.includes("blocked_too_long"));
    assert.ok(kinds.includes("body"));
  });

  it("a dokumentum-szavak nelkul a kitakaro eltakarna, amit a besorolonak latnia kell", () => {
    const letter: Letter = {
      subject: "Pro forma Rechnung 4711",
      fileName: "PF-4711.pdf",
      lines: ["Pro forma", "Rechnung Nr. 4711", "Kunde: Kovács Péter"],
    };
    const plain = new Redactor({ commonWords: common, known: null }).redact(
      `Subject: ${letter.subject}`,
    ).text;
    assert.doesNotMatch(plain, /Rechnung/);
    const message = buildLetterRequest(
      { commonWords: common, known: null },
      letter,
    ).state.message!;
    assert.match(message, /^Subject: Pro forma Rechnung 4711\n/);
    // a szemely neve ettol meg kitakart
    assert.doesNotMatch(message, /Kovács|Péter/);
  });

  it("a nyolc osztaly, a meres sorrendjeben", () => {
    assert.deepEqual(Object.keys(LETTER_CLASSES), [
      "BEJOVO_SZAMLA",
      "NYUGTA",
      "DIJBEKERO",
      "SAJAT_KIMENO",
      "SZALLITOLEVEL",
      "VISSZAIGAZOLAS",
      "EMLEKEZTETO",
      "EGYEB",
    ]);
  });
});
