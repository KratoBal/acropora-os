import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  departmentConflicts,
  planFieldMerge,
  planRowBlockers,
  previewFingerprint,
  type MergeFacts,
} from "./partner-merge-plan.js";

/**
 * AZ ÖSSZEVONÁS SZABÁLYAI (partnertörzs, 4. lépés). MI PIROSÍT: ha két különböző adószám összevonható; ha egy nem ellenőrizhető
 * adószám átmegy; ha az ütköző mező felülíródik; ha az ütköző e-mail elveszik; ha a szerviz-kód (egyedi) nem előbb a megszűnőről
 * megy; ha a két Supplier-kötéses sor vagy a fordított irány átmegy; ha a lenyomat nem követi a hivatkozásokat.
 */
const facts = (over: Partial<MergeFacts> & { id: string }): MergeFacts => ({
  customerNumber: `VEVO-${over.id}`,
  displayName: `Név ${over.id}`,
  type: "COMPANY",
  companyName: null,
  worksheetPartnerCode: null,
  taxNumber: null,
  euTaxNumber: null,
  email: null,
  billingEmail: null,
  phone: null,
  paymentDueDays: null,
  archivedAt: null,
  mergedIntoId: null,
  hasSupplier: false,
  ...over,
});

describe("planFieldMerge", () => {
  it("fills the empty fields of the kept row from the merged one and never overwrites a field", () => {
    const plan = planFieldMerge(
      facts({ id: "k", phone: "+36 1 111", taxNumber: null }),
      facts({
        id: "m",
        phone: "+36 1 999",
        taxNumber: "11111111-2-42",
        companyName: "Cég Kft.",
      }),
    );
    assert.deepEqual(plan.keptData, {
      taxNumber: "11111111-2-42",
      companyName: "Cég Kft.",
    });
    assert.ok(plan.notes.some((note) => /phone/.test(note)));
    assert.deepEqual(plan.blockers, []);
  });

  it("two different Hungarian bases or community keys block the merge: two different companies", () => {
    const hu = planFieldMerge(
      facts({ id: "k", taxNumber: "11111111-2-42" }),
      facts({ id: "m", taxNumber: "22222222-2-42" }),
    );
    assert.equal(hu.blockers.length, 1);
    const eu = planFieldMerge(
      facts({ id: "k", euTaxNumber: "DE123456789" }),
      facts({ id: "m", euTaxNumber: "DE987654321" }),
    );
    assert.equal(eu.blockers.length, 1);
    // the same base written differently is the same company
    const same = planFieldMerge(
      facts({ id: "k", taxNumber: "11111111-2-42" }),
      facts({ id: "m", taxNumber: "11111111242" }),
    );
    assert.deepEqual(same.blockers, []);
  });

  it("a tax number that is not of tax number shape cannot be checked: blocks when both sides have one, is not copied when only the merged one has it", () => {
    const both = planFieldMerge(
      facts({ id: "k", taxNumber: "11111111-2-42" }),
      facts({ id: "m", taxNumber: "valami" }),
    );
    assert.ok(both.blockers.some((b) => /nem ellenőrizhető/.test(b)));
    const only = planFieldMerge(
      facts({ id: "k" }),
      facts({ id: "m", taxNumber: "valami" }),
    );
    assert.deepEqual(only.keptData, {});
    assert.ok(only.notes.some((note) => /nem adószám alakú/.test(note)));
  });

  it("a conflicting e-mail keeps the kept one, and the other goes to the empty billing e-mail; with a taken billing e-mail it is a note only", () => {
    const free = planFieldMerge(
      facts({ id: "k", email: "a@x.hu" }),
      facts({ id: "m", email: "b@x.hu" }),
    );
    assert.deepEqual(free.keptData, { billingEmail: "b@x.hu" });
    assert.deepEqual(free.fills, [
      { field: "email", kind: "fill", into: "billingEmail" },
    ]);
    const taken = planFieldMerge(
      facts({ id: "k", email: "a@x.hu", billingEmail: "c@x.hu" }),
      facts({ id: "m", email: "b@x.hu" }),
    );
    assert.deepEqual(taken.keptData, {});
    assert.ok(
      taken.notes.some((note) => /számlázási e-mail is foglalt/.test(note)),
    );
    // the same address in another case is no conflict
    assert.deepEqual(
      planFieldMerge(
        facts({ id: "k", email: "A@x.hu" }),
        facts({ id: "m", email: "a@X.hu" }),
      ).notes,
      [],
    );
  });

  it("the company type wins, and the payment term is only filled when the kept row has none", () => {
    const type = planFieldMerge(
      facts({ id: "k", type: "PERSON" }),
      facts({ id: "m", type: "COMPANY" }),
    );
    assert.equal(type.keptData.type, "COMPANY");
    assert.equal(
      planFieldMerge(
        facts({ id: "k", type: "COMPANY" }),
        facts({ id: "m", type: "PERSON" }),
      ).keptData.type,
      undefined,
    );
    assert.equal(
      planFieldMerge(facts({ id: "k" }), facts({ id: "m", paymentDueDays: 30 }))
        .keptData.paymentDueDays,
      30,
    );
    const kept = planFieldMerge(
      facts({ id: "k", paymentDueDays: 8 }),
      facts({ id: "m", paymentDueDays: 30 }),
    );
    assert.equal(kept.keptData.paymentDueDays, undefined);
    assert.ok(kept.notes.some((note) => /fizetési nap/.test(note)));
  });

  it("the unique worksheet code moves off the merged row first; two codes block", () => {
    const move = planFieldMerge(
      facts({ id: "k" }),
      facts({ id: "m", worksheetPartnerCode: "FANK" }),
    );
    assert.deepEqual(move.clearOnMerged, ["worksheetPartnerCode"]);
    assert.equal(move.keptData.worksheetPartnerCode, "FANK");
    const both = planFieldMerge(
      facts({ id: "k", worksheetPartnerCode: "AAAA" }),
      facts({ id: "m", worksheetPartnerCode: "FANK" }),
    );
    assert.equal(both.blockers.length, 1);
    assert.deepEqual(both.clearOnMerged, []);
  });
});

