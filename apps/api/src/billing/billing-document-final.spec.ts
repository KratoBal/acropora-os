import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { deductedAdvanceOf } from "./billing-document-detail-read.js";
import {
  externalDocumentType,
  EXTERNAL_KIND_TYPES,
} from "./billing-document-list.js";
import {
  BillingDocumentsRepository,
  type BillingDocumentRow,
} from "./billing-documents.repository.js";
import {
  advanceIdFor,
  BillingDocumentsService,
  finalIdFor,
} from "./billing-documents.service.js";
import type { QuoteBasis } from "./billing-final-lines.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * ELŐLEGSZÁMLÁBÓL VÉGSZÁMLA (számlázási brief, 3. pont). MI PIROSÍT: nem
 * kiállított előlegből, egy számlából vagy egy sztornózott előlegből is
 * készül végszámla; a vázlat nem a díjbekérő (vagy az előleg) tételeiből és
 * nem az előleg vevőjével, pénznemével, formátumával készül; nem kötődik az
 * előleghez; egy második kattintás második vázlatot ad; üres lapról vagy egy
 * másik típus átírásával is lesz végszámla, vagy a végszámla átírható más
 * típusra; a részletek nem mutatják a kapcsot.
 */
const USER = { id: "user-1" } as AuthenticatedUser;
const d = (value: string) => new Prisma.Decimal(value);

const line = (id: string, description: string, unitNet: string) => ({
  id,
  position: 0,
  kind: "ITEM",
  parentLineId: null,
  productId: `prod-${id}`,
  variantId: null,
  description,
  quantity: d("1"),
  unit: "db",
  unitNet: d(unitNet),
  vatRatePercent: d("27"),
  discountPercent: null,
  netAmount: d(unitNet),
  vatAmount: d("0"),
  grossAmount: d("0"),
  comment: null,
});

function doc(over: Record<string, unknown> = {}) {
  return {
    id: "adv-1",
    status: "ISSUED",
    documentType: "ADVANCE_INVOICE",
    invoiceNumber: "E-ELO-1",
    invoiceFormat: "PAPER",
    customerId: "cust-1",
    fulfillmentDate: null,
    dueDate: null,
    paymentMethod: "Átutalás",
    currency: "EUR",
    language: "de",
    reference: "PROJ-7",
    note: "30% előleg",
    sourceType: "PROJECT",
    sourceId: "proj-7",
    proformaInvoiceId: null,
    emailStatus: null,
    partnerName: "Kitalált Kft.",
    grossAmount: d("381"),
    lines: [line("e", "Előleg a PROJ-7 projektre", "300")],
    correctionInvoices: [],
    mailDeliveries: [],
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-01T10:00:00Z"),
    ...over,
  } as unknown as BillingDocumentRow;
}

function setup(
  start: Record<string, BillingDocumentRow>,
  options: {
    feedCancelled?: boolean;
    /** The quote basis of a proforma id (`quoteBasisOfProforma`); missing: not a milestone proforma. */
    quoteBasis?: Record<string, QuoteBasis | null>;
  } = {},
) {
  const rows = { ...start };
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const repository = {
    find: async (id: string) => rows[id] ?? null,
    customer: async () => ({
      companyName: "Kitalált Kft.",
      displayName: "Kitalált",
      taxNumber: "12345678-2-42",
    }),
    create: async (input: Record<string, unknown> & { id: string }) => {
      created.push(input);
      rows[input.id] = doc({
        id: input.id,
        status: "DRAFT",
        documentType: "FINAL_INVOICE",
        invoiceNumber: null,
        referencedInvoice: {
          id: (input.referencedInvoiceId as string | undefined) ?? "adv-1",
          documentType: "ADVANCE_INVOICE",
          invoiceNumber: "E-ELO-1",
          grossAmount: d("381"),
        },
      });
      return { created: true };
    },
    update: async (input: Record<string, unknown>) => {
      updated.push(input);
      return "ok";
    },
    feedPaid: async () => null,
    quoteBasisOfProforma: async (id: string) =>
      options.quoteBasis?.[id] ?? null,
    related: async () => ({ documents: [], truncated: false }),
    feedTwinCancelled: async () => options.feedCancelled ?? false,
    finalInvoiceOf: async (advanceId: string) => {
      const final = rows[finalIdFor(advanceId)];
      return final
        ? {
            id: final.id,
            invoiceNumber: final.invoiceNumber,
            status: final.status,
          }
        : null;
    },
  } as unknown as BillingDocumentsRepository;
  return {
    service: new BillingDocumentsService(repository),
    created,
    updated,
  };
}

