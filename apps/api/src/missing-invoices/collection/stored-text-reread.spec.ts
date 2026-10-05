import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { InvoiceTextReading } from "./invoice-text.js";
import { parseSelector } from "./stored-text-reread.cli.js";
import {
  rereadStoredText,
  type StoredTextDocument,
} from "./stored-text-reread.js";

/**
 * A TÁROLT OLVASAT ÚJRA (acrobot 26153, FleetCor). A sorok a PDF-olvasó valódi
 * kimenetének alakja, a dokumentum tartalma helyett a teszt adja őket.
 *
 * MI PIROSÍT: ha a hibás ügyfél-azonosító marad számlaszámnak; ha a száraz
 * futás ír; ha a szállítói illesztő olvasata felülíródik; ha a banki
 * hivatkozás elveszik; ha egy szám nélküli újraolvasás egy jó régi számot
 * töröl.
 */
const FLEETCOR = [
  "Ügyfélazonosító szám | HU00008659 | ACROPORA KFT. | Számla - Eredeti példány",
  "Számla száma | E0401374511 | 1106 BUDAPEST | Számla kiállító",
  "Dózsa György út 84/B H-1068 Budapest | Adószám | 25103272-2-42",
];

const OLD: InvoiceTextReading = {
  invoiceNumber: "HU00008659",
  numberFrom: "FILE_NAME",
  supplierTaxNumber: "HU00008659",
  bankReference: "HU00008659",
};

function deps(
  documents: (Partial<StoredTextDocument> & { lines: string[] })[],
) {
  const saved: {
    id: string;
    reading: InvoiceTextReading;
    kind?: string | null;
  }[] = [];
  const byContent = new Map<Uint8Array, string[]>();
  const rows: StoredTextDocument[] = documents.map((d, i) => {
    const content = new Uint8Array([i]);
    byContent.set(content, d.lines);
    return {
      id: d.id ?? `doc-${i + 1}`,
      fileName: d.fileName ?? "1349963_HU0000865961171_2026.pdf",
      subject:
        d.subject ??
        "Az Ön üzemanyagkártya számlája elkészült, ügyfélazonosítószám: HU00008659",
      content,
      textReading: d.textReading === undefined ? OLD : d.textReading,
      importResult: d.importResult ?? null,
      kind: d.kind === undefined ? "INVOICE" : d.kind,
      origin: d.origin ?? "COLLECTED_MAIL",
    };
  });
  return {
    saved,
    deps: {
      documents: async () => rows,
      lines: async (content: Uint8Array) => byContent.get(content)!,
      navNumbers: async (base: string) =>
        base === "25103272" ? ["E0401374511"] : [],
      save: async (
        id: string,
        reading: InvoiceTextReading,
        kind: string | null,
      ) =>
        void saved.push({
          id,
          reading,
          ...(kind !== "INVOICE" ? { kind } : {}),
        }),
    },
  };
}

const SELECT = { ids: [], number: "HU00008659" };

