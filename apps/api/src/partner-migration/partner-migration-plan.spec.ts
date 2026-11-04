import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMigrationPlan,
  isOwnCompanyName,
  normalizedName,
  type MigrationCustomer,
  type MigrationSupplier,
} from "./partner-migration-plan.js";

/**
 * AZ EGYSZERI ÁTVEZETÉS TERVE (partnertörzs). MI PIROSÍT: ha egy partner a rossz műveletet kapja (a kötött sor jelölése, a
 * szabad sorhoz kötés, új sor, a több jelöltnél az emberi döntés); ha egy MÁS partnerhez kötött vevő-sor jelöltként jön; ha a név
 * párosít (két azonos nevű cég két cég); ha a saját cégünk nem marad ki; ha a külföldi kulcs a magyarral keveredik.
 */
const supplier = (
  over: Partial<MigrationSupplier> & { id: string },
): MigrationSupplier => ({
  code: over.id.toUpperCase(),
  name: `Partner ${over.id}`,
  taxNumber: null,
  country: "HU",
  customerId: null,
  isActive: true,
  isSupplier: true,
  isService: false,
  worksheetPartnerCode: null,
  ...over,
});
const customer = (
  over: Partial<MigrationCustomer> & { id: string },
): MigrationCustomer => ({
  customerNumber: `VEVO-${over.id}`,
  displayName: `Vevő ${over.id}`,
  companyName: null,
  type: "COMPANY",
  taxNumber: null,
  euTaxNumber: null,
  partnerMirror: false,
  fromUnas: false,
  references: 0,
  ...over,
});
const action = (
  suppliers: MigrationSupplier[],
  customers: MigrationCustomer[],
  id: string,
) =>
  buildMigrationPlan(suppliers, customers).rows.find(
    (row) => row.supplierId === id,
  )!;

