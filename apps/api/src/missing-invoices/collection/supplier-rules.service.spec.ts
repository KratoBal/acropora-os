import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";
import PDFDocument from "pdfkit";

import { registerEmbeddedPdfFont } from "../../documents/pdf/branded-document.js";
import type { InvoiceCollectionSuggestionsRepository } from "./invoice-collection-suggestions.repository.js";
import type { SupplierRulesRepository } from "./supplier-rules.repository.js";
import { SupplierRulesService } from "./supplier-rules.service.js";

/*
  AZ ISMERT SZÁLLÍTÓ SZABÁLYA A LAPRÓL (acrobot 57881, 57884). MI PIROSÍT: ha a szabály az elfogadás ELŐTT nem ellenőrződik (egy hibás
  kérés elfogadna egy PDF-et); ha a név, ami nincs a PDF-ben, szabály lesz; ha a név alapú szabály saját továbbítótól él; ha a
  köteges elfogadás az összeg nélküli vagy a kiugró PDF-et is viszi; ha a másik szállító PDF-je elfogad; ha a visszavonás közben
  párosult dokumentumot is visszavon; ha az előnézet nem jelzi, hogy ugyanattól a feladótól más adószámok állnak.
*/
function pdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 20 });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    registerEmbeddedPdfFont(doc).fontSize(10);
    lines.forEach((line, i) => doc.text(line, 30, 40 + i * 16));
    doc.end();
  });
}

const USER = { id: "user-1" } as unknown as AuthenticatedUser;
const ENV = {
  INVOICE_COLLECTION_ENABLED: "true",
  INVOICE_SUPPLIER_RULES: "live",
  // the info@ mailbox (the collection's first source): its domain is a trusted forwarder
  GMAIL_FOXPOST_CLIENT_ID: "c",
  GMAIL_FOXPOST_CLIENT_SECRET: "s",
  GMAIL_FOXPOST_REFRESH_TOKEN: "r",
};

interface Doc {
  id: string;
  sender: string;
  tax: string | null;
  gross: string | null;
  currency: string | null;
  lines: string[];
}

async function setup(documents: Doc[], mailboxUser = "info@acropora.hu") {
  const contents = new Map(
    await Promise.all(
      documents.map(
        async (d) => [d.id, await pdf(d.lines)] as [string, Buffer],
      ),
    ),
  );
  const accepted: string[] = [];
  const created: Record<string, unknown>[] = [];
  const recorded: Record<string, unknown>[] = [];
  const disabled: string[] = [];
  let undoResult: "UNDONE" | "NOT_FOUND" | "IN_USE" = "UNDONE";
  const rules = {
    pendingForRules: async () =>
      documents.map((d) => ({
        id: d.id,
        fileName: `${d.id}.pdf`,
        sender: d.sender,
        payeeCheck: "COMPANY",
        textReading: {
          supplierTaxNumber: d.tax,
          gross: d.gross,
          currency: d.currency,
        },
      })),
    content: async (id: string) => contents.get(id) ?? null,
    create: async (input: Record<string, unknown>) => {
      created.push(input);
      return { id: `rule-${created.length}`, created: true };
    },
    recordAccepted: async (input: Record<string, unknown>) => {
      recorded.push(input);
      return true;
    },
    disable: async (id: string) => {
      disabled.push(id);
      return id !== "gone";
    },
    undoAccepted: async () => undoResult,
    list: async () => [],
    autoAcceptedSince: async () => [],
  } as unknown as SupplierRulesRepository;
  const suggestions = {
    accept: async (id: string) => {
      accepted.push(id);
      return true;
    },
  } as unknown as InvoiceCollectionSuggestionsRepository;
  void mailboxUser;
  return {
    service: new SupplierRulesService(rules, suggestions, ENV),
    accepted,
    created,
    recorded,
    disabled,
    setUndo: (value: typeof undoResult) => void (undoResult = value),
  };
}

const lines = (total: string, vat = "DE152405660") => [
  "Invoice",
  `Supplier VAT: ${vat}`,
  "Bill to: Acropora Kft. Budapest",
  total,
];
const vendor = (id: string, over: Partial<Doc> = {}): Doc => ({
  id,
  sender: "billing@hetzner.example",
  tax: "DE152405660",
  gross: "49.5",
  currency: "EUR",
  lines: lines("Amount due: 49.50 EUR"),
  ...over,
});