describe("re-reading a stored document's text", () => {
  it("the FleetCor document gets its NAV number and tax number; the bank reference stays", async () => {
    const { deps: d, saved } = deps([{ lines: FLEETCOR }]);
    const rows = await rereadStoredText(d, SELECT, true);
    assert.deepEqual(rows[0]!.after, {
      invoiceNumber: "E0401374511",
      numberFrom: "NAV",
      supplierTaxNumber: "25103272-2-42",
      kind: "INVOICE",
    });
    assert.equal(rows[0]!.changed, true);
    assert.deepEqual(saved, [
      {
        id: "doc-1",
        reading: {
          invoiceNumber: "E0401374511",
          numberFrom: "NAV",
          supplierTaxNumber: "25103272-2-42",
          bankReference: "HU00008659",
        },
      },
    ]);
  });

  it("dry by default: reports, writes nothing", async () => {
    const { deps: d, saved } = deps([{ lines: FLEETCOR }]);
    const rows = await rereadStoredText(d, SELECT, false);
    assert.equal(rows[0]!.changed, true);
    assert.deepEqual(saved, []);
  });

  it("an adapter-read document is left alone; an unchanged one is not written", async () => {
    const same: InvoiceTextReading = {
      invoiceNumber: "E0401374511",
      numberFrom: "NAV",
      supplierTaxNumber: "25103272-2-42",
    };
    const { deps: d, saved } = deps([
      { lines: FLEETCOR, importResult: { invoiceNumber: "X" } },
      { lines: FLEETCOR, textReading: same },
    ]);
    const rows = await rereadStoredText(d, SELECT, true);
    assert.deepEqual(
      rows.map((r) => [r.skipped, r.changed]),
      [
        ["ADAPTER_READ", false],
        [null, false],
      ],
    );
    assert.deepEqual(saved, []);
  });

  it("no number found: a good old number stays, a customer id does not", async () => {
    const noLabel = FLEETCOR.filter((l) => !l.startsWith("Számla száma"));
    const { deps: d } = deps([
      {
        lines: noLabel,
        textReading: { ...OLD, invoiceNumber: "F2602896", numberFrom: "BANK" },
      },
      { lines: noLabel },
    ]);
    const rows = await rereadStoredText(d, SELECT, false);
    assert.deepEqual(
      rows.map((r) => [r.after!.invoiceNumber, r.after!.numberFrom]),
      [
        ["F2602896", "BANK"],
        [null, null],
      ],
    );
  });

  /*
    acrobot 26157: a FleetCor SZAMLA-ATTEKINTES (info@, PDF_1307442_...) a
    tarolt BANK:HU00008659 olvasatot uresre irta volna a szaraz korben. MI
    PIROSIT: ha egy meglevo szam engedely nelkul uresre irodik, vagy ha az
    engedellyel sem.
  */
  it("a number is never cleared without --allow-clear (FleetCor overview)", async () => {
    const overview = [
      "Hivatkozási szám | E0401328435 | Fizetési határidő | 08.06.2026 | Számla kiállító | FleetCor Hungary Kft.",
      "Ügyfélazonosító szám | HU00008659 | ACROPORA KFT. | Számlaáttekintés",
      "Dokumentumszám | 1307442 | 1106 BUDAPEST",
    ];
    const bank = { ...OLD, numberFrom: "BANK" as const };
    const held = deps([{ lines: overview, textReading: bank }]);
    const rows = await rereadStoredText(held.deps, SELECT, true);
    assert.equal(rows[0]!.skipped, "WOULD_CLEAR");
    assert.deepEqual(rows[0]!.after, {
      invoiceNumber: null,
      numberFrom: null,
      supplierTaxNumber: null,
      kind: "INVOICE",
    });
    assert.deepEqual(held.saved, []);

    const allowed = deps([{ lines: overview, textReading: bank }]);
    await rereadStoredText(allowed.deps, SELECT, true, true);
    assert.deepEqual(allowed.saved, [
      {
        id: "doc-1",
        reading: {
          invoiceNumber: null,
          numberFrom: null,
          supplierTaxNumber: null,
          bankReference: "HU00008659",
        },
      },
    ]);
  });

  /*
    acrobot 26158: az UNAS havi dijbekeroje a VEVO (sajat) adoszamat kapta
    szamnak a banki agon, es szamlakent allhat. A sorok a PDF-olvaso valodi
    kimenete (exchange, 054517_2026-08-17.pdf). MI PIROSIT: ha a sajat
    adoszam szam vagy banki hivatkozas marad, vagy ha a dijbekero fajtaja nem
    lesz PROFORMA.
  */
  it("an UNAS pro forma gets its Sorszám, PROFORMA, and loses our tax number", async () => {
    const unas = [
      "Díjbekérő",
      "Sorszám: | DN-1853781",
      "Eladó: | Vevő:",
      "UNAS Online Kft. | Acropora Kft.",
      "Adószám: | 14114113-2-08 | Adószám: | 23916229-2-42",
      "Kelt | Fizetési határidő | Oldal | Ügyfélazonosító",
      "2026.08.17 | 2026.08.31 | 1/1 | 054517",
    ];
    const ours: InvoiceTextReading = {
      invoiceNumber: "23916229-2-42",
      numberFrom: "BANK",
      supplierTaxNumber: "14114113-2-08",
      bankReference: "23916229-2-42",
    };
    const { deps: d, saved } = deps([
      { lines: unas, textReading: ours, fileName: "054517_2026-08-17.pdf" },
    ]);
    const rows = await rereadStoredText(d, SELECT, true);
    assert.deepEqual(rows[0]!.after, {
      invoiceNumber: "DN-1853781",
      numberFrom: "LABEL",
      supplierTaxNumber: "14114113-2-08",
      kind: "PROFORMA",
    });
    assert.deepEqual(saved, [
      {
        id: "doc-1",
        reading: {
          invoiceNumber: "DN-1853781",
          numberFrom: "LABEL",
          supplierTaxNumber: "14114113-2-08",
        },
        kind: "PROFORMA",
      },
    ]);
  });

  it("an upload's kind is never changed, and a pro forma never goes back", async () => {
    const lines = ["Díjbekérő", "Sorszám: | DN-1", "Adószám: | 14114113-2-08"];
    const { deps: d } = deps([
      { lines, origin: "UPLOAD", textReading: null },
      {
        lines: ["Számla", "Számla száma: | X-12345"],
        kind: "PROFORMA",
        textReading: null,
      },
    ]);
    const rows = await rereadStoredText(d, SELECT, false);
    assert.deepEqual(
      rows.map((r) => r.after!.kind),
      ["INVOICE", "PROFORMA"],
    );
  });

  it("the command needs an explicit selection", () => {
    assert.equal(parseSelector(["--apply"]), null);
    assert.deepEqual(parseSelector(["--ids", "a, b", "--apply"]), {
      ids: ["a", "b"],
      number: null,
    });
    assert.deepEqual(parseSelector(["--number", "HU00008659"]), {
      ids: [],
      number: "HU00008659",
    });
    // a 2026-10-05 előtti olvasatlan feltöltések pótlása (barracuda mérése: 19)
    assert.deepEqual(parseSelector(["--unread-uploads", "--apply"]), {
      ids: [],
      number: null,
      unreadUploads: true,
    });
  });
});
