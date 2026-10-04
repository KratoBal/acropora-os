import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { markOwnInvoices, type MarkCandidate } from "./own-invoice-mark.js";

/**
 * A REGEN TAROLT SAJAT KIMENO SZAMLAK JELOLESE (acrobot 26163). Kitalalt
 * szamlaszamok; a sajat bankszamla a gyujto tesztjeben is hasznalt alak.
 *
 * MI PIROSIT: ha egy saját kimenő számla nem jelölődik; ha egy szállítói
 * számla igen; ha a kézi párosításra mutató jelölődik; ha a száraz kör ír; ha
 * az illesztő vagy a NAV-szám által olvasott dokumentum próbát kap.
 */
const OWN_ACCOUNT = "1170900220624460";
const OURS = [
  "SZÁMLA",
  "Eladó: Acropora Kft., adószám: 23916229-2-42",
  "Bankszámla: 11709002-20624460",
  "Számla sorszáma: E-ACRW-2026-00440",
];
const SUPPLIER = [
  "SZÁMLA",
  "Eladó: Szállító Kft.",
  "Bankszámla: 10700426-46856700",
];

function setup(
  documents: (Partial<MarkCandidate> & { lines: string[] })[],
  paired: string[] = [],
) {
  const marked: string[][] = [];
  const byContent = new Map<Uint8Array, string[]>();
  const rows = documents.map((d, i) => {
    const content = new Uint8Array([i]);
    byContent.set(content, d.lines);
    return {
      id: d.id ?? `doc-${i + 1}`,
      fileName: d.fileName ?? `E-ACRW-2026-${i + 1}.pdf`,
      content,
      textReading:
        d.textReading === undefined
          ? { invoiceNumber: "23916229-2-42", numberFrom: "BANK" }
          : d.textReading,
      importResult: d.importResult ?? null,
    };
  });
  return {
    marked,
    deps: {
      candidates: async () => rows,
      lines: async (content: Uint8Array) => {
        const lines = byContent.get(content)!;
        if (lines.length === 0) throw new Error("olvashatatlan");
        return lines;
      },
      ownAccounts: async () => [OWN_ACCOUNT],
      manuallyPaired: async () => new Set(paired),
      mark: async (ids: readonly string[]) => {
        marked.push([...ids]);
        return ids.length;
      },
    },
  };
}

describe("marking the stored own outgoing invoices", () => {
  it("marks what the collector's own-account test calls ours, nothing else", async () => {
    const { deps, marked } = setup([
      { lines: OURS },
      { lines: SUPPLIER, fileName: "szallito.pdf" },
      { lines: OURS },
    ]);
    const report = await markOwnInvoices(deps, true);
    assert.deepEqual(
      report.own.map((r) => r.id),
      ["doc-1", "doc-3"],
    );
    assert.deepEqual(marked, [["doc-1", "doc-3"]]);
    assert.equal(report.marked, 2);
  });

  it("dry by default: reports, writes nothing", async () => {
    const { deps, marked } = setup([{ lines: OURS }]);
    const report = await markOwnInvoices(deps, false);
    assert.equal(report.own.length, 1);
    assert.deepEqual(marked, []);
  });

  it("a manually paired one is listed, not marked", async () => {
    const { deps, marked } = setup(
      [{ lines: OURS }, { lines: OURS }],
      ["doc-2"],
    );
    const report = await markOwnInvoices(deps, true);
    assert.deepEqual(
      report.paired.map((r) => r.id),
      ["doc-2"],
    );
    assert.deepEqual(marked, [["doc-1"]]);
  });

  it("an adapter-read, a NAV-numbered or an unreadable document is not tested", async () => {
    const { deps, marked } = setup([
      { lines: OURS, importResult: { invoiceNumber: "X" } },
      { lines: OURS, textReading: { invoiceNumber: "E1", numberFrom: "NAV" } },
      { lines: [] },
    ]);
    const report = await markOwnInvoices(deps, true);
    assert.deepEqual(report.skipped, {
      ADAPTER_READ: 1,
      NAV_NUMBER: 1,
      UNREADABLE: 1,
    });
    assert.deepEqual(marked, []);
  });
});
