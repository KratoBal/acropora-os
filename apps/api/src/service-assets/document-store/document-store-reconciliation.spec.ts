import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcileDocumentStore } from "./document-store-reconciliation.js";

const key = (assetId: string, documentId: string) => ({ assetId, documentId });

describe("reconciling the table against the store", () => {
  it("reports nothing when every row has its file", () => {
    const report = reconcileDocumentStore({
      rowsWithStorageKey: [key("a", "1"), key("a", "2")],
      filesInStore: [key("a", "1"), key("a", "2")],
    });

    assert.deepEqual(report.orphanedFiles, []);
    assert.deepEqual(report.missingFiles, []);
    assert.equal(report.matched, 2);
  });

  /**
   * A KÉT IRÁNY KÜLÖN, ÉS EGYSZERRE. Egy bemenet, ahol MINDKÉT fajta jelen van,
   * mert egy közös „eltérés" szám ezt a két esetet összemosná, és a jelentés
   * olvasója nem tudná, takarítania kell-e vagy mentésből visszahoznia.
   */
  it("tells an orphaned file apart from a missing one", () => {
    const report = reconcileDocumentStore({
      rowsWithStorageKey: [key("a", "1"), key("a", "lost")],
      filesInStore: [key("a", "1"), key("a", "orphan")],
    });

    assert.deepEqual(report.orphanedFiles, [key("a", "orphan")]);
    assert.deepEqual(report.missingFiles, [key("a", "lost")]);
    assert.equal(report.matched, 1);
  });

  /**
   * UGYANAZ A `documentId` KÉT KÜLÖNBÖZŐ ESZKÖZ ALATT KÉT KÜLÖNBÖZŐ DOKUMENTUM.
   * Ha az összevetés csak a `documentId`-t nézné, ez a bemenet hibátlannak
   * látszana, holott mindkét oldalon hiányzik valami.
   */
  it("does not pair a document id across two assets", () => {
    const report = reconcileDocumentStore({
      rowsWithStorageKey: [key("asset-a", "same")],
      filesInStore: [key("asset-b", "same")],
    });

    assert.deepEqual(report.orphanedFiles, [key("asset-b", "same")]);
    assert.deepEqual(report.missingFiles, [key("asset-a", "same")]);
    assert.equal(report.matched, 0);
  });

  /**
   * AZ ÜRES TÁROLÓ MINDEN SORT ELVESZETTNEK JELENT, és ez a helyes válasz:
   * pontosan ez történik, ha a kötet nincs csatolva. A hívó dolga eldönteni,
   * hogy a `describe()` szerint van-e egyáltalán tároló -- ha nincs, ez a
   * jelentés nem lelet, hanem a hiányzó kötet következménye.
   */
  it("calls every row missing when the store is empty", () => {
    const report = reconcileDocumentStore({
      rowsWithStorageKey: [key("a", "1"), key("a", "2")],
      filesInStore: [],
    });

    assert.equal(report.missingFiles.length, 2);
    assert.deepEqual(report.orphanedFiles, []);
    assert.equal(report.matched, 0);
  });

  it("calls every file orphaned when the table has no storage rows", () => {
    const report = reconcileDocumentStore({
      rowsWithStorageKey: [],
      filesInStore: [key("a", "1")],
    });

    assert.deepEqual(report.orphanedFiles, [key("a", "1")]);
    assert.deepEqual(report.missingFiles, []);
    assert.equal(report.matched, 0);
  });

  it("has nothing to say about two empty sides", () => {
    const report = reconcileDocumentStore({
      rowsWithStorageKey: [],
      filesInStore: [],
    });

    assert.deepEqual(report.orphanedFiles, []);
    assert.deepEqual(report.missingFiles, []);
    assert.equal(report.matched, 0);
  });
});
