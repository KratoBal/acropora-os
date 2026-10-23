import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadRelatedBillingDocuments } from "./billing-document-related.js";

/**
 * A KIMENŐ BIZONYLATOK LÁNCA (task kimeno-kapcsolodo-bizonylatok). Kitalált
 * bizonylatok. MI PIROSÍT: ha a lánc csak egy lépést lát (a végszámlán nem áll a
 * díjbekérő, a díjbekérőn nem áll a végszámla); ha a sztornó nem az
 * érvénytelenített bizonylata mögé kerül; ha két külön lánc összekeveredik; ha a
 * kapcsolódó nélküli bizonylat listát kap; ha a nem kimenő vagy nem Számlázz.hu
 * sor bekerül.
 */
interface Row {
  id: string;
  direction: string;
  source: string;
  documentType: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: Date | null;
  grossAmount: { toFixed(n: number): string } | null;
  currency: string;
  proformaInvoiceId: string | null;
  referencedInvoiceId: string | null;
  createdAt: Date;
  sourceType: string | null;
  completionCertificateId: string | null;
}

const row = (
  overrides: Partial<Row> & Pick<Row, "id" | "documentType">,
): Row => ({
  direction: "OUTBOUND",
  source: "SZAMLAZZ",
  invoiceNumber: null,
  status: "ISSUED",
  issueDate: new Date("2026-10-01T10:00:00Z"),
  grossAmount: { toFixed: () => "127000.0000" },
  currency: "HUF",
  proformaInvoiceId: null,
  referencedInvoiceId: null,
  createdAt: new Date("2026-10-01T09:00:00Z"),
  // an own row of the Számlázás module: it has a source reference
  sourceType: "PROJECT",
  completionCertificateId: null,
  ...overrides,
});

/** Evaluates the where shape the loader uses: direction, source and an OR of `in` lists. */
function fakeDatabase(rows: Row[]) {
  const queries: unknown[] = [];
  const database = {
    invoice: {
      findMany: async (args: {
        take?: number;
        where: {
          direction?: string;
          source?: string;
          OR: Record<string, { in: string[] }>[];
        };
      }) => {
        queries.push(args.where);
        return rows
          .filter(
            (r) =>
              (args.where.direction === undefined ||
                r.direction === args.where.direction) &&
              (args.where.source === undefined ||
                r.source === args.where.source) &&
              args.where.OR.some((clause) =>
                Object.entries(clause).some(([field, cond]) =>
                  cond.in.includes(String(r[field as keyof Row])),
                ),
              ),
          )
          .slice(0, args.take);
      },
    },
  };
  return { database: database as never, queries };
}

const CHAIN = [
  row({ id: "p1", documentType: "PROFORMA", invoiceNumber: "D-1" }),
  row({
    id: "a1",
    documentType: "ADVANCE_INVOICE",
    invoiceNumber: "E-1",
    proformaInvoiceId: "p1",
    issueDate: new Date("2026-10-05T10:00:00Z"),
  }),
  row({
    id: "f1",
    documentType: "FINAL_INVOICE",
    invoiceNumber: "V-1",
    proformaInvoiceId: "p1",
    referencedInvoiceId: "a1",
    issueDate: new Date("2026-10-10T10:00:00Z"),
  }),
  row({
    id: "s1",
    documentType: "STORNO",
    invoiceNumber: "S-1",
    referencedInvoiceId: "f1",
    issueDate: new Date("2026-10-12T10:00:00Z"),
    sourceType: null,
  }),
];
const OTHER = row({ id: "x1", documentType: "INVOICE", invoiceNumber: "X-1" });

