import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma, type IncomingBillingDocument } from "@acropora/database";

import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";
import { cardPaidSupplierEvidence } from "./due-invoices-card-history.js";

/*
  A SZÁLLÍTÓ MÁSIK SZÁMLÁINAK FIZETÉSE (acrobot 58830, nautilus 58712). MI PIROSÍT: ha egy kártyával fizetett MÁSIK számla nem ad bizonyítékot; ha egy sor a SAJÁT párosított
  terheléséből kap bizonyítékot; ha egy UTALÁSSAL fizetett másik számla mellett (Neptun, MVM) mégis bizonyíték keletkezik; ha egy nem kártyás vagy típus nélküli terhelés kártyának
  számít; ha csak névvel azonosított szállító kap bizonyítékot; ha egy sztornózott számla tanúskodik; ha két szállító összekeveredik.
*/
let n = 0;
const row = (
  over: Partial<Record<string, unknown>> = {},
): IncomingBillingDocument =>
  ({
    id: `row-${++n}`,
    sourceDocumentId: `doc-${n}`,
    documentNumber: `SZ-${n}`,
    supplierName: "Telekom Kft.",
    supplierTaxNumber: "10773381-2-44",
    supplierEuTaxNumber: null,
    grossAmount: new Prisma.Decimal(1000),
    currency: "HUF",
    cancelled: false,
    ...over,
  }) as unknown as IncomingBillingDocument;

const pairing = (card: (boolean | undefined)[]): DocumentPairing =>
  ({
    debits: card.map((c) => ({
      bookingDate: "2026-10-01",
      amount: "1000",
      currency: "HUF",
      ...(c === undefined ? {} : { card: c }),
    })),
  }) as unknown as DocumentPairing;

const run = (
  rows: IncomingBillingDocument[],
  paid: Record<string, (boolean | undefined)[]>,
) =>
  cardPaidSupplierEvidence({
    rows,
    pairings: new Map(
      Object.entries(paid).map(([id, card]) => [
        rows.find((r) => r.id === id)!.sourceDocumentId!,
        pairing(card),
      ]),
    ),
  });

describe("cardPaidSupplierEvidence", () => {
  it("a supplier's OTHER card-paid invoices count, and the row's own do not", () => {
    const target = row();
    const a = row();
    const b = row();
    const evidence = run([target, a, b], {
      [a.id]: [true],
      [b.id]: [true, true],
    });
    assert.deepEqual(evidence.get(target.id), {
      kind: "CARD",
      cardInvoices: 2,
    });
    // a card-paid row gets evidence from the OTHER card row only, never from itself
    assert.deepEqual(evidence.get(a.id), { kind: "CARD", cardInvoices: 1 });
    const alone = row();
    assert.equal(run([alone], { [alone.id]: [true] }).has(alone.id), false);
  });

  it("one transfer-paid other invoice rules the supplier out (a card supplier can send a transfer invoice)", () => {
    const target = row();
    const card = row();
    const transfer = row();
    const evidence = run([target, card, transfer], {
      [card.id]: [true],
      [transfer.id]: [false],
    });
    assert.equal(evidence.has(target.id), false);
  });

  it("a debit with no type is not a card: it counts as a transfer, on the conservative side", () => {
    const target = row();
    const card = row();
    const unknown = row();
    const evidence = run([target, card, unknown], {
      [card.id]: [true],
      [unknown.id]: [undefined],
    });
    assert.equal(evidence.has(target.id), false);
  });

  it("an invoice is card-paid only when EVERY paired debit is a card debit", () => {
    const target = row();
    const mixed = row();
    const evidence = run([target, mixed], { [mixed.id]: [true, false] });
    assert.equal(evidence.has(target.id), false);
  });

  it("an invoice with no paired debit says nothing, and a cancelled one does not testify", () => {
    const target = row();
    const unpaired = row();
    const cancelled = row({ cancelled: true });
    const evidence = run([target, unpaired, cancelled], {
      [cancelled.id]: [true],
    });
    assert.equal(evidence.size, 0);
  });

  it("a supplier known only by its NAME gets no evidence, and two suppliers do not mix", () => {
    const nameOnlyTarget = row({
      supplierTaxNumber: null,
      supplierName: "Névtelen Bt.",
    });
    const nameOnlyCard = row({
      supplierTaxNumber: null,
      supplierName: "Névtelen Bt.",
    });
    assert.equal(
      run([nameOnlyTarget, nameOnlyCard], { [nameOnlyCard.id]: [true] }).size,
      0,
    );
    const other = row({
      supplierTaxNumber: "99999999-2-44",
      supplierName: "Más Kft.",
    });
    const card = row();
    const target = row();
    const evidence = run([target, card, other], {
      [card.id]: [true],
      [other.id]: [false],
    });
    assert.deepEqual(evidence.get(target.id), {
      kind: "CARD",
      cardInvoices: 1,
    });
    assert.equal(evidence.has(other.id), false);
  });
});
