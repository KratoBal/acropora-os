import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planHandleSwitch,
  type HandleSwitchRow,
} from "./medusa-handle-switch.js";

/**
 * A HANDLE-ÁTKAPCSOLÁS TERVE (SEO P0 PR 7d). MI PIROSIT: a várakozó termék a
 * tartója ELŐTT kerül sorra (a Medusa egyedi indexe elutasítaná); egy nem mozgó
 * vagy idegen tartó ütközése átmegy; egy kör írható lesz; egy ütközőre váró sor
 * írható lesz; a változatlan sort is írja.
 */
const sor = (
  id: string,
  current: string,
  desired: string,
): HandleSwitchRow => ({
  productId: `p_${id}`,
  medusaId: `m_${id}`,
  current,
  desired,
});
const handlek = (rows: HandleSwitchRow[], extra: [string, string][] = []) =>
  new Map<string, string>([
    ...rows.map((r) => [r.current, r.medusaId] as [string, string]),
    ...extra,
  ]);
const ids = (rows: HandleSwitchRow[]) => rows.map((r) => r.productId);

describe("planHandleSwitch", () => {
  it("a változatlan sort nem írja; a szabad címre írhat", () => {
    const rows = [sor("a", "x", "x"), sor("b", "Regi-B", "uj-b")];
    const plan = planHandleSwitch(rows, handlek(rows));
    assert.equal(plan.unchanged, 1);
    assert.deepEqual(ids(plan.order), ["p_b"]);
  });

  it("ha A új címét ma B tartja, és B mozog: előbb B (a listában fordítva is)", () => {
    const rows = [sor("a", "a-regi", "kozos"), sor("b", "kozos", "b-uj")];
    for (const sorrend of [rows, [...rows].reverse()]) {
      const plan = planHandleSwitch(sorrend, handlek(rows));
      assert.deepEqual(ids(plan.order), ["p_b", "p_a"]);
    }
  });

  it("hosszabb lánc: C ← B ← A sorrendben", () => {
    const rows = [
      sor("a", "a0", "b0"),
      sor("b", "b0", "c0"),
      sor("c", "c0", "c-uj"),
    ];
    const plan = planHandleSwitch(rows, handlek(rows));
    assert.deepEqual(ids(plan.order), ["p_c", "p_b", "p_a"]);
  });

  it("nem mozgó tartó: ütközés; idegen (nem kötött) tartó: ütközés", () => {
    const rows = [
      sor("a", "a0", "x"),
      sor("b", "x", "x"),
      sor("c", "c0", "idegen"),
    ];
    const plan = planHandleSwitch(rows, handlek(rows, [["idegen", "m_kulso"]]));
    assert.deepEqual(
      plan.conflicts.map((c) => [c.row.productId, c.heldBy]),
      [
        ["p_a", "m_b"],
        ["p_c", "m_kulso"],
      ],
    );
    assert.deepEqual(plan.order, []);
  });

  it("kör (A a B-é, B az A-é): egyik sem írható", () => {
    const rows = [sor("a", "a0", "b0"), sor("b", "b0", "a0")];
    const plan = planHandleSwitch(rows, handlek(rows));
    assert.deepEqual(ids(plan.cycles).sort(), ["p_a", "p_b"]);
    assert.deepEqual(plan.order, []);
  });

  it("egy ütközőre (közvetve) váró sor blokkolt, nem írható", () => {
    const rows = [
      sor("a", "a0", "x"),
      sor("b", "x", "x"),
      sor("c", "c0", "a0"),
      sor("d", "d0", "c0"),
    ];
    const plan = planHandleSwitch(rows, handlek(rows));
    assert.deepEqual(ids(plan.blocked).sort(), ["p_c", "p_d"]);
    assert.deepEqual(plan.order, []);
  });
});