describe("a final invoice from an advance", () => {
  it("only from an issued, numbered advance invoice", async () => {
    await assert.rejects(
      setup({}).service.finalFromAdvance("adv-1", USER),
      NotFoundException,
    );
    for (const over of [
      { status: "DRAFT" },
      { documentType: "INVOICE" },
      { documentType: "PROFORMA" },
      { invoiceNumber: null },
    ]) {
      const s = setup({ "adv-1": doc(over) });
      await assert.rejects(
        s.service.finalFromAdvance("adv-1", USER),
        ConflictException,
        JSON.stringify(over),
      );
      assert.equal(s.created.length, 0);
    }
  });

  it("a draft bound to the advance: its customer, currency, format and reference; with no proforma it starts with no items (barracuda, #1672)", async () => {
    const s = setup({ "adv-1": doc() });
    const detail = await s.service.finalFromAdvance("adv-1", USER);
    assert.equal(s.created.length, 1);
    const input = s.created[0] as {
      id: string;
      referencedInvoiceId: string;
      proformaInvoiceId?: string;
      draft: {
        documentType: string;
        invoiceFormat: string;
        customerId: string;
        currency: string;
        reference: string;
        note: string | null;
        lines: { kind: string; description: string }[];
      };
    };
    assert.deepEqual(
      [
        input.id,
        input.referencedInvoiceId,
        input.proformaInvoiceId,
        input.draft.documentType,
        input.draft.invoiceFormat,
        input.draft.customerId,
        input.draft.currency,
        input.draft.reference,
        input.draft.note,
        input.draft.lines.map((l) => [l.kind, l.description]),
      ],
      [
        finalIdFor("adv-1"),
        "adv-1",
        undefined,
        "FINAL_INVOICE",
        "PAPER",
        "cust-1",
        "EUR",
        "PROJ-7",
        // the advance's note is about the advance, not about the final one
        null,
        // the advance's own line is the advance ("30%"): from it Számlázz.hu
        // would deduct the same, a zero final invoice; the operator enters
        // the full items
        [],
      ],
    );
    // no deduction line: Számlázz.hu deducts the advance (brief, 3.)
    assert.ok(
      input.draft.lines.every((l) => !/előleg levonás/i.test(l.description)),
    );
    assert.deepEqual(detail.deductedAdvance, {
      id: "adv-1",
      number: "E-ELO-1",
      grossAmount: "381.0000",
    });
  });

  it("from an advance made from a proforma: the proforma's items, the full price", async () => {
    const s = setup({
      "pro-1": doc({
        id: "pro-1",
        documentType: "PROFORMA",
        invoiceNumber: "D-2026-7",
        lines: [line("a", "Akvárium", "1000"), line("b", "Szűrő", "200")],
      }),
      [advanceIdFor("pro-1")]: doc({
        id: advanceIdFor("pro-1"),
        proformaInvoiceId: "pro-1",
      }),
    });
    await s.service.finalFromAdvance(advanceIdFor("pro-1"), USER);
    const input = s.created[0] as {
      draft: { lines: { description: string; unitNet: string }[] };
    };
    assert.deepEqual(
      input.draft.lines.map((l) => l.description),
      ["Akvárium", "Szűrő"],
    );
  });

  // the webshop order's final invoice (card d31a66a3, S4): the caller gives the whole order's lines, the advance proforma's single
  // advance line would leave nothing to pay. What turns this red: the given lines ignored, the proforma's taken instead.
  it("a webshop final invoice takes the lines its caller gives, not the advance proforma's", async () => {
    const s = setup({
      "pro-1": doc({
        id: "pro-1",
        documentType: "PROFORMA",
        invoiceNumber: "D-2026-7",
        lines: [line("a", "Előleg: webshop rendelés #38", "3780")],
      }),
      [advanceIdFor("pro-1")]: doc({
        id: advanceIdFor("pro-1"),
        proformaInvoiceId: "pro-1",
      }),
    });
    await s.service.finalFromAdvance(advanceIdFor("pro-1"), USER, {
      lines: [
        {
          productId: null,
          description: "Coral Food",
          quantity: "3",
          unit: "db",
          unitNet: "3937.0079",
          vatRatePercent: "27",
          discountPercent: null,
          comment: null,
        },
      ],
    });
    const input = s.created[0] as {
      draft: { lines: { description: string }[] };
    };
    assert.deepEqual(
      input.draft.lines.map((l) => l.description),
      ["Coral Food"],
    );
  });

  /*
    A MÉRFÖLDKŐ-DÍJBEKÉRŐBŐL KÉSZÜLT ELŐLEG VÉGSZÁMLÁJA (kártya 2650d371, Balázs kérdése): a mérföldkő-díjbekérő a százalékos rész, tehát a
    végszámla az AJÁNLAT teljes elfogadott tételeivel készül, különben a Számlázz.hu a levont előleg után nullát hagy. MI PIROSÍT: ha egy
    60%-os mérföldkő díjbekérőjének tétele kerül a végszámlára; ha a 100%-os mérföldkő, a kézi (kötés nélküli) díjbekérő vagy a teljes
    ellenértékű díjbekérő az ajánlat tételeit kapná; ha a kötött, de tétel nélküli ajánlatnál csendben a százalékos sor maradna.
  */
  describe("from the advance of a quote milestone's proforma (card 2650d371)", () => {
    const basis = (
      percent: string,
      names: string[],
      otherProformaMilestones = 0,
    ): QuoteBasis => ({
      quoteNumber: "AJ-2026-0015",
      percent: d(percent),
      otherProformaMilestones,
      items: names.map((name) => ({
        name,
        quantity: d("1"),
        unit: "db",
        unitNetPrice: d("1000"),
        vatRatePercent: d("27"),
      })),
    });
    const withProforma = (quoteBasis: Record<string, QuoteBasis | null>) =>
      setup(
        {
          "pro-1": doc({
            id: "pro-1",
            documentType: "PROFORMA",
            invoiceNumber: "D-CRPR-7",
            lines: [line("a", "Előleg (60%), AJ-2026-0015", "600")],
          }),
          [advanceIdFor("pro-1")]: doc({
            id: advanceIdFor("pro-1"),
            proformaInvoiceId: "pro-1",
          }),
        },
        { quoteBasis },
      );
    const linesOf = (s: ReturnType<typeof setup>) =>
      (
        s.created[0] as {
          draft: { lines: { description: string; unitNet: string }[] };
        }
      ).draft.lines.map((l) => [l.description, l.unitNet]);

    it("a 60 percent milestone proforma: the quote's full items, not the proforma's percentage line", async () => {
      const s = withProforma({
        "pro-1": basis("60", ["Akvárium", "Szűrő"]),
      });
      await s.service.finalFromAdvance(advanceIdFor("pro-1"), USER);
      assert.deepEqual(linesOf(s), [
        ["Akvárium", "1000"],
        ["Szűrő", "1000"],
      ]);
    });

    it("a 100 percent milestone proforma, a hand-made proforma with no milestone, and the full-price proforma keep the proforma's items", async () => {
      const cases: Record<string, QuoteBasis | null>[] = [
        { "pro-1": basis("100", ["Akvárium", "Szűrő"]) },
        { "pro-1": null },
        {},
      ];
      for (const quoteBasis of cases) {
        const s = withProforma(quoteBasis);
        await s.service.finalFromAdvance(advanceIdFor("pro-1"), USER);
        assert.deepEqual(
          linesOf(s),
          [["Előleg (60%), AJ-2026-0015", "600"]],
          JSON.stringify(Object.keys(quoteBasis)),
        );
      }
    });

    it("a quote with another proforma milestone: an empty draft, neither the percentage line nor the full items (barracuda, #2639)", async () => {
      const s = withProforma({
        "pro-1": basis("30", ["Akvárium", "Szűrő"], 1),
      });
      await s.service.finalFromAdvance(advanceIdFor("pro-1"), USER);
      assert.equal(s.created.length, 1);
      assert.deepEqual(linesOf(s), []);
    });

    it("the empty draft says why on the page: the detail carries the notice only for the multiple-advance case (card 02fc4b7f)", async () => {
      const multiple = withProforma({
        "pro-1": basis("30", ["Akvárium", "Szűrő"], 1),
      });
      const detail = await multiple.service.finalFromAdvance(
        advanceIdFor("pro-1"),
        USER,
      );
      assert.equal(detail.finalInvoiceNotice?.code, "MULTIPLE_ADVANCES");
      assert.match(detail.finalInvoiceNotice!.message, /több előleg-mérföldkö/);
      for (const quoteBasis of [
        { "pro-1": basis("60", ["Akvárium"], 0) },
        { "pro-1": basis("100", ["Akvárium"], 1) },
        { "pro-1": null },
      ]) {
        const single = withProforma(quoteBasis);
        const other = await single.service.finalFromAdvance(
          advanceIdFor("pro-1"),
          USER,
        );
        assert.equal(other.finalInvoiceNotice ?? null, null);
      }
    });

    it("an issued final invoice carries no notice, even for the multiple-advance quote", async () => {
      const finalId = finalIdFor(advanceIdFor("pro-1"));
      const s = setup(
        {
          "pro-1": doc({
            id: "pro-1",
            documentType: "PROFORMA",
            invoiceNumber: "D-CRPR-7",
            lines: [line("a", "Előleg (30%), AJ-2026-0015", "300")],
          }),
          [advanceIdFor("pro-1")]: doc({
            id: advanceIdFor("pro-1"),
            proformaInvoiceId: "pro-1",
          }),
          [finalId]: doc({
            id: finalId,
            documentType: "FINAL_INVOICE",
            status: "ISSUED",
            invoiceNumber: "E-FIN-1",
            referencedInvoice: {
              id: advanceIdFor("pro-1"),
              documentType: "ADVANCE_INVOICE",
              invoiceNumber: "E-ELO-1",
              grossAmount: d("381"),
            },
          }),
        },
        { quoteBasis: { "pro-1": basis("30", ["Akvárium"], 1) } },
      );
      const detail = await s.service.detail(finalId);
      assert.equal(detail.finalInvoiceNotice ?? null, null);
    });

    it("a milestone with a proforma next to one with none yet (the closing part): the quote's full items", async () => {
      const s = withProforma({
        "pro-1": basis("60", ["Akvárium", "Szűrő"], 0),
      });
      await s.service.finalFromAdvance(advanceIdFor("pro-1"), USER);
      assert.deepEqual(linesOf(s), [
        ["Akvárium", "1000"],
        ["Szűrő", "1000"],
      ]);
    });

    it("a tied quote with no accepted items refuses, makes no draft and does not fall back to the percentage line", async () => {
      const s = withProforma({ "pro-1": basis("60", []) });
      await assert.rejects(
        s.service.finalFromAdvance(advanceIdFor("pro-1"), USER),
        ConflictException,
      );
      assert.equal(s.created.length, 0);
    });
  });

  it("a second click gets the same draft, and makes no second one", async () => {
    const s = setup({ "adv-1": doc() });
    const first = await s.service.finalFromAdvance("adv-1", USER);
    const second = await s.service.finalFromAdvance("adv-1", USER);
    assert.deepEqual(
      [first.id, second.id, s.created.length],
      [finalIdFor("adv-1"), finalIdFor("adv-1"), 1],
    );
  });

  it("a stornoed advance, in the OS or on Számlázz.hu: nothing to deduct, no draft", async () => {
    for (const s of [
      setup({
        "adv-1": doc({
          correctionInvoices: [{ id: "st-1", status: "ISSUED" }],
        }),
      }),
      setup({ "adv-1": doc() }, { feedCancelled: true }),
    ]) {
      await assert.rejects(
        s.service.finalFromAdvance("adv-1", USER),
        (error: unknown) =>
          error instanceof ConflictException &&
          /E-ELO-1.*sztornózták/.test(error.message),
      );
      assert.equal(s.created.length, 0);
    }
  });

  it("a draft made before the advance was stornoed is not handed back", async () => {
    const s = setup({
      "adv-1": doc({ correctionInvoices: [{ id: "st-1", status: "ISSUED" }] }),
      [finalIdFor("adv-1")]: doc({
        id: finalIdFor("adv-1"),
        status: "DRAFT",
        documentType: "FINAL_INVOICE",
        invoiceNumber: null,
      }),
    });
    await assert.rejects(
      s.service.finalFromAdvance("adv-1", USER),
      (error: unknown) =>
        error instanceof ConflictException &&
        /E-ELO-1.*sztornózták/.test(error.message),
    );
  });

  it("a stornoed final invoice: no new one from the same advance, and it says why", async () => {
    const s = setup({
      "adv-1": doc(),
      [finalIdFor("adv-1")]: doc({
        id: finalIdFor("adv-1"),
        documentType: "FINAL_INVOICE",
        invoiceNumber: "E-VEG-1",
        correctionInvoices: [{ id: "st-2", status: "ISSUED" }],
      }),
    });
    await assert.rejects(
      s.service.finalFromAdvance("adv-1", USER),
      (error: unknown) =>
        error instanceof ConflictException &&
        /E-VEG-1.*sztornózták/.test(error.message),
    );
    assert.equal(s.created.length, 0);
  });

  it("the advance's details name its final invoice", async () => {
    const s = setup({ "adv-1": doc() });
    assert.equal((await s.service.detail("adv-1")).finalInvoice, null);
    await s.service.finalFromAdvance("adv-1", USER);
    assert.deepEqual((await s.service.detail("adv-1")).finalInvoice, {
      id: finalIdFor("adv-1"),
      number: null,
      status: "DRAFT",
    });
  });
});