describe("planRowBlockers", () => {
  const ids = { keptId: "k", mergedId: "m" };
  it("blocks a row merged into itself, a missing row, an archived or already merged row", () => {
    assert.ok(
      planRowBlockers(facts({ id: "k" }), facts({ id: "k" }), {
        keptId: "k",
        mergedId: "k",
      }).blockers.length,
    );
    assert.equal(
      planRowBlockers(null, facts({ id: "m" }), ids).blockers.length,
      1,
    );
    assert.equal(
      planRowBlockers(facts({ id: "k" }), null, ids).blockers.length,
      1,
    );
    assert.equal(
      planRowBlockers(
        facts({ id: "k", archivedAt: new Date() }),
        facts({ id: "m" }),
        ids,
      ).blockers.length,
      1,
    );
    assert.equal(
      planRowBlockers(
        facts({ id: "k" }),
        facts({ id: "m", mergedIntoId: "x" }),
        ids,
      ).blockers.length,
      1,
    );
    assert.match(
      planRowBlockers(
        facts({ id: "k" }),
        facts({ id: "m", mergedIntoId: "k", archivedAt: new Date() }),
        ids,
      ).blockers.join(" "),
      /már össze van vonva/,
    );
  });

  it("two partner mirrors block; the partner mirror as the merged side suggests the swap; the mirror as the kept side is fine", () => {
    assert.equal(
      planRowBlockers(
        facts({ id: "k", hasSupplier: true }),
        facts({ id: "m", hasSupplier: true }),
        ids,
      ).suggestSwap,
      false,
    );
    assert.equal(
      planRowBlockers(
        facts({ id: "k", hasSupplier: true }),
        facts({ id: "m", hasSupplier: true }),
        ids,
      ).blockers.length,
      1,
    );
    const swap = planRowBlockers(
      facts({ id: "k" }),
      facts({ id: "m", hasSupplier: true }),
      ids,
    );
    assert.equal(swap.suggestSwap, true);
    assert.equal(swap.blockers.length, 1);
    const fine = planRowBlockers(
      facts({ id: "k", hasSupplier: true }),
      facts({ id: "m" }),
      ids,
    );
    assert.deepEqual(fine, { blockers: [], suggestSwap: false });
  });
});

