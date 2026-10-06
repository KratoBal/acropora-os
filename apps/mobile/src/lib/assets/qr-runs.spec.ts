import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { qrRuns } from "./qr-runs";

describe("the asset QR as runs", () => {
  it("joins equal neighbours, and the runs add up to the row", () => {
    const rows = Array.from({ length: 21 }, (_, y) =>
      y === 0 ? "111111100000000111111" : "0".repeat(21),
    );
    const runs = qrRuns(rows)!;
    assert.deepEqual(runs[0], [
      { dark: true, length: 7 },
      { dark: false, length: 8 },
      { dark: true, length: 6 },
    ]);
    assert.deepEqual(runs[1], [{ dark: false, length: 21 }]);
    for (const row of runs)
      assert.equal(
        row.reduce((sum, run) => sum + run.length, 0),
        21,
      );
  });

  it("the runs give back every row of a 37-wide symbol exactly", () => {
    let seed = 7;
    const bit = () =>
      ((seed = (seed * 1103515245 + 12345) % 2147483648) >> 16) & 1;
    const rows = Array.from({ length: 37 }, () =>
      Array.from({ length: 37 }, () => String(bit())).join(""),
    );
    const back = qrRuns(rows)!.map((row) =>
      row.map((run) => (run.dark ? "1" : "0").repeat(run.length)).join(""),
    );
    assert.deepEqual(back, rows);
  });

  it("draws nothing when the server did not send the rows", () => {
    assert.equal(qrRuns(undefined), null);
  });

  it("draws nothing from rows that are not a square of 0 and 1", () => {
    const ok = Array.from({ length: 21 }, () => "0".repeat(21));
    assert.notEqual(qrRuns(ok), null);
    // one row a cell short
    assert.equal(
      qrRuns(ok.map((row, y) => (y === 5 ? row.slice(1) : row))),
      null,
    );
    // a cell that is neither 0 nor 1
    assert.equal(
      qrRuns(ok.map((row, y) => (y === 3 ? `${row.slice(1)}x` : row))),
      null,
    );
    // one row missing
    assert.equal(qrRuns(ok.slice(0, 20)), null);
  });
});