describe("a final invoice only through its advance", () => {
  const draft = (documentType: string) =>
    ({
      documentType,
      invoiceFormat: "ELECTRONIC",
      customerId: "cust-1",
      fulfillmentDate: null,
      dueDate: null,
      paymentMethod: "Átutalás",
      currency: "HUF",
      language: "hu",
      reference: null,
      note: null,
      sourceType: "MANUAL",
      sourceId: null,
      lines: [],
      expectedUpdatedAt: "2026-10-01T10:00:00.000Z",
    }) as unknown as BillingDocumentDraftDto;

  it("not from an empty page", async () => {
    const s = setup({});
    await assert.rejects(
      s.service.create(draft("FINAL_INVOICE"), USER),
      BadRequestException,
    );
    assert.equal(s.created.length, 0);
  });

  it("a saved draft keeps its kind: no final invoice from another type, and no other type from a final invoice", async () => {
    const s = setup({
      "inv-1": doc({ id: "inv-1", status: "DRAFT", documentType: "INVOICE" }),
      "fin-1": doc({
        id: "fin-1",
        status: "DRAFT",
        documentType: "FINAL_INVOICE",
      }),
    });
    await assert.rejects(
      s.service.update("inv-1", draft("FINAL_INVOICE")),
      BadRequestException,
    );
    await assert.rejects(
      s.service.update("fin-1", draft("INVOICE")),
      BadRequestException,
    );
    assert.equal(s.updated.length, 0);
    await s.service.update("fin-1", draft("FINAL_INVOICE"));
    assert.equal(s.updated.length, 1);
  });
});