describe("previewFingerprint", () => {
  const base = {
    keptId: "k",
    mergedId: "m",
    willMove: { Invoice: 2, SalesOrder: 5 },
    movedIds: {
      Invoice: ["i1", "i2"],
      SalesOrder: ["o1", "o2", "o3", "o4", "o5"],
    },
    fieldFills: [],
  };
  it("is stable for the same input, whatever the key order, and changes with a count, an id or a fill", () => {
    const fp = previewFingerprint(base);
    assert.equal(
      previewFingerprint({ ...base, willMove: { SalesOrder: 5, Invoice: 2 } }),
      fp,
    );
    assert.notEqual(
      previewFingerprint({ ...base, willMove: { Invoice: 3, SalesOrder: 5 } }),
      fp,
    );
    assert.notEqual(previewFingerprint({ ...base, mergedId: "x" }), fp);
    assert.notEqual(
      previewFingerprint({
        ...base,
        fieldFills: [{ field: "phone", kind: "fill", into: "phone" }],
      }),
      fp,
    );
    assert.match(fp, /^[0-9a-f]{64}$/);
  });

  it("follows the ids, not just the counts: one order leaving and another arriving keeps the count and changes the fingerprint", () => {
    const fp = previewFingerprint(base);
    // the same ids in another order: the same fingerprint
    assert.equal(
      previewFingerprint({
        ...base,
        movedIds: {
          SalesOrder: ["o5", "o4", "o3", "o2", "o1"],
          Invoice: ["i2", "i1"],
        },
      }),
      fp,
    );
    // o5 replaced by o9: the count is still 5
    assert.notEqual(
      previewFingerprint({
        ...base,
        movedIds: {
          Invoice: ["i1", "i2"],
          SalesOrder: ["o1", "o2", "o3", "o4", "o9"],
        },
      }),
      fp,
    );
  });
});

describe("planFieldMerge: the Hungarian base against the other row's HU community key", () => {
  it("blocks when only one row has a Hungarian number and the other only a HU community key of another base", () => {
    const keptHu = planFieldMerge(
      facts({ id: "k", taxNumber: "11111111-2-42" }),
      facts({ id: "m", euTaxNumber: "HU22222222" }),
    );
    assert.equal(keptHu.blockers.length, 1);
    const mergedHu = planFieldMerge(
      facts({ id: "k", euTaxNumber: "HU22222222" }),
      facts({ id: "m", taxNumber: "11111111-2-42" }),
    );
    assert.equal(mergedHu.blockers.length, 1);
  });

  it("does not block the same base, nor a non-HU community key", () => {
    assert.deepEqual(
      planFieldMerge(
        facts({ id: "k", taxNumber: "11111111-2-42" }),
        facts({ id: "m", euTaxNumber: "HU11111111" }),
      ).blockers,
      [],
    );
    assert.deepEqual(
      planFieldMerge(
        facts({ id: "k", taxNumber: "11111111-2-42" }),
        facts({ id: "m", euTaxNumber: "DE123456789" }),
      ).blockers,
      [],
    );
  });
});

describe("departmentConflicts", () => {
  const ids = { keptId: "k", mergedId: "m" };
  it("names a department code that both rows have under the same parent", () => {
    const blockers = departmentConflicts(
      [
        { customerId: "k", parentId: "p1", code: "A1" },
        { customerId: "m", parentId: "p1", code: "A1" },
        { customerId: "m", parentId: "p1", code: "B2" },
      ],
      ids,
    );
    assert.equal(blockers.length, 1);
    assert.match(blockers[0]!, /A1/);
    assert.doesNotMatch(blockers[0]!, /B2/);
  });

  it("is quiet for another parent, another code, and parentless departments (the database treats NULL as distinct)", () => {
    assert.deepEqual(
      departmentConflicts(
        [
          { customerId: "k", parentId: "p1", code: "A1" },
          { customerId: "m", parentId: "p2", code: "A1" },
          { customerId: "m", parentId: "p1", code: "A2" },
          { customerId: "k", parentId: null, code: "Z" },
          { customerId: "m", parentId: null, code: "Z" },
        ],
        ids,
      ),
      [],
    );
  });
});