describe("buildMigrationPlan: the action of each partner", () => {
  it("a partner with no linked row and no tax match gets a new customer row", () => {
    const row = action(
      [supplier({ id: "a", taxNumber: "11111111-2-42" })],
      [customer({ id: "c1", taxNumber: "22222222-2-42" })],
      "a",
    );
    assert.equal(row.action, "CREATE_NEW");
    assert.deepEqual(row.candidates, []);
  });

  it("exactly one free customer row on the same tax number is bound to", () => {
    const row = action(
      [supplier({ id: "a", taxNumber: "11111111-2-42" })],
      [customer({ id: "c1", taxNumber: "11111111142", references: 3 })],
      "a",
    );
    assert.equal(row.action, "BIND_EXISTING");
    assert.deepEqual(
      row.candidates.map((c) => [c.id, c.references]),
      [["c1", 3]],
    );
  });

  it("several free customer rows on the same tax number need a human decision", () => {
    const row = action(
      [supplier({ id: "a", taxNumber: "11111111-2-42" })],
      [
        customer({ id: "c1", taxNumber: "11111111-2-42" }),
        customer({ id: "c2", taxNumber: "HU11111111" }),
      ],
      "a",
    );
    assert.equal(row.action, "BIND_AMBIGUOUS");
    assert.equal(row.candidates.length, 2);
  });

  it("a partner with its mirror row only is marked; with more customer rows of the same company it needs the merge", () => {
    const mirror = customer({
      id: "m",
      taxNumber: "11111111-2-42",
      partnerMirror: true,
    });
    const lone = action(
      [
        supplier({
          id: "a",
          taxNumber: "11111111-2-42",
          customerId: "m",
          isService: true,
        }),
      ],
      [mirror],
      "a",
    );
    assert.equal(lone.action, "MARK_ONLY");
    assert.equal(lone.linkedCustomer?.id, "m");
    const zoo = action(
      [
        supplier({
          id: "a",
          taxNumber: "11111111-2-42",
          customerId: "m",
          isService: true,
        }),
      ],
      [
        mirror,
        customer({
          id: "u1",
          taxNumber: "11111111-2-42",
          fromUnas: true,
          references: 9,
        }),
      ],
      "a",
    );
    assert.equal(zoo.action, "MERGE_CANDIDATES");
    assert.deepEqual(
      zoo.candidates.map((c) => [c.id, c.fromUnas]),
      [["u1", true]],
    );
  });

  it("a customer row linked to ANOTHER partner is never a candidate", () => {
    const rows = buildMigrationPlan(
      [
        supplier({ id: "a", taxNumber: "11111111-2-42" }),
        supplier({ id: "b", taxNumber: "11111111-2-42", customerId: "c1" }),
      ],
      [customer({ id: "c1", taxNumber: "11111111-2-42", partnerMirror: true })],
    ).rows;
    assert.equal(
      rows.find((row) => row.supplierId === "a")!.action,
      "CREATE_NEW",
    );
  });

  it("the foreign key and the Hungarian base never mix", () => {
    const row = action(
      [supplier({ id: "a", taxNumber: "DE123456789", country: "DE" })],
      [
        customer({ id: "c1", taxNumber: "12345678-1-42" }),
        customer({ id: "c2", euTaxNumber: "DE123456789" }),
      ],
      "a",
    );
    assert.equal(row.action, "BIND_EXISTING");
    assert.deepEqual(
      row.candidates.map((c) => c.id),
      ["c2"],
    );
  });

  it("no tax number: the name only informs, it never pairs, and the action is a new row", () => {
    const row = action(
      [supplier({ id: "a", name: "Korall Kert Kft." })],
      [
        customer({ id: "c1", displayName: "KORALL KERT" }),
        customer({ id: "c2", displayName: "Más Cég" }),
      ],
      "a",
    );
    assert.equal(row.action, "CREATE_NEW");
    assert.deepEqual(row.candidates, []);
    assert.deepEqual(
      row.nameCandidates.map((c) => c.id),
      ["c1"],
    );
    assert.ok(row.notes.some((note) => /adószám/.test(note)));
  });

  it("our own company is skipped, whatever else matches", () => {
    const row = action(
      [
        supplier({
          id: "a",
          name: "Acropora Kft.",
          taxNumber: "11111111-2-42",
        }),
      ],
      [customer({ id: "c1", taxNumber: "11111111-2-42" })],
      "a",
    );
    assert.equal(row.action, "SKIP_OWN");
    assert.equal(isOwnCompanyName("ACROPORA Kft"), true);
    assert.equal(isOwnCompanyName("Állatkert"), false);
  });

  it("a group tax number starting with 4 is flagged, not hidden", () => {
    const row = action(
      [supplier({ id: "a", taxNumber: "41234567-2-44" })],
      [],
      "a",
    );
    assert.ok(row.notes.some((note) => /4-gyel/.test(note)));
  });

  it("the mirror row of a DELETED partner is bound, so it is never a candidate of a live partner (barracuda, #2181)", () => {
    const plan = buildMigrationPlan(
      [supplier({ id: "a", taxNumber: "11111111-2-42" })],
      [
        customer({
          id: "dead-mirror",
          taxNumber: "11111111-2-42",
          partnerMirror: true,
        }),
      ],
      new Date(),
      new Set(["dead-mirror"]),
    );
    assert.equal(plan.rows[0]!.action, "CREATE_NEW");
    assert.deepEqual(plan.rows[0]!.candidates, []);
    // without the deleted set it WOULD have been a candidate: the guard is what keeps the CLI from rebinding it
    assert.equal(
      buildMigrationPlan(
        [supplier({ id: "a", taxNumber: "11111111-2-42" })],
        [
          customer({
            id: "dead-mirror",
            taxNumber: "11111111-2-42",
            partnerMirror: true,
          }),
        ],
      ).rows[0]!.action,
      "BIND_EXISTING",
    );
  });

  it("roles come from the flags, and the plan counts the actions", () => {
    const plan = buildMigrationPlan(
      [
        supplier({ id: "a", isSupplier: true, isService: true }),
        supplier({ id: "b", isSupplier: false, isService: true }),
      ],
      [],
    );
    assert.deepEqual(
      plan.rows.map((row) => row.roles),
      [["SUPPLIER", "SERVICE"], ["SERVICE"]],
    );
    assert.equal(plan.total, 2);
    assert.deepEqual(plan.byAction, { CREATE_NEW: 2 });
  });

  it("a linked row that is gone is noted, and the partner is treated as not linked", () => {
    const row = action(
      [supplier({ id: "a", customerId: "gone", taxNumber: "11111111-2-42" })],
      [],
      "a",
    );
    assert.equal(row.linkedCustomer, null);
    assert.ok(row.notes.some((note) => /archivált/.test(note)));
  });
});

describe("normalizedName", () => {
  it("drops the legal form, the accents and the punctuation", () => {
    assert.equal(
      normalizedName("Fővárosi Állat- és Növénykert Kft."),
      "fovarosiallatesnovenykert",
    );
    assert.equal(normalizedName(null), "");
    // two-letter words that are also legal forms elsewhere stay in the name (barracuda, #2181)
    assert.equal(normalizedName("SA Trading"), "satrading");
    assert.equal(normalizedName("Ev Kft"), "ev");
    assert.equal(normalizedName("Alma AG"), "almaag");
    assert.equal(
      normalizedName("Korall Kert Bt."),
      normalizedName("KORALL-KERT"),
    );
  });
});