describe("the deducted advance on the details", () => {
  it("only on a final invoice: a storno row points back too, and is not one", () => {
    const referencedInvoice = {
      id: "adv-1",
      documentType: "ADVANCE_INVOICE",
      invoiceNumber: "E-ELO-1",
      grossAmount: null,
    };
    assert.deepEqual(
      deductedAdvanceOf({
        documentType: "FINAL_INVOICE",
        referencedInvoice,
      } as never),
      { id: "adv-1", number: "E-ELO-1", grossAmount: null },
    );
    assert.equal(
      deductedAdvanceOf({ documentType: "STORNO", referencedInvoice } as never),
      null,
    );
    assert.equal(
      deductedAdvanceOf({ documentType: "FINAL_INVOICE" } as never),
      null,
    );
  });
});

describe("Számlázz.hu's own final invoice on the list", () => {
  it("is filed as a final invoice, the rest of the invoice kinds stay invoices", () => {
    assert.equal(externalDocumentType("VS"), "FINAL_INVOICE");
    assert.deepEqual(
      Object.entries(EXTERNAL_KIND_TYPES)
        .filter(([, type]) => type === "INVOICE")
        .map(([code]) => code),
      ["SZ", "SS", "JS", "HS"],
    );
  });
});

/*
  AMIT A KÉT ŐR OLVAS, A LEKÉRDEZÉS HOZZA-E (barracuda, #1672). MI PIROSÍT: a
  bizonylat lekérdezése nem hozza az előleg kiállított sztornóját vagy
  pénznemét, vagy a végszámla-lekérdezés a végszámla sztornóját; ilyenkor az
  őrök a hiányzó mezőt üresnek veszik, és CSENDBEN átengednek.
*/
describe("what the two guards read, the queries bring", () => {
  const captured = () => {
    const calls: { where: unknown; include?: any; select?: any }[] = [];
    const repository = new BillingDocumentsRepository();
    (repository as unknown as { database: unknown }).database = {
      invoice: {
        findFirst: async (args: { where: unknown }) => {
          calls.push(args);
          return null;
        },
      },
    };
    return { repository, calls };
  };

  it("a document brings its advance's issued storno and currency", async () => {
    const { repository, calls } = captured();
    await repository.find("fin-1");
    const advance = calls[0]!.include.referencedInvoice.select;
    assert.deepEqual(
      [advance.invoiceNumber, advance.grossAmount, advance.currency],
      [true, true, true],
    );
    assert.deepEqual(advance.correctionInvoices.where, {
      documentType: "STORNO",
      status: "ISSUED",
    });
  });

  it("an advance's final invoice brings its own issued storno", async () => {
    const { repository, calls } = captured();
    await repository.finalInvoiceOf("adv-1");
    assert.deepEqual(
      [
        (calls[0]!.where as Record<string, unknown>).referencedInvoiceId,
        (calls[0]!.where as Record<string, unknown>).documentType,
        calls[0]!.select.correctionInvoices.where,
      ],
      ["adv-1", "FINAL_INVOICE", { documentType: "STORNO", status: "ISSUED" }],
    );
  });
});