describe("SupplierRulesService: accept with a rule", () => {
  it("accepts the PDF, creates a TAX rule bound to the external sender, and with alsoPending accepts the other PDFs of the same vendor only", async () => {
    const { service, accepted, created, recorded } = await setup([
      vendor("d1"),
      vendor("d2", { gross: "20", lines: lines("Amount due: 20.00 EUR") }),
      // another vendor's tax number, the same sender: not accepted
      vendor("d3", {
        tax: "DE999999999",
        lines: lines("Amount due: 49.50 EUR", "DE999999999"),
      }),
      // an outlier amount (more than 3x the first PDF's): left for a person
      vendor("d4", { gross: "400", lines: lines("Amount due: 400.00 EUR") }),
      // no readable amount: left for a person
      vendor("d5", { gross: null, currency: null, lines: lines("Thank you") }),
      // another sender with the same tax number: not accepted
      vendor("d6", { sender: "x@evil.example" }),
    ]);
    const result = await service.acceptWithRule(
      "d1",
      { kind: "TAX", alsoPending: true },
      USER,
    );
    assert.deepEqual(accepted, ["d1", "d2"]);
    assert.equal(created.length, 1);
    assert.deepEqual(
      [created[0]!.kind, created[0]!.taxKey, created[0]!.senderDomain],
      ["TAX", "DE152405660", "hetzner.example"],
    );
    assert.deepEqual(created[0]!.grossCeilings, { EUR: 4950 });
    assert.deepEqual(
      recorded.map((r) => [r.documentId, r.userId, r.grossCents]),
      [["d2", "user-1", 2000]],
    );
    assert.deepEqual(result, {
      ruleId: "rule-1",
      created: true,
      alsoAccepted: 1,
    });
  });

  it("does not accept the other PDFs unless asked", async () => {
    const { service, accepted } = await setup([vendor("d1"), vendor("d2")]);
    const result = await service.acceptWithRule("d1", { kind: "TAX" }, USER);
    assert.deepEqual(accepted, ["d1"]);
    assert.equal(result.alsoAccepted, 0);
  });

  it("a rule from our own forwarder is not bound to the sender (the forwarder is a trusted channel)", async () => {
    const { service, created } = await setup([
      vendor("d1", { sender: "Luca <luca@acropora.hu>" }),
    ]);
    await service.acceptWithRule("d1", { kind: "TAX" }, USER);
    assert.equal(created[0]!.senderDomain, null);
  });

  it("refuses a TAX rule when the PDF has no readable tax number, and accepts nothing", async () => {
    const { service, accepted, created } = await setup([
      vendor("d1", { tax: null }),
    ]);
    await assert.rejects(
      service.acceptWithRule("d1", { kind: "TAX" }, USER),
      /nincs olvasható adószám/,
    );
    assert.deepEqual([accepted, created], [[], []]);
  });

  it("a NAME rule: the typed name must stand in the PDF text, the sender must be external; nothing is accepted on a bad request", async () => {
    const doc = vendor("d1", {
      tax: null,
      lines: [
        "Tessie Inc. Receipt",
        "Bill to: Acropora Kft. Budapest",
        "Amount due: $8.00 USD",
      ],
      gross: "8",
      currency: "USD",
    });
    const missing = await setup([doc]);
    await assert.rejects(
      missing.service.acceptWithRule(
        "d1",
        { kind: "NAME", vendorName: "Blackmagic" },
        USER,
      ),
      /nem szerepel a PDF szövegében/,
    );
    await assert.rejects(
      missing.service.acceptWithRule("d1", { kind: "NAME" }, USER),
      /szállító neve kell/,
    );
    assert.deepEqual(missing.accepted, []);
    const forwarded = await setup([{ ...doc, sender: "luca@acropora.hu" }]);
    await assert.rejects(
      forwarded.service.acceptWithRule(
        "d1",
        { kind: "NAME", vendorName: "Tessie" },
        USER,
      ),
      /csak külső feladóval él/,
    );
    assert.deepEqual(forwarded.accepted, []);
    const ok = await setup([doc]);
    const result = await ok.service.acceptWithRule(
      "d1",
      { kind: "NAME", vendorName: "Tessie" },
      USER,
    );
    assert.equal(result.created, true);
    assert.deepEqual(
      [ok.created[0]!.kind, ok.created[0]!.nameKey, ok.created[0]!.taxKey],
      ["NAME", "tessie", null],
    );
  });

  it("a typed abbreviation of three letters is a key (GLS), when the PDF has it", async () => {
    const { service, created } = await setup([
      vendor("d1", {
        tax: null,
        lines: [
          "GLS General Logistics Systems Hungary Kft.",
          "Bill to: Acropora Kft. Budapest",
          "Fizetendő: 15 240 Ft",
        ],
        gross: "15240",
        currency: "HUF",
      }),
    ]);
    await service.acceptWithRule(
      "d1",
      { kind: "NAME", vendorName: "GLS" },
      USER,
    );
    assert.equal(created[0]!.nameKey, "gls");
  });

  it("an unknown PDF is a not found, and a PDF decided meanwhile is a conflict", async () => {
    const { service } = await setup([vendor("d1")]);
    await assert.rejects(
      service.acceptWithRule("nope", { kind: "TAX" }, USER),
      /Nincs ilyen döntésre váró/,
    );
  });
});

