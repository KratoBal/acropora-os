import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OutgoingDocumentNotFoundError,
  OutgoingDocumentNotIssuedError,
  setOutgoingPaperOriginal,
} from "./outgoing-paper-original.js";

/**
 * „PAPÍRON MEGVAN” A KIMENŐ SZÁMLÁN (Balázs, 2026-11-03). MI PIROSÍT: a jelölés rossz táblába ír (a saját
 * számla az `Invoice`, a külső a `ExternalBillingDocument`); egy bejövő (INBOUND) vagy vázlat bizonylat
 * jelölhető; ugyanaz az érték újra audit-sort ír; a visszavonás nem nulláz; az audit nem mondja meg, mi
 * történt.
 */
type OwnRow = {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  status: string;
  invoiceNumber: string | null;
  paperOriginalAt: Date | null;
};
type ExternalRow = {
  id: string;
  documentNumber: string;
  paperOriginalAt: Date | null;
};

function fakeDatabase(own: OwnRow | null, external: ExternalRow | null) {
  const state = {
    own: own ? { ...own } : null,
    external: external ? { ...external } : null,
  };
  const writes: { table: string; data: Record<string, unknown> }[] = [];
  const audits: { data: Record<string, unknown> }[] = [];
  const tx = {
    invoice: {
      findUnique: async () => (state.own ? { ...state.own } : null),
      update: async (args: { data: Record<string, unknown> }) => {
        writes.push({ table: "invoice", data: args.data });
        if (state.own)
          state.own.paperOriginalAt = args.data.paperOriginalAt as Date | null;
        return state.own;
      },
    },
    externalBillingDocument: {
      findUnique: async () => (state.external ? { ...state.external } : null),
      update: async (args: { data: Record<string, unknown> }) => {
        writes.push({ table: "externalBillingDocument", data: args.data });
        if (state.external)
          state.external.paperOriginalAt = args.data
            .paperOriginalAt as Date | null;
        return state.external;
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args);
        return {};
      },
    },
  };
  const database = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { database: database as never, state, writes, audits };
}

const own: OwnRow = {
  id: "inv-1",
  direction: "OUTBOUND",
  status: "ISSUED",
  invoiceNumber: "ACRW-2026/00547",
  paperOriginalAt: null,
};
const external: ExternalRow = {
  id: "ext-1",
  documentNumber: "ACRW-2026/00548",
  paperOriginalAt: null,
};
const now = new Date("2026-11-03T09:00:00.000Z");

describe("setOutgoingPaperOriginal", () => {
  it("a saját kiállított számlán az Invoice-ba ír, és az audit megnevezi a számot", async () => {
    const f = fakeDatabase(own, external);
    assert.deepEqual(
      await setOutgoingPaperOriginal(f.database, {
        origin: "OWN",
        id: "inv-1",
        marked: true,
        userId: "u1",
        now,
      }),
      { changed: true },
    );
    assert.deepEqual(f.writes, [
      { table: "invoice", data: { paperOriginalAt: now } },
    ]);
    assert.equal(f.audits.length, 1);
    assert.equal(
      f.audits[0]!.data.action,
      "billing.outgoing-paper-original.set",
    );
    assert.equal(f.audits[0]!.data.entityType, "Invoice");
    assert.equal(f.audits[0]!.data.entityId, "inv-1");
    assert.deepEqual(f.audits[0]!.data.metadata, {
      documentNumber: "ACRW-2026/00547",
    });
  });

  it("a külső számlán az ExternalBillingDocument-be ír, és visszavonható", async () => {
    const f = fakeDatabase(own, external);
    await setOutgoingPaperOriginal(f.database, {
      origin: "EXTERNAL",
      id: "ext-1",
      marked: true,
      userId: "u1",
      now,
    });
    assert.equal(f.state.external!.paperOriginalAt, now);
    assert.equal(f.state.own!.paperOriginalAt, null);
    await setOutgoingPaperOriginal(f.database, {
      origin: "EXTERNAL",
      id: "ext-1",
      marked: false,
      userId: "u1",
      now,
    });
    assert.equal(f.state.external!.paperOriginalAt, null);
    assert.deepEqual(
      f.audits.map((a) => [a.data.action, a.data.entityType]),
      [
        ["billing.outgoing-paper-original.set", "ExternalBillingDocument"],
        ["billing.outgoing-paper-original.cleared", "ExternalBillingDocument"],
      ],
    );
  });

  it("ugyanaz az érték újra nem ír semmit", async () => {
    const f = fakeDatabase(
      { ...own, paperOriginalAt: now },
      { ...external, paperOriginalAt: null },
    );
    assert.deepEqual(
      await setOutgoingPaperOriginal(f.database, {
        origin: "OWN",
        id: "inv-1",
        marked: true,
        userId: "u1",
      }),
      { changed: false },
    );
    assert.deepEqual(
      await setOutgoingPaperOriginal(f.database, {
        origin: "EXTERNAL",
        id: "ext-1",
        marked: false,
        userId: "u1",
      }),
      { changed: false },
    );
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.audits, []);
  });

  it("nincs ilyen sor, vagy bejövő bizonylat: nem található; vázlat: nem jelölhető", async () => {
    await assert.rejects(
      setOutgoingPaperOriginal(fakeDatabase(null, null).database, {
        origin: "OWN",
        id: "x",
        marked: true,
        userId: "u1",
      }),
      OutgoingDocumentNotFoundError,
    );
    await assert.rejects(
      setOutgoingPaperOriginal(fakeDatabase(null, null).database, {
        origin: "EXTERNAL",
        id: "x",
        marked: true,
        userId: "u1",
      }),
      OutgoingDocumentNotFoundError,
    );
    await assert.rejects(
      setOutgoingPaperOriginal(
        fakeDatabase({ ...own, direction: "INBOUND" }, null).database,
        {
          origin: "OWN",
          id: "inv-1",
          marked: true,
          userId: "u1",
        },
      ),
      OutgoingDocumentNotFoundError,
    );
    const draft = fakeDatabase(
      { ...own, status: "DRAFT", invoiceNumber: null },
      null,
    );
    await assert.rejects(
      setOutgoingPaperOriginal(draft.database, {
        origin: "OWN",
        id: "inv-1",
        marked: true,
        userId: "u1",
      }),
      OutgoingDocumentNotIssuedError,
    );
    assert.deepEqual(draft.writes, []);
  });
});
