import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { budapestDayKey } from "../dashboard/budapest-day.js";
import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzAgentResponse } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import type { WebshopOrderInvoiceFact } from "./billing-document-issue.js";
import type { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import type { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import type {
  BillingDocumentRow,
  BillingDocumentsRepository,
} from "./billing-documents.repository.js";

/**
 * A KIÁLLÍTÁS SZOLGÁLTATÁSA, HAMIS SZÁMLÁZZ.HU-VAL. A feltételes foglalást és a
 * sorok visszaírását a valódi adatbázis méri (integrációs spec); ez azt, hogy a
 * szolgáltatás minden kimenetre helyesen dönt, és a Számlázz.hu-t legfeljebb
 * EGYSZER hívja.
 *
 * Mi pirosít: hívás kikapcsolt kapcsolóval; hívás egy kiállított vagy kiállítás
 * alatti bizonylatra; második hívás, ha a foglalás nem sikerült; elutasítás,
 * ami nem ISSUE_FAILED; ismeretlen kimenet, ami nem marad ISSUING-ben; siker,
 * ami nem a kiküldött összegeket és a vevő-snapshotot írja vissza.
 */
const USER = { id: "user-1" } as AuthenticatedUser;
const ON = { BILLING_ISSUE_ENABLED: "true" };
const d = (value: string) => new Prisma.Decimal(value);

function row(status = "DRAFT", invoiceFormat = "ELECTRONIC") {
  return {
    id: "doc-1",
    status,
    emailStatus: null,
    invoiceNumber: status === "ISSUED" ? "E-1" : null,
    documentType: "INVOICE",
    invoiceFormat,
    fulfillmentDate: new Date("2026-09-30T00:00:00Z"),
    dueDate: new Date("2026-10-08T00:00:00Z"),
    paymentMethod: "Átutalás",
    currency: "HUF",
    language: "hu",
    reference: null,
    note: null,
    sourceType: "MANUAL",
    sourceId: null,
    customerId: "cust-1",
    netAmount: d("1000"),
    vatAmount: d("270"),
    grossAmount: d("1270"),
    customer: {
      id: "cust-1",
      customerNumber: "C-1",
      displayName: "Kitalált Kft.",
      companyName: null,
      taxNumber: "12345678-2-42",
      email: "vevo@example.com",
      addresses: [
        {
          type: "BILLING",
          isDefault: true,
          country: "HU",
          postalCode: "1011",
          city: "Budapest",
          line1: "Fő utca 1.",
          line2: null,
        },
      ],
    },
    lines: [
      {
        id: "line-1",
        position: 0,
        kind: "ITEM",
        parentLineId: null,
        productId: null,
        description: "Munkadíj",
        quantity: d("1"),
        unit: "db",
        unitNet: d("1000"),
        vatRatePercent: d("27"),
        discountPercent: null,
        netAmount: d("1000"),
        vatAmount: d("270"),
        grossAmount: d("1270"),
        comment: null,
      },
    ],
    mailDeliveries: [],
    createdAt: new Date("2026-09-30T10:00:00Z"),
    updatedAt: new Date("2026-09-30T10:00:00Z"),
  } as unknown as BillingDocumentRow;
}

function setup(
  options: {
    status?: string;
    format?: string;
    claim?: boolean;
    env?: NodeJS.ProcessEnv;
    respond?: () => Promise<SzamlazzAgentResponse>;
    stockFails?: boolean;
    over?: Record<string, unknown>;
    /** The buyer's payment days (`customerPaymentDueDays`); null: none set. */
    paymentDueDays?: number | null;
    partnerHint?: { partnerName: string; taxNumber: string } | null;
    feedCancelled?: boolean;
    /**
     * What the Számlázz.hu feed knows about the proforma's payment (`proformaPaymentFacts`): the paid amount (the draft's gross is 1270),
     * optionally another currency or a cancelled flag; null: no feed row (the default).
     */
    proformaFacts?: {
      paid: string;
      currency?: string;
      cancelled?: boolean;
    } | null;
    /** A foglalás UTÁN látszó előleg-sztornó (OS: ISSUING/ISSUED; feed). */
    stornoAfterClaim?: "OS" | "FEED";
    /** A forrás-szerződés tételei és a MÁSHOL számlázott sorai, a foglalás előtt / után. */
    contractFacts?: (afterClaim: boolean) => {
      items: Array<{ id: string; quantity: string }>;
      billed: Array<{ contractItemId: string; quantity: string }>;
    };
    /** The webshop order's other invoices (d31a66a3, S1), before / after the claim. */
    webshopInvoices?: (afterClaim: boolean) => WebshopOrderInvoiceFact[];
    /** The webshop transfer that paid the proforma (d31a66a3, S1); null: none (the default). */
    transfer?: { amount: string; advance?: boolean } | null;
    /** Számlázz.hu feed invoices of the order the OS did not issue (the Autokassza check, barracuda on #2884). */
    foreign?: string[];
  } = {},
) {
  const calls = {
    generate: 0,
    claim: 0,
    stock: 0,
    issued: [] as unknown[],
    failed: [] as string[],
    unknown: [] as string[],
    pdf: [] as unknown[],
    resolve: 0,
    excluded: [] as string[][],
    xml: [] as string[],
    paymentDaysFor: [] as string[],
    proformaFactsFor: [] as string[],
    webshopAsked: [] as string[],
  };
  let current = {
    ...row(options.status, options.format),
    ...options.over,
  } as BillingDocumentRow;
  const documents = {
    find: async () => current,
    partnerTaxHint: async () => options.partnerHint ?? null,
    customerPaymentDueDays: async (id: string) => {
      calls.paymentDaysFor.push(id);
      return options.paymentDueDays === undefined ? 30 : options.paymentDueDays;
    },
    proformaPaymentFacts: async (number: string) => {
      calls.proformaFactsFor.push(number);
      const facts = options.proformaFacts;
      return facts
        ? {
            paidAmount: d(facts.paid),
            grossAmount: d("1270"),
            currency: facts.currency ?? "HUF",
            cancelled: facts.cancelled ?? false,
          }
        : null;
    },
    feedTwinCancelled: async () =>
      (options.feedCancelled ?? false) ||
      (options.stornoAfterClaim === "FEED" && calls.claim > 0),
    stornoStarted: async () =>
      options.stornoAfterClaim === "OS" && calls.claim > 0,
    contractBillingFacts: async (_contractId: string, exclude: string[]) => {
      calls.excluded.push(exclude);
      return (
        options.contractFacts?.(calls.claim > 0) ?? { items: [], billed: [] }
      );
    },
    webshopOrderInvoices: async (orderId: string, excludeId: string) => {
      calls.webshopAsked.push(`invoices ${orderId} without ${excludeId}`);
      return options.webshopInvoices?.(calls.claim > 0) ?? [];
    },
    webshopForeignFeedInvoices: async (orderId: string, proformaId: string) => {
      calls.webshopAsked.push(`feed ${orderId} ${proformaId}`);
      return options.foreign ?? [];
    },
    webshopTransferFacts: async (orderId: string, proformaId: string) => {
      calls.webshopAsked.push(`transfer ${orderId} ${proformaId}`);
      return options.transfer
        ? {
            amount: d(options.transfer.amount),
            currency: "HUF",
            advance: options.transfer.advance ?? false,
          }
        : null;
    },
  } as unknown as BillingDocumentsRepository;
  const repository = {
    claim: async () => {
      calls.claim++;
      return options.claim ?? true;
    },
    markIssued: async (input: unknown) => {
      calls.issued.push(input);
      current = row("ISSUED");
    },
    setPdf: async (_id: string, key: string) => calls.pdf.push(key),
    markFailed: async (_id: string, reason: string) => {
      calls.failed.push(reason);
    },
    markOutcomeUnknown: async (_id: string, note: string) => {
      calls.unknown.push(note);
    },
  } as unknown as BillingDocumentIssueRepository;
  const credentials = {
    resolve: async () => ({
      ...(calls.resolve++, {}),
      agentKey: "test-key",
      source: "database",
      revision: "db:1",
    }),
  } as unknown as SzamlazzCredentialProvider;
  const store = {
    put: async (key: unknown) => {
      calls.pdf.push(key);
    },
  } as unknown as DocumentStore;
  const stock = {
    postIssuedInvoice: async () => {
      calls.stock++;
      if (options.stockFails) throw new Error("adatbázis nem elérhető");
      return { alreadyPosted: false, movedLines: 1 };
    },
  } as unknown as BillingDocumentStockRepository;
  const client: SzamlazzAgentClient = {
    generateInvoice: async (xml: string) => {
      calls.generate++;
      calls.xml.push(xml);
      assert.match(xml, /<sendEmail>false<\/sendEmail>/);
      assert.match(xml, /<szamlaKulsoAzon>doc-1<\/szamlaKulsoAzon>/);
      assert.doesNotMatch(xml, /elonezetpdf/);
      return (
        options.respond?.() ??
        Promise.resolve({
          successful: true,
          invoiceNumber: "E-TEST-2026-1",
          netTotal: 1000,
          grossTotal: 1270,
          pdf: Buffer.from("%PDF-1.4 kiallitott"),
        })
      );
    },
  };
  const service = new BillingDocumentIssueService(
    documents,
    repository,
    credentials,
    store,
    stock,
    client,
    options.env ?? ON,
  );
  return { service, calls };
}

const issue = (service: BillingDocumentIssueService) =>
  service.issue("doc-1", "2026-09-30T10:00:00.000Z", USER);

// Feladat d510: egy beszerzési szerződésből jött számla, egy szerződés-tételre
// mutató sorral (2 egység a 3-ból).
const contractRow = {
  sourceType: "CONTRACT",
  sourceId: "contract-1",
  lines: [
    {
      ...(row().lines[0] as unknown as Record<string, unknown>),
      contractItemId: "ci-1",
      description: "Kitalált szivattyú",
      quantity: d("2"),
    },
  ],
};
const ONE_ITEM = [{ id: "ci-1", quantity: "3" }];

// Kártya d31a66a3, S1: a webshop rendelés számlája
const webshopRow = { sourceType: "WEBSHOP_ORDER", sourceId: "order_38" };

describe("BillingDocumentIssueService", () => {
  /*
    CSAK A MARADÉK (feladat d510). MI PIROSÍT: egy szerződés-tétel túlszámlázása
    eljut a Számlázz.hu-ig; a foglalás előtti őr foglal vagy hív; a foglalás után
    kiderülő verseny (egy másik, közben foglalt számla) nem ISSUE_FAILED-et ír,
    vagy mégis hív; a maradékon belüli számla nem megy ki.
  */
  it("CONTRACT-OVERBILL: more than the remainder is refused before the claim, Számlázz.hu is not called", async () => {
    const { service, calls } = setup({
      over: contractRow,
      contractFacts: () => ({
        items: ONE_ITEM,
        billed: [{ contractItemId: "ci-1", quantity: "2" }],
      }),
    });
    await assert.rejects(
      issue(service),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /csak 1 maradt számlázatlan/.test(error.message),
    );
    assert.deepEqual(
      [calls.claim, calls.generate, calls.failed.length],
      [0, 0, 0],
    );
  });

  it("CONTRACT-RACE: another invoice claimed meanwhile shows up after the claim: ISSUE_FAILED, no call", async () => {
    const { service, calls } = setup({
      over: contractRow,
      contractFacts: (afterClaim) => ({
        items: ONE_ITEM,
        billed: afterClaim ? [{ contractItemId: "ci-1", quantity: "2" }] : [],
      }),
    });
    await assert.rejects(issue(service), BadRequestException);
    assert.deepEqual([calls.claim, calls.generate], [1, 0]);
    assert.match(calls.failed[0] ?? "", /csak 1 maradt számlázatlan/);
  });

  /*
    AZ ELŐLEG (barracuda, #1699). MI PIROSÍT: egy előlegszámla kiállítása nem
    méri a szerződés maradékát (akkor egy rendes számla és az előleg együtt
    túlszámlázhatna); a végszámla a saját előlegét is „máshol számlázottnak”
    veszi, és önmagával ütközik.
  */
  it("CONTRACT-ADVANCE: an advance invoice is measured against the remainder too", async () => {
    const { service, calls } = setup({
      over: { ...contractRow, documentType: "ADVANCE_INVOICE" },
      contractFacts: () => ({
        items: ONE_ITEM,
        billed: [{ contractItemId: "ci-1", quantity: "2" }],
      }),
    });
    await assert.rejects(
      issue(service),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /csak 1 maradt számlázatlan/.test(error.message),
    );
    assert.deepEqual([calls.claim, calls.generate], [0, 0]);
  });

  it("CONTRACT-FINAL-OWN-ADVANCE: a final invoice leaves its own advance out of the elsewhere-billed lines", async () => {
    const { service, calls } = setup({
      over: {
        ...contractRow,
        documentType: "FINAL_INVOICE",
        referencedInvoiceId: "adv-1",
        referencedInvoice: {
          id: "adv-1",
          invoiceNumber: "E-ADV-1",
          correctionInvoices: [],
        },
      },
      contractFacts: () => ({ items: ONE_ITEM, billed: [] }),
    });
    await issue(service).catch(() => undefined);
    assert.deepEqual(calls.excluded[0], ["doc-1", "adv-1"]);
  });

  /*
    EGY WEBSHOP RENDELÉS EGYSZER (kártya d31a66a3, S1). MI PIROSÍT: egy második „teljes” bizonylat eljut a Számlázz.hu-ig; a
    foglalás előtti őr foglal; a foglalás után kiderülő verseny (egy közben foglalt előleg) nem ISSUE_FAILED, vagy mégis hív; egy
    nem webshop bizonylat is a webshop rendelést kérdezi.
  */
  it("WEBSHOP-OVERBILL: an invoice beside the order's advance is refused before the claim, by its number", async () => {
    const { service, calls } = setup({
      over: webshopRow,
      webshopInvoices: () => [
        {
          documentType: "ADVANCE_INVOICE",
          status: "ISSUED",
          number: "E-ACR-9",
          cancelled: false,
        },
      ],
    });
    await assert.rejects(
      issue(service),
      (error: unknown) =>
        error instanceof ConflictException && /E-ACR-9/.test(error.message),
    );
    assert.deepEqual([calls.claim, calls.generate], [0, 0]);
    assert.deepEqual(calls.webshopAsked, ["invoices order_38 without doc-1"]);
  });

  it("WEBSHOP-RACE: an advance claimed meanwhile shows up after the claim: ISSUE_FAILED, no call", async () => {
    const { service, calls } = setup({
      over: webshopRow,
      webshopInvoices: (afterClaim) =>
        afterClaim
          ? [
              {
                documentType: "ADVANCE_INVOICE",
                status: "ISSUING",
                number: null,
                cancelled: false,
              },
            ]
          : [],
    });
    await assert.rejects(issue(service), ConflictException);
    assert.deepEqual([calls.claim, calls.generate], [1, 0]);
    assert.match(calls.failed[0] ?? "", /előlegszámla \(kiállítás alatt\)/);
  });

  it("WEBSHOP-PAID: the transfer-paid invoice goes out paid, with the proforma's number, due on its issue day", async () => {
    const { service, calls } = setup({
      over: {
        ...webshopRow,
        proformaInvoice: { id: "p-38", invoiceNumber: "D-ACR-12" },
      },
      transfer: { amount: "1270" },
    });
    assert.equal((await issue(service)).status, "ISSUED");
    const xml = calls.xml[0] ?? "";
    assert.match(xml, /<dijbekeroSzamlaszam>D-ACR-12<\/dijbekeroSzamlaszam>/);
    assert.match(xml, /<fizetve>true<\/fizetve>/);
    assert.match(
      xml,
      new RegExp(`<fizetesiHataridoDatum>${budapestDayKey(new Date())}<`),
    );
    assert.ok(calls.webshopAsked.includes("transfer order_38 p-38"));
  });

  /*
    A SZERKESZTŐBŐL KIÁLLÍTOTT WEBSHOP-SZÁMLA (barracuda a #2884-en, CHANGES A). A rendelés oldalának őrzői a vázlat mentésekor
    futnak; ugyanaz a vázlat a Számlázás szerkesztőjéből a közös kiállításon át is kimehet. MI PIROSÍT: egy szerkesztett (más
    bruttójú) számla kimegy, fizetve vagy anélkül; egy nem OS-es Számlázz.hu-számla mellé kimegy; egy előleg-beérkezésre teljes
    számla megy ki; beérkezés nélkül megáll, vagy egy nem webshop bizonylat a webshopot kérdezi.
  */
  const linkedWebshop = {
    ...webshopRow,
    proformaInvoice: { id: "p-38", invoiceNumber: "D-ACR-12" },
  };

  it("WEBSHOP-EDITOR-AMOUNT: a gross that is not the transfer is refused before the claim, paid or not", async () => {
    for (const amount of ["1300", "1200"]) {
      const { service, calls } = setup({
        over: linkedWebshop,
        transfer: { amount },
      });
      await assert.rejects(
        issue(service),
        (error: unknown) =>
          error instanceof ConflictException &&
          /nem egyezik a rendelés beérkezett utalásával/.test(error.message),
      );
      assert.deepEqual([calls.claim, calls.generate], [0, 0], amount);
    }
  });

  it("WEBSHOP-EDITOR-FOREIGN: a Számlázz.hu invoice the OS did not issue stops it, by its number", async () => {
    const { service, calls } = setup({
      over: linkedWebshop,
      transfer: { amount: "1270" },
      foreign: ["E-ACR-77"],
    });
    await assert.rejects(
      issue(service),
      (error: unknown) =>
        error instanceof ConflictException && /E-ACR-77/.test(error.message),
    );
    assert.deepEqual([calls.claim, calls.generate], [0, 0]);
    assert.ok(calls.webshopAsked.includes("feed order_38 p-38"));
  });

  it("WEBSHOP-EDITOR-ADVANCE: an advance transfer gets no whole invoice", async () => {
    const { service, calls } = setup({
      over: linkedWebshop,
      transfer: { amount: "1270", advance: true },
    });
    await assert.rejects(
      issue(service),
      (error: unknown) =>
        error instanceof ConflictException && /előleg/.test(error.message),
    );
    assert.deepEqual([calls.claim, calls.generate], [0, 0]);
  });

  it("WEBSHOP-EDITOR-ADVANCE-INVOICE (S2): the advance invoice of an advance transfer is checked the same way, and goes out paid", async () => {
    const advanceRow = { ...linkedWebshop, documentType: "ADVANCE_INVOICE" };
    const off = setup({
      over: advanceRow,
      transfer: { amount: "1300", advance: true },
    });
    await assert.rejects(
      issue(off.service),
      (error: unknown) =>
        error instanceof ConflictException &&
        /nem egyezik a rendelés beérkezett utalásával/.test(error.message),
    );
    assert.deepEqual([off.calls.claim, off.calls.generate], [0, 0]);
    const whole = setup({ over: advanceRow, transfer: { amount: "1270" } });
    await assert.rejects(
      issue(whole.service),
      (error: unknown) =>
        error instanceof ConflictException &&
        /teljes összegét/.test(error.message),
    );
    const ok = setup({
      over: advanceRow,
      transfer: { amount: "1270", advance: true },
    });
    assert.equal((await issue(ok.service)).status, "ISSUED");
    assert.match(ok.calls.xml[0] ?? "", /<fizetve>true<\/fizetve>/);
  });

  it("WEBSHOP-UNPAID: without a transfer for the proforma it goes out as before, unpaid; a contract invoice never asks", async () => {
    const { service, calls } = setup({ over: linkedWebshop, transfer: null });
    assert.equal((await issue(service)).status, "ISSUED");
    assert.doesNotMatch(calls.xml[0] ?? "", /fizetve/);
    const contract = setup({
      over: contractRow,
      contractFacts: () => ({ items: ONE_ITEM, billed: [] }),
    });
    await issue(contract.service);
    assert.deepEqual(contract.calls.webshopAsked, []);
  });

  it("CONTRACT-OK: within the remainder the invoice goes out", async () => {
    const { service, calls } = setup({
      over: contractRow,
      contractFacts: () => ({
        items: ONE_ITEM,
        billed: [{ contractItemId: "ci-1", quantity: "1" }],
      }),
    });
    assert.equal((await issue(service)).status, "ISSUED");
    assert.deepEqual(
      [calls.claim, calls.generate, calls.failed.length],
      [1, 1, 0],
    );
  });

  /*
    AZ ÁLSZÁMLÁZÓ (Webshop / Rendelések, 4. PR). MI PIROSÍT: a teszt-szerveren a
    kiállítás a Számlázz.hu-t hívja vagy a tárolt (esetleg éles) kulcsot
    olvassa; a sorszám nem ismerhető fel teszt-sorszámként; a két kapcsoló
    együtt bármelyik úton kiállít.
  */
  it("the stub issues a TESZT number with a PDF, without Számlázz.hu and without reading the stored key", async () => {
    const { service, calls } = setup({ env: { SZAMLAZZ_AGENT_MODE: "stub" } });
    const detail = await issue(service);
    assert.equal(detail.status, "ISSUED");
    const [issued] = calls.issued as Array<Record<string, unknown>>;
    assert.match(String(issued!.invoiceNumber), /^TESZT-\d{4}-[0-9A-F]{8}$/);
    assert.deepEqual([calls.generate, calls.resolve], [0, 0]);
    assert.ok(calls.pdf.length > 0);
  });

  it("the live switch and the stub together is a contradiction: nothing is issued", async () => {
    const { service, calls } = setup({
      env: { BILLING_ISSUE_ENABLED: "true", SZAMLAZZ_AGENT_MODE: "stub" },
    });
    await assert.rejects(() => issue(service), /ellentmondásos/);
    assert.deepEqual([calls.claim, calls.generate, calls.resolve], [0, 0, 0]);
  });

  /*
    A VÉGSZÁMLA ELŐLEGE KÖZBEN SZTORNÓZHATÓ (barracuda, #1672). MI PIROSÍT: egy
    sztornózott előleget levonó végszámla elmegy a Számlázz.hu-ra.
  */
  it("a final invoice whose advance was stornoed meanwhile, in the OS or on Számlázz.hu, is not sent", async () => {
    const advance = {
      id: "adv-1",
      documentType: "ADVANCE_INVOICE",
      invoiceNumber: "E-ELO-1",
      grossAmount: d("381"),
      currency: "HUF",
      correctionInvoices: [] as { id: string }[],
    };
    const final = (over: Record<string, unknown>) => ({
      documentType: "FINAL_INVOICE",
      referencedInvoice: { ...advance, ...over },
    });
    for (const s of [
      setup({ over: final({ correctionInvoices: [{ id: "st-1" }] }) }),
      setup({ over: final({}), feedCancelled: true }),
    ]) {
      await assert.rejects(() => issue(s.service), /E-ELO-1.*sztornózták/);
      assert.deepEqual([s.calls.claim, s.calls.generate], [0, 0]);
    }
    const ok = setup({ over: final({}) });
    assert.equal((await issue(ok.service)).status, "ISSUED");
    assert.equal(ok.calls.generate, 1);
  });

  /*
    A FOGLALÁS UTÁNI VISSZAOLVASÁS (barracuda, #1674): a sztornó az őr és a
    foglalás között indult el. MI PIROSÍT: a végszámla ilyenkor is elmegy, vagy
    ISSUING-ben ragad ahelyett, hogy elutasítottra váltana.
  */
  it("a storno of the advance started between the guard and the claim stops the final invoice after its claim", async () => {
    const advance = {
      id: "adv-1",
      documentType: "ADVANCE_INVOICE",
      invoiceNumber: "E-ELO-1",
      grossAmount: d("381"),
      currency: "HUF",
      correctionInvoices: [] as { id: string }[],
    };
    for (const late of ["OS", "FEED"] as const) {
      const s = setup({
        over: { documentType: "FINAL_INVOICE", referencedInvoice: advance },
        stornoAfterClaim: late,
      });
      await assert.rejects(
        () => issue(s.service),
        /E-ELO-1.*sztornózása időközben elindult/,
        late,
      );
      assert.deepEqual([s.calls.claim, s.calls.generate], [1, 0], late);
      assert.equal(s.calls.failed.length, 1, late);
      assert.match(s.calls.failed[0]!, /időközben elindult/);
    }
    // nem végszámlán a visszaolvasás nem állít meg semmit
    const plain = setup({ stornoAfterClaim: "OS" });
    assert.equal((await issue(plain.service)).status, "ISSUED");
  });

  /*
    CÉGNEK ADÓSZÁM NÉLKÜL NINCS SZÁMLA (kártya aaf4f09d; Balázs, 2026-11-04). MI
    PIROSÍT: ha a céges, adószám nélküli vevő számlája foglal vagy Számlázz.hu-t
    hív; ha a magánszemély, a magyar vagy a közösségi adószámos cég elakad.
  */
  it("TAX-GATE: without a tax number only an explicitly marked person goes out; the rest is refused before the claim", async () => {
    const base = row().customer;
    const nincsAdo = { taxNumber: null, euTaxNumber: null };
    for (const [nev, customer] of [
      ["cég", { ...base, ...nincsAdo, type: "COMPANY", partner: null }],
      [
        "ismeretlen típus",
        { ...base, ...nincsAdo, type: undefined, partner: null },
      ],
      [
        "partner-tükör magánszemély típussal",
        {
          ...base,
          ...nincsAdo,
          displayName: "Fővárosi Állat- és Növénykert",
          type: "PERSON",
          partner: { id: "supplier-zoo" },
        },
      ],
      [
        "magánszemély cégformájú névvel",
        { ...base, ...nincsAdo, type: "PERSON", partner: null },
      ],
    ] as const) {
      const { service, calls } = setup({ over: { customer } });
      await assert.rejects(
        () => issue(service),
        (error: unknown) =>
          error instanceof BadRequestException &&
          error.message.startsWith("A vevőnek nincs adószáma:"),
        nev,
      );
      assert.deepEqual([calls.claim, calls.generate], [0, 0], nev);
    }
  });

  it("TAX-GATE: the reason names a same-named partner's tax number, where to copy it from", async () => {
    // Luca, 2026-11-04 13:53 UTC: the old customer row was picked, the partner had the number
    const { service, calls } = setup({
      over: {
        customer: {
          ...row().customer,
          displayName: "Fővárosi Állat- és Növénykert",
          taxNumber: null,
          euTaxNumber: null,
          type: "COMPANY",
          partner: null,
        },
      },
      partnerHint: {
        partnerName: "Fővárosi Állat- és Növénykert",
        taxNumber: "15490658-2-42",
      },
    });
    await assert.rejects(
      () => issue(service),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          "A Partnerek között Fővárosi Állat- és Növénykert a(z) 15490658-2-42 adószámmal szerepel",
        ),
    );
    assert.deepEqual([calls.claim, calls.generate], [0, 0]);
  });

  it("TAX-GATE: an explicitly marked person, or a buyer with a Hungarian or an EU tax number, goes out", async () => {
    const base = row().customer;
    for (const customer of [
      {
        ...base,
        displayName: "Kovács Anna",
        type: "PERSON",
        taxNumber: null,
        euTaxNumber: null,
        partner: null,
      },
      {
        ...base,
        type: "COMPANY",
        taxNumber: "12345678-2-42",
        euTaxNumber: null,
      },
      {
        ...base,
        type: "COMPANY",
        taxNumber: null,
        euTaxNumber: "DE123456789",
        partner: { id: "supplier-1" },
      },
    ]) {
      const { service, calls } = setup({ over: { customer } });
      const detail = await issue(service);
      assert.equal(detail.status, "ISSUED", JSON.stringify(customer));
      assert.equal(calls.generate, 1, JSON.stringify(customer));
    }
  });

  it("does not call Számlázz.hu while the switch is off", async () => {
    const { service, calls } = setup({ env: {} });
    await assert.rejects(() => issue(service), ConflictException);
    assert.deepEqual([calls.claim, calls.generate], [0, 0]);
  });

  it("issues once: the number, the sent amounts, the buyer, the PDF, and an e-invoice waiting to be sent", async () => {
    const { service, calls } = setup();
    const detail = await issue(service);
    assert.equal(calls.generate, 1);
    assert.equal(detail.status, "ISSUED");
    const [issued] = calls.issued as Array<Record<string, unknown>>;
    assert.equal(issued!.invoiceNumber, "E-TEST-2026-1");
    assert.equal(issued!.emailStatus, "PENDING");
    assert.deepEqual(issued!.totals, {
      netAmount: "1000",
      vatAmount: "270",
      grossAmount: "1270",
    });
    assert.deepEqual(issued!.lines, [
      {
        lineId: "line-1",
        netAmount: "1000.00",
        vatAmount: "270.00",
        grossAmount: "1270.00",
      },
    ]);
    assert.equal((issued!.buyer as { zip: string }).zip, "1011");
    assert.equal(calls.pdf.length, 2); // stored, then its key written
  });

  it("books the stock once the document is issued", async () => {
    const { service, calls } = setup();
    await issue(service);
    assert.equal(calls.stock, 1);
  });

  it("keeps the issued document when the stock booking fails", async () => {
    const { service, calls } = setup({ stockFails: true });
    const detail = await issue(service);
    assert.equal(detail.status, "ISSUED");
    assert.equal(calls.issued.length, 1);
  });

  it("retries the stock booking on a second click, without a second Számlázz.hu call", async () => {
    const { service, calls } = setup({ status: "ISSUED" });
    await issue(service);
    assert.deepEqual([calls.stock, calls.generate], [1, 0]);
  });

  it("keeps Számlázz.hu's customer-account link for {document_link}, https only", async () => {
    const link = "https://www.szamlazz.hu/szamla/?page=vevoifiok&azon=abc";
    for (const [given, stored] of [
      [link, link],
      [undefined, null],
      ["http://www.szamlazz.hu/x", null],
      ["javascript:alert(1)", null],
    ] as const) {
      const { service, calls } = setup({
        respond: async () => ({
          successful: true,
          invoiceNumber: "E-TEST-2026-1",
          netTotal: 1000,
          grossTotal: 1270,
          customerAccountUrl: given,
        }),
      });
      await issue(service);
      assert.equal(
        (calls.issued[0] as { externalUrl: unknown }).externalUrl,
        stored,
        String(given),
      );
    }
  });

  it("marks a paper invoice as not needing an e-mail", async () => {
    const { service, calls } = setup({ format: "PAPER" });
    await issue(service);
    assert.equal(
      (calls.issued[0] as { emailStatus: string }).emailStatus,
      "NOT_REQUIRED",
    );
  });

  it("returns an issued document again without a second call", async () => {
    const { service, calls } = setup({ status: "ISSUED" });
    const detail = await issue(service);
    assert.equal(detail.status, "ISSUED");
    assert.deepEqual([calls.claim, calls.generate], [0, 0]);
  });

  it("refuses a document whose issue is already running, and one refused before, without a call", async () => {
    for (const status of ["ISSUING", "ISSUE_FAILED"]) {
      const { service, calls } = setup({ status });
      await assert.rejects(() => issue(service), ConflictException, status);
      assert.equal(calls.generate, 0, status);
    }
  });

  it("makes no call when the claim fails (saved since, or a second click)", async () => {
    const { service, calls } = setup({ claim: false });
    await assert.rejects(() => issue(service), ConflictException);
    assert.equal(calls.generate, 0);
  });

  it("marks a refusal as ISSUE_FAILED with Számlázz.hu's own reason", async () => {
    const { service, calls } = setup({
      respond: async () => ({
        successful: false,
        errorCode: "57",
        errorMessage: "XML beolvasási hiba.",
      }),
    });
    await assert.rejects(() => issue(service), BadRequestException);
    assert.equal(calls.failed.length, 1);
    assert.match(calls.failed[0]!, /57.*XML beolvasási hiba/);
    assert.equal(calls.issued.length, 0);
  });

  it("leaves an unknown outcome ISSUING for a person, and does not retry", async () => {
    const { service, calls } = setup({
      respond: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await assert.rejects(() => issue(service), ServiceUnavailableException);
    assert.deepEqual(
      [calls.generate, calls.unknown.length, calls.failed.length],
      [1, 1, 0],
    );
  });

  it("treats a success without a number as unknown, not as issued", async () => {
    const { service, calls } = setup({
      respond: async () => ({ successful: true }),
    });
    await assert.rejects(() => issue(service), ServiceUnavailableException);
    assert.deepEqual([calls.issued.length, calls.unknown.length], [0, 1]);
  });
});

/**
 * THE CONFIRMATION WINDOW (card 7ba97e0d; Balázs 2026-11-11 11:12-11:14 UTC). WHAT TURNS IT RED: the window shows
 * values the issue does not send; a buyer changed after the window opened is issued anyway; a future issue date or a
 * due date before it reaches Számlázz.hu; the confirmed dates do not reach the invoice (XML) or the stored document;
 * a card payment keeps a due date apart from the issue date; an internal caller without a window gets a changed request.
 */
describe("the invoice confirmation (card 7ba97e0d)", () => {
  const NOW = new Date("2026-11-11T09:00:00Z");
  const tag = (xml: string, name: string) =>
    new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? null;

  it("the summary is the builder's: buyer, address, tax number, today as the issue date, the draft's dates and method; a past due date from today", async () => {
    const { service } = setup();
    const summary = await service.summary("doc-1", NOW);
    assert.deepEqual(
      { ...summary, fingerprint: summary.fingerprint.length },
      {
        buyerName: "Kitalált Kft.",
        buyerAddress: "1011 Budapest, Fő utca 1.",
        buyerTaxNumber: "12345678-2-42",
        buyerEuTaxNumber: null,
        // no billing e-mail on the partner: the e-mail it has (S2, the send address)
        buyerEmail: "vevo@example.com",
        issueDate: "2026-11-11",
        fulfillmentDate: "2026-09-30",
        // the draft's 2026-10-08 is past: today plus the buyer's 30 days (acrobot 47091)
        dueDate: "2026-12-11",
        paymentMethod: "Átutalás",
        showsPaymentFields: true,
        dueDateFollowsIssueDate: false,
        fingerprint: 64,
      },
    );
  });

  it("the proposed due date: the draft's when not past; past, today plus the buyer's days, or eight without them", async () => {
    const later = setup({
      over: { dueDate: new Date("2026-11-25T00:00:00Z") },
    });
    assert.equal(
      (await later.service.summary("doc-1", NOW)).dueDate,
      "2026-11-25",
    );
    const none = setup({ paymentDueDays: null });
    assert.equal(
      (await none.service.summary("doc-1", NOW)).dueDate,
      "2026-11-19",
    );
    assert.deepEqual(none.calls.paymentDaysFor, ["cust-1"]);
  });

  it("the summary refuses what the issue would refuse, with the issue's own sentence", async () => {
    await assert.rejects(
      () => setup({ status: "ISSUED" }).service.summary("doc-1", NOW),
      ConflictException,
    );
    await assert.rejects(
      () => setup({ over: { customer: null } }).service.summary("doc-1", NOW),
      /A bizonylathoz nincs partner rendelve\./,
    );
  });

  it("the confirmed dates go into the invoice and the stored document; an earlier issue day is stored at its noon", async () => {
    const { service, calls } = setup();
    const { fingerprint } = await service.summary("doc-1", NOW);
    await service.issue(
      "doc-1",
      "2026-09-30T10:00:00.000Z",
      USER,
      {
        issueDate: "2026-11-10",
        fulfillmentDate: "2026-11-05",
        dueDate: "2026-11-20",
        fingerprint,
      },
      NOW,
    );
    const xml = calls.xml[0]!;
    assert.deepEqual(
      [
        tag(xml, "keltDatum"),
        tag(xml, "teljesitesDatum"),
        tag(xml, "fizetesiHataridoDatum"),
      ],
      ["2026-11-10", "2026-11-05", "2026-11-20"],
    );
    // the XSD order: keltDatum is the header's first element
    assert.ok(xml.indexOf("<keltDatum>") < xml.indexOf("<teljesitesDatum>"));
    const stored = calls.issued[0] as {
      issueDate: Date;
      fulfillmentDate: Date;
      dueDate: Date;
    };
    assert.deepEqual(
      [
        stored.issueDate.toISOString(),
        stored.fulfillmentDate.toISOString(),
        stored.dueDate.toISOString(),
      ],
      [
        "2026-11-10T12:00:00.000Z",
        "2026-11-05T00:00:00.000Z",
        "2026-11-20T00:00:00.000Z",
      ],
    );
  });

  it("today as the issue date keeps the moment of the issue, as before", async () => {
    const { service, calls } = setup();
    const { fingerprint } = await service.summary("doc-1", NOW);
    const before = Date.now();
    await service.issue(
      "doc-1",
      "2026-09-30T10:00:00.000Z",
      USER,
      {
        issueDate: "2026-11-11",
        fulfillmentDate: "2026-09-30",
        dueDate: "2026-11-19",
        fingerprint,
      },
      NOW,
    );
    assert.ok(
      (calls.issued[0] as { issueDate: Date }).issueDate.getTime() >= before,
    );
  });

  it("a buyer changed after the window opened stops the issue before Számlázz.hu", async () => {
    const { fingerprint } = await setup().service.summary("doc-1", NOW);
    const changed = setup({
      over: {
        customer: { ...(row().customer as object), companyName: "Másik Kft." },
      },
    });
    await assert.rejects(
      () =>
        changed.service.issue(
          "doc-1",
          "2026-09-30T10:00:00.000Z",
          USER,
          {
            issueDate: "2026-11-11",
            fulfillmentDate: "2026-09-30",
            dueDate: "2026-10-08",
            fingerprint,
          },
          NOW,
        ),
      /megváltoztak, mióta megnyitottad/,
    );
    assert.deepEqual([changed.calls.generate, changed.calls.claim], [0, 0]);
  });

  it("an e-mail changed after the window opened stops the issue too: the window showed where it sends", async () => {
    const { fingerprint } = await setup().service.summary("doc-1", NOW);
    const changed = setup({
      over: {
        customer: {
          ...(row().customer as object),
          billingEmail: "masik@example.com",
        },
      },
    });
    await assert.rejects(
      () =>
        changed.service.issue(
          "doc-1",
          "2026-09-30T10:00:00.000Z",
          USER,
          {
            issueDate: "2026-11-11",
            fulfillmentDate: "2026-09-30",
            dueDate: "2026-11-19",
            fingerprint,
          },
          NOW,
        ),
      /megváltoztak, mióta megnyitottad/,
    );
    assert.equal(changed.calls.generate, 0);
  });

  it("with a send address of its own (the webshop proforma), the window and the digest are that address, not the buyer's", async () => {
    const ORDER = "rendeles@example.com";
    const summary = await setup().service.summary("doc-1", NOW, ORDER);
    assert.equal(summary.buyerEmail, ORDER);
    const confirmed = {
      issueDate: "2026-11-11",
      fulfillmentDate: "2026-09-30",
      dueDate: "2026-11-19",
      fingerprint: summary.fingerprint,
    };
    // the buyer's billing address changed: not the one the window named, so the issue goes on
    const billingChanged = setup({
      over: {
        customer: {
          ...(row().customer as object),
          billingEmail: "masik@example.com",
        },
      },
    });
    await billingChanged.service.issue(
      "doc-1",
      "2026-09-30T10:00:00.000Z",
      USER,
      confirmed,
      NOW,
      ORDER,
    );
    assert.equal(billingChanged.calls.generate, 1);
    // the address the window named changed: the issue stops before Számlázz.hu
    const orderChanged = setup();
    await assert.rejects(
      () =>
        orderChanged.service.issue(
          "doc-1",
          "2026-09-30T10:00:00.000Z",
          USER,
          confirmed,
          NOW,
          "uj-cim@example.com",
        ),
      /megváltoztak, mióta megnyitottad/,
    );
    assert.equal(orderChanged.calls.generate, 0);
  });

  it("dates the rule refuses never reach Számlázz.hu", async () => {
    const { service, calls } = setup();
    const { fingerprint } = await service.summary("doc-1", NOW);
    for (const dates of [
      {
        issueDate: "2026-11-12",
        fulfillmentDate: "2026-11-11",
        dueDate: "2026-11-20",
      },
      {
        issueDate: "2026-11-11",
        fulfillmentDate: "2026-11-11",
        dueDate: "2026-11-10",
      },
    ])
      await assert.rejects(
        () =>
          service.issue(
            "doc-1",
            "2026-09-30T10:00:00.000Z",
            USER,
            { ...dates, fingerprint },
            NOW,
          ),
        BadRequestException,
        JSON.stringify(dates),
      );
    assert.equal(calls.generate, 0);
  });

  it("a card payment is due on the issue date, whatever due date came", async () => {
    const { service, calls } = setup({ over: { paymentMethod: "Bankkártya" } });
    const summary = await service.summary("doc-1", NOW);
    assert.equal(summary.dueDateFollowsIssueDate, true);
    await service.issue(
      "doc-1",
      "2026-09-30T10:00:00.000Z",
      USER,
      {
        issueDate: "2026-11-10",
        fulfillmentDate: "2026-11-10",
        dueDate: "2026-12-31",
        fingerprint: summary.fingerprint,
      },
      NOW,
    );
    assert.equal(tag(calls.xml[0]!, "fizetesiHataridoDatum"), "2026-11-10");
  });

  it("an internal caller without a window issues as before: no keltDatum, the draft's dates", async () => {
    const { service, calls } = setup();
    await issue(service);
    const xml = calls.xml[0]!;
    assert.deepEqual(
      [
        tag(xml, "keltDatum"),
        tag(xml, "teljesitesDatum"),
        tag(xml, "fizetesiHataridoDatum"),
      ],
      [null, "2026-09-30", "2026-10-08"],
    );
    assert.equal("fulfillmentDate" in (calls.issued[0] as object), false);
  });
  /*
    A KIFIZETETT DÍJBEKÉRŐBŐL KÉSZÜLŐ ELŐLEGSZÁMLA (kártya 00926d89, Balázs kérése; barracuda #2638: a `fizetve` a TELJES kiegyenlítést
    állítja). MI PIROSÍT: ha a jelző kimarad egy teljesen kifizetett díjbekérőből; ha RÉSZFIZETÉSNÉL, más pénznemnél, sztornózott vagy
    ismeretlen állapotú díjbekérőnél is menne (a "van rajta fizetés" alak); ha a határidő a vázlaté marad; ha a nem előleg-bizonylat
    (számla) egyáltalán megkérdezné a feedet; ha az ablak összesítője nem követné a kiállítás napját.
  */
  const advance = (over: Record<string, unknown> = {}) => ({
    documentType: "ADVANCE_INVOICE",
    proformaInvoice: { invoiceNumber: "D-CRPR-7" },
    ...over,
  });
  const confirmed = (fingerprint: string) => ({
    issueDate: "2026-11-10",
    fulfillmentDate: "2026-11-10",
    dueDate: "2026-12-31",
    fingerprint,
  });

  it("an advance whose gross the proforma's payment REACHES (exact or more): fizetve, due on the confirmed issue date", async () => {
    for (const paid of ["1270", "2000"]) {
      const { service, calls } = setup({
        over: advance(),
        proformaFacts: { paid },
      });
      const summary = await service.summary("doc-1", NOW);
      assert.equal(summary.dueDateFollowsIssueDate, true, paid);
      assert.equal(summary.dueDate, summary.issueDate, paid);
      await service.issue(
        "doc-1",
        "2026-09-30T10:00:00.000Z",
        USER,
        confirmed(summary.fingerprint),
        NOW,
      );
      const xml = calls.xml[0]!;
      assert.equal(tag(xml, "fizetve"), "true", paid);
      assert.equal(tag(xml, "fizetesiHataridoDatum"), "2026-11-10", paid);
      assert.equal(tag(xml, "elolegszamla"), "true", paid);
      assert.deepEqual(calls.proformaFactsFor, ["D-CRPR-7", "D-CRPR-7"], paid);
      assert.equal(
        (calls.issued[0] as { dueDate: Date }).dueDate
          .toISOString()
          .slice(0, 10),
        "2026-11-10",
        paid,
      );
    }
  });

  it("a part payment, another currency, a cancelled proforma or no feed row: nothing changes (no fizetve, the draft's due date)", async () => {
    const cases = [
      { name: "part payment", facts: { paid: "1000" } },
      { name: "one forint short", facts: { paid: "1269.99" } },
      { name: "nothing paid", facts: { paid: "0" } },
      { name: "other currency", facts: { paid: "1270", currency: "EUR" } },
      { name: "cancelled", facts: { paid: "1270", cancelled: true } },
      { name: "no feed row", facts: null },
    ];
    for (const { name, facts } of cases) {
      const { service, calls } = setup({
        over: advance(),
        proformaFacts: facts,
      });
      const summary = await service.summary("doc-1", NOW);
      assert.equal(summary.dueDateFollowsIssueDate, false, name);
      await service.issue(
        "doc-1",
        "2026-09-30T10:00:00.000Z",
        USER,
        confirmed(summary.fingerprint),
        NOW,
      );
      const xml = calls.xml[0]!;
      assert.equal(tag(xml, "fizetve"), null, name);
      assert.equal(tag(xml, "fizetesiHataridoDatum"), "2026-12-31", name);
    }
  });

  it("an internal caller without a window: a fully paid advance is dated today all the same", async () => {
    const { service, calls } = setup({
      over: advance(),
      proformaFacts: { paid: "1270" },
    });
    await service.issue(
      "doc-1",
      "2026-09-30T10:00:00.000Z",
      USER,
      undefined,
      NOW,
    );
    const xml = calls.xml[0]!;
    assert.equal(tag(xml, "fizetve"), "true");
    assert.equal(tag(xml, "fizetesiHataridoDatum"), budapestDayKey(NOW));
  });

  it("an invoice (not an advance) never asks the feed and never carries fizetve", async () => {
    const { service, calls } = setup({
      over: { proformaInvoice: { invoiceNumber: "D-CRPR-7" } },
      proformaFacts: { paid: "1270" },
    });
    await issue(service);
    assert.deepEqual(calls.proformaFactsFor, []);
    assert.equal(tag(calls.xml[0]!, "fizetve"), null);
  });
});