describe("SupplierRulesService: the switch and what a PDF allows", () => {
  it("with the rules off, accepting with a rule is a conflict and accepts nothing (the hidden page and the server say the same)", async () => {
    const made = await setup([vendor("d1")]);
    const off = new SupplierRulesService(
      (made.service as unknown as { rules: SupplierRulesRepository }).rules,
      (
        made.service as unknown as {
          suggestions: InvoiceCollectionSuggestionsRepository;
        }
      ).suggestions,
      { ...ENV, INVOICE_SUPPLIER_RULES: "off" },
    );
    await assert.rejects(
      off.acceptWithRule("d1", { kind: "TAX" }, USER),
      /ki vannak kapcsolva/,
    );
    assert.deepEqual(made.accepted, []);
  });

  it("canCreate: a TAX rule needs a tax number and a known sender, a NAME rule an external sender", async () => {
    const { service } = await setup([
      vendor("ext"),
      vendor("fwd", { sender: "luca@acropora.hu" }),
      vendor("fwdNoTax", { sender: "luca@acropora.hu", tax: null }),
      vendor("extNoTax", { tax: null }),
      vendor("noSender", { sender: "nobody" }),
    ]);
    const can = async (id: string) => (await service.preview(id)).canCreate;
    assert.deepEqual(await can("ext"), { TAX: true, NAME: true });
    assert.deepEqual(await can("fwd"), { TAX: true, NAME: false });
    assert.deepEqual(await can("fwdNoTax"), { TAX: false, NAME: false });
    assert.deepEqual(await can("extNoTax"), { TAX: false, NAME: true });
    assert.deepEqual(await can("noSender"), { TAX: false, NAME: false });
  });
});

describe("SupplierRulesService: preview", () => {
  it("counts the other PDFs a rule would take, and flags a sender whose PDFs carry different tax numbers", async () => {
    const { service } = await setup([
      vendor("d1"),
      vendor("d2"),
      vendor("d3", {
        tax: "HU00956903",
        lines: lines("Amount due: 49.50 EUR", "HU00956903"),
      }),
    ]);
    const preview = await service.preview("d1");
    assert.equal(preview.taxKey, "DE152405660");
    assert.equal(preview.externalSender, true);
    assert.equal(preview.pendingCount.TAX, 1);
    assert.equal(preview.pendingCount.NAME, 0);
    assert.equal(preview.taxLooksUnstable, true);
  });

  it("a name that the PDF does not hold is a zero count, and a held one counts the PDFs that carry the name", async () => {
    const docs = ["d1", "d2"].map((id) =>
      vendor(id, {
        tax: null,
        lines: [
          "Tessie Inc. Receipt",
          "Bill to: Acropora Kft. Budapest",
          "Amount due: $8.00 USD",
        ],
        gross: "8",
        currency: "USD",
      }),
    );
    const { service } = await setup(docs);
    assert.equal((await service.preview("d1", "Nobody")).pendingCount.NAME, 0);
    assert.equal((await service.preview("d1", "Tessie")).pendingCount.NAME, 1);
  });
});

describe("SupplierRulesService: disable and undo", () => {
  it("disabling a rule that is gone is a conflict", async () => {
    const { service, disabled } = await setup([]);
    await service.disable("rule-1", USER);
    await assert.rejects(service.disable("gone", USER), /már ki van kapcsolva/);
    assert.deepEqual(disabled, ["rule-1", "gone"]);
  });

  it("an undo reports UNDONE, IN_USE for a document paired meanwhile, and a not found otherwise", async () => {
    const { service, setUndo } = await setup([]);
    assert.equal(await service.undo("d1", USER), "UNDONE");
    setUndo("IN_USE");
    assert.equal(await service.undo("d1", USER), "IN_USE");
    setUndo("NOT_FOUND");
    await assert.rejects(service.undo("d1", USER), /Nincs ilyen automatikusan/);
  });
});
