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

import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzAgentResponse } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
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
    netAmount: d("1000"),
    vatAmount: d("270"),
    grossAmount: d("1270"),
    customer: {
      id: "cust-1",
      customerNumber: "C-1",
      displayName: "Kitalált Kft.",
      companyName: null,
      taxNumber: null,
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
    feedCancelled?: boolean;
    /** A foglalás UTÁN látszó előleg-sztornó (OS: ISSUING/ISSUED; feed). */
    stornoAfterClaim?: "OS" | "FEED";
    /** A forrás-szerződés tételei és a MÁSHOL számlázott sorai, a foglalás előtt / után. */
    contractFacts?: (afterClaim: boolean) => {
      items: Array<{ id: string; quantity: string }>;
      billed: Array<{ contractItemId: string; quantity: string }>;
    };
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
  };
  let current = {
    ...row(options.status, options.format),
    ...options.over,
  } as BillingDocumentRow;
  const documents = {
    find: async () => current,
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
