import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runDatasheetAuditCli,
  type FetchDatasheets,
} from "./datasheet-audit.cli.js";
import type { AuditableDatasheet } from "./datasheet-refusal-audit.js";

/**
 * A FUTTATÓ, adatbázis nélkül.
 *
 * A kilépési kód a mérendő, nem a szöveg: ezt a parancsot gép is olvassa, és a
 * három kód HÁROM KÜLÖNBÖZŐ állítás. A legfontosabb közülük a 2-es: egy
 * elérhetetlen adatbázis NEM tiszta adatbázis, és ha a kettő ugyanazt a kódot
 * adná, egy hálózati hiba „minden rendben" válasznak látszana.
 */

function out() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
    text: () => stdout.join(""),
    errors: () => stderr.join(""),
  };
}

const db =
  (sheets: AuditableDatasheet[]): FetchDatasheets =>
  async () =>
    sheets;

const failing: FetchDatasheets = async () => {
  throw new Error("connection refused");
};

describe("runDatasheetAuditCli", () => {
  it("exits 0 when nothing contradicts", async () => {
    const sink = out();

    const code = await runDatasheetAuditCli(
      sink,
      db([{ id: "ds-1", refusals: [{ mezo: "TARTASA" }] }]),
    );

    assert.equal(code, 0);
    assert.match(sink.text(), /Nincs ellentmondó pár/);
  });

  it("exits 1 and names the conflict", async () => {
    const sink = out();

    const code = await runDatasheetAuditCli(
      sink,
      db([{ id: "ds-1", tartasa: "Könnyű", refusals: [{ mezo: "TARTASA" }] }]),
    );

    assert.equal(code, 1);
    assert.match(sink.text(), /ds-1/);
    assert.match(sink.text(), /TARTASA/);
  });

  /**
   * A LEGFONTOSABB ESET. Egy elérhetetlen adatbázisról NEM tudjuk, hogy tiszta-e,
   * és ezt más kóddal kell mondani, mint azt, hogy találtunk valamit.
   */
  it("exits 2 when the query itself fails, not 0 and not 1", async () => {
    const sink = out();

    const code = await runDatasheetAuditCli(sink, failing);

    assert.equal(code, 2);
    assert.match(sink.errors(), /nem \s*tudjuk|nem tudjuk/);
    assert.equal(sink.text(), "");
  });

  /**
   * A MEGNÉZETT DARABSZÁM AKKOR IS KIÍRÓDIK, HA NULLA - különben egy ÜRES
   * adatbázison futó audit ugyanúgy nézne ki, mint egy tele adatbázison futó
   * tiszta eredmény. Pont ez a különbség számít, amikor valaki egy zöld sorra
   * hivatkozik.
   */
  it("always says how many sheets it looked at", async () => {
    const sink = out();

    const code = await runDatasheetAuditCli(sink, db([]));

    assert.equal(code, 0);
    assert.match(sink.text(), /^0 adatlap megnézve\./m);
  });

  it("reports every conflicting sheet, not only the first", async () => {
    const sink = out();

    const code = await runDatasheetAuditCli(
      sink,
      db([
        { id: "ds-a", tartasa: "x", refusals: [{ mezo: "TARTASA" }] },
        { id: "ds-b", kulleme: "y", refusals: [{ mezo: "KULLEME" }] },
      ]),
    );

    assert.equal(code, 1);
    assert.match(sink.text(), /ds-a/);
    assert.match(sink.text(), /ds-b/);
    assert.match(sink.text(), /^2 ellentmondó pár/m);
  });
});
