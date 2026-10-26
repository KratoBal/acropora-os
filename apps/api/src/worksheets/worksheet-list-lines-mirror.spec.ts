import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import ts from "typescript";
import { worksheetListLines } from "@acropora/types";

/*
  THE PHONE'S COPY OF THE TWO LIST LINES BEHAVES LIKE THE SHARED ONE
  (barracuda, #1892 review). The phone does not import `@acropora/types`, so
  `worksheetListLines` stands twice; today they are equal, and this spec keeps
  them so: a one-sided edit turns it red.

  WHY THE FUNCTION ALONE IS LIFTED OUT: the phone's file imports other modules
  at runtime, and a module transpiled into a data URL cannot resolve them. The
  function itself is pure, so its own source is transpiled and RUN on the same
  inputs as the shared one. A text comparison would also turn red on a harmless
  reformatting; a run turns red on a different answer.
*/
const PHONE = "../mobile/src/lib/worksheets/worksheet-presentation.ts";
const START = "export function worksheetListLines(";

type Lines = typeof worksheetListLines;

async function phoneCopy(): Promise<Lines> {
  const source = readFileSync(PHONE, "utf8");
  const start = source.indexOf(START);
  assert.ok(start >= 0, `${PHONE}: no ${START}`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `${PHONE}: the function does not close`);
  const javascript = ts.transpileModule(source.slice(start, end + 3), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;
  const encoded = Buffer.from(javascript, "utf8").toString("base64");
  const module = (await import(`data:text/javascript;base64,${encoded}`)) as {
    worksheetListLines: Lines;
  };
  return module.worksheetListLines;
}

const CASES: Parameters<Lines>[0][] = [
  { number: "ML-2026-00814", subject: "Szűrőcsere" },
  { number: "ML-2026-00814", subject: "  Szűrőcsere\t" },
  { number: null, subject: "Szűrőcsere" },
  { number: "ML-2026-00814", subject: "" },
  { number: "ML-2026-00814", subject: " \n\t " },
  { number: null, subject: "" },
  { number: null, subject: "   " },
  { number: "", subject: "x" },
];

describe("worksheetListLines on the phone", () => {
  it("gives the shared copy's answer on every case", async () => {
    const phone = await phoneCopy();
    for (const input of CASES)
      assert.deepEqual(
        [input, phone(input)],
        [input, worksheetListLines(input)],
      );
  });

  // control: the comparison can see a difference at all
  it("would see a copy that answers differently", () => {
    const different: Lines = (input) => ({
      main: input.subject,
      detail: input.number,
    });
    assert.ok(
      CASES.some(
        (input) =>
          JSON.stringify(different(input)) !==
          JSON.stringify(worksheetListLines(input)),
      ),
    );
  });
});