describe("a kimenő bizonylatok lánca", () => {
  for (const start of ["p1", "a1", "f1", "s1"]) {
    it(`the same chain, in the same order, from ${start}`, async () => {
      const { database } = fakeDatabase([...CHAIN, OTHER]);
      const result = (await loadRelatedBillingDocuments(database, start))
        .documents;
      assert.deepEqual(
        result.map((d) => d.id),
        ["p1", "a1", "f1", "s1"],
      );
      assert.deepEqual(
        result.filter((d) => d.current).map((d) => d.id),
        [start],
      );
    });
  }

  it("puts the storno right behind the document it cancels and names it", async () => {
    const rows = [
      ...CHAIN,
      row({
        id: "s0",
        documentType: "STORNO",
        invoiceNumber: "S-0",
        referencedInvoiceId: "a1",
        issueDate: new Date("2026-10-06T10:00:00Z"),
      }),
    ];
    const { documents: result } = await loadRelatedBillingDocuments(
      fakeDatabase(rows).database,
      "p1",
    );
    assert.deepEqual(
      result.map((d) => d.id),
      ["p1", "a1", "s0", "f1", "s1"],
    );
    assert.deepEqual(
      result.filter((d) => d.cancelsId).map((d) => [d.id, d.cancelsId]),
      [
        ["s0", "a1"],
        ["s1", "f1"],
      ],
    );
  });

  it("gives a document with nothing attached an empty list, not a list of itself", async () => {
    const { database } = fakeDatabase([...CHAIN, OTHER]);
    assert.deepEqual(await loadRelatedBillingDocuments(database, "x1"), {
      documents: [],
      truncated: false,
    });
  });

  it("does not mix a second chain in, nor an inbound or non-Számlázz.hu row", async () => {
    const rows = [
      ...CHAIN,
      row({ id: "p2", documentType: "PROFORMA", invoiceNumber: "D-2" }),
      row({
        id: "a2",
        documentType: "ADVANCE_INVOICE",
        proformaInvoiceId: "p2",
      }),
      row({
        id: "in1",
        documentType: "INVOICE",
        direction: "INBOUND",
        proformaInvoiceId: "p1",
      }),
      row({
        id: "nav1",
        documentType: "INVOICE",
        source: "NAV",
        proformaInvoiceId: "p1",
      }),
    ];
    const { documents: result } = await loadRelatedBillingDocuments(
      fakeDatabase(rows).database,
      "a1",
    );
    assert.deepEqual(
      result.map((d) => d.id),
      ["p1", "a1", "f1", "s1"],
    );
  });

  it("carries the number, the status, the Budapest issue day, the gross amount and the currency", async () => {
    const draft = row({
      id: "d1",
      documentType: "INVOICE",
      status: "DRAFT",
      issueDate: null,
      grossAmount: null,
      proformaInvoiceId: "p1",
    });
    const { documents: result } = await loadRelatedBillingDocuments(
      fakeDatabase([CHAIN[0]!, draft]).database,
      "p1",
    );
    assert.deepEqual(result[0], {
      id: "p1",
      documentType: "PROFORMA",
      number: "D-1",
      status: "ISSUED",
      issueDate: "2026-10-01",
      grossAmount: "127000.0000",
      currency: "HUF",
      current: true,
      openable: true,
      cancelsId: null,
    });
    assert.deepEqual(
      [result[1]!.status, result[1]!.number, result[1]!.issueDate],
      ["DRAFT", null, null],
    );
  });

  it("marks what has no details page as not openable: the storno and a document another module issued", async () => {
    const rows = [
      ...CHAIN,
      row({
        id: "m1",
        documentType: "INVOICE",
        invoiceNumber: "M-1",
        proformaInvoiceId: "p1",
        // issued by the maintenance flow: no source reference, a certificate instead
        sourceType: null,
        completionCertificateId: "cc-1",
      }),
    ];
    const { documents } = await loadRelatedBillingDocuments(
      fakeDatabase(rows).database,
      "p1",
    );
    assert.deepEqual(
      documents.map((d) => [d.id, d.openable]),
      [
        ["p1", true],
        ["a1", true],
        ["m1", false],
        ["f1", true],
        ["s1", false],
      ],
    );
  });

  it("says when the chain is longer than the list shows, and keeps the starting document in it", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      row({
        id: `k${i}`,
        documentType: "ADVANCE_INVOICE",
        proformaInvoiceId: "p1",
        invoiceNumber: `K-${i}`,
        issueDate: new Date(Date.UTC(2026, 9, 1 + (i % 28))),
      }),
    );
    const result = await loadRelatedBillingDocuments(
      fakeDatabase([CHAIN[0]!, ...many]).database,
      "p1",
    );
    assert.equal(result.truncated, true);
    assert.equal(result.documents.length, 25);
    assert.ok(result.documents.some((d) => d.current));
    assert.equal(
      (
        await loadRelatedBillingDocuments(
          fakeDatabase([...CHAIN]).database,
          "p1",
        )
      ).truncated,
      false,
    );
  });

  it("stops on a cycle instead of looping", async () => {
    const rows = [
      row({ id: "c1", documentType: "INVOICE", referencedInvoiceId: "c2" }),
      row({ id: "c2", documentType: "INVOICE", referencedInvoiceId: "c1" }),
    ];
    const { documents: result } = await loadRelatedBillingDocuments(
      fakeDatabase(rows).database,
      "c1",
    );
    assert.deepEqual(result.map((d) => d.id).sort(), ["c1", "c2"]);
  });
});
