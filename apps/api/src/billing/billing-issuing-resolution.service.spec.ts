import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type { SzamlazzAgentResponse } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import type { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import type { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import type {
  BillingDocumentRow,
  BillingDocumentsRepository,
} from "./billing-documents.repository.js";
import type { BillingIssuingResolutionRepository } from "./billing-issuing-resolution.repository.js";
import { BillingIssuingResolutionService } from "./billing-issuing-resolution.service.js";

/**
 * A KIVEZETŐ ÚT SZOLGÁLTATÁSA, HAMIS SZÁMLÁZZ.HU-VAL. A feltételes írásokat a
 * valódi adatbázis méri (integrációs spec); ez azt, hogy a szolgáltatás a
 * tényekből a helyes javaslatot adja, a végrehajtás MÉG EGYSZER lekérdez, és
 * a kliens kiállító metódusa (`generateInvoice`) eldobja a futást, ha
 * az osztály bármikor hívná.
 *
 * Mi pirosít: írás az ellenőrzésnél; végrehajtás a friss lekérdezés
 * egyeztetése nélkül; DRAFT pozitív kontroll nélkül; a Számlázz.hu válaszából
 * vevő-adat az AuditLogban.
 */
const USER = { id: "user-1" } as AuthenticatedUser;
const LIVE = { BILLING_ISSUE_ENABLED: "true" };
const UPDATED_AT = new Date(Date.now() - 3 * 3_600_000);
const d = (value: string) => new Prisma.Decimal(value);

const FOUND_XML = (number: string, gross = "1270", kind = "SZ") =>
  '<szamla xmlns="http://www.szamlazz.hu/szamla"><alap><szamlaszam>' +
  number +
  "</szamlaszam><tipus>" +
  kind +
  "</tipus><kelt>2026-10-27</kelt></alap><vevo><nev>Titkos Vevő Kft.</nev></vevo>" +
  "<osszegek><totalossz><netto>1000</netto><afa>270</afa><brutto>" +
  gross +
  "</brutto></totalossz></osszegek></szamla>";
const NOT_FOUND_XML =
  "<xmlszamlavalasz><sikeres>false</sikeres><hibakod>7</hibakod></xmlszamlavalasz>";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    status: "ISSUING",
    direction: "OUTBOUND",
    source: "SZAMLAZZ",
    sourceType: "MANUAL",
    completionCertificateId: null,
    syncError: null,
    issueAttemptCount: 1,
    emailStatus: null,
    invoiceNumber: null,
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    fulfillmentDate: new Date("2026-09-30T00:00:00Z"),
    dueDate: new Date("2026-10-08T00:00:00Z"),
    paymentMethod: "Átutalás",
    currency: "HUF",
    language: "hu",
    reference: null,
    note: null,
    sourceId: null,
    netAmount: d("1000"),
    vatAmount: d("270"),
    grossAmount: d("1270"),
    customer: {
      id: "cust-1",
      customerNumber: "C-1",
      displayName: "Titkos Vevő Kft.",
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
    updatedAt: UPDATED_AT,
    ...over,
  } as unknown as BillingDocumentRow;
}

type Answer = string | Error | ((key: string) => string | Error);

function setup(
  options: {
    env?: NodeJS.ProcessEnv;
    over?: Record<string, unknown>;
    /** A külső azonosítóra (doc-1, ctl-1) vagy számlaszámra adott válasz. */
    answers?: Record<string, Answer>;
    control?: { id: string; invoiceNumber: string } | null;
    /** A kontroll bizonylat típusa; a hamis repository csak ilyet ad (alap: INVOICE). */
    controlType?: string;
    writeOk?: boolean;
  } = {},
) {
  const calls = {
    queries: [] as string[],
    controlRequests: [] as string[],
    queryXml: [] as string[],
    audits: [] as Array<{ action: string; metadata: unknown }>,
    recorded: [] as Array<Record<string, unknown>>,
    drafts: [] as Array<Record<string, unknown>>,
    stock: 0,
    pdfRequests: 0,
    pdfPut: 0,
    setPdf: 0,
  };
  const answers = options.answers ?? {};
  const documents = {
    find: async () => row(options.over),
  } as unknown as BillingDocumentsRepository;
  const repository = {
    audit: async (input: { action: string; metadata: unknown }) => {
      calls.audits.push(input);
    },
    latestIssuedForControl: async (documentType: string) => {
      calls.controlRequests.push(documentType);
      // a valódi repository típus szerint szűr: ilyen típusú sor nincs, nincs kontroll
      if (documentType !== (options.controlType ?? "INVOICE")) return null;
      return options.control === undefined
        ? { id: "ctl-1", invoiceNumber: "E-CTL-1" }
        : options.control;
    },
    recordIssued: async (input: Record<string, unknown>) => {
      calls.recorded.push(input);
      return options.writeOk ?? true;
    },
    backToDraft: async (input: Record<string, unknown>) => {
      calls.drafts.push(input);
      return options.writeOk ?? true;
    },
  } as unknown as BillingIssuingResolutionRepository;
  const issueRepository = {
    setPdf: async () => {
      calls.setPdf++;
    },
  } as unknown as BillingDocumentIssueRepository;
  const credentials = {
    resolve: async () => ({ agentKey: "test-key" }),
  } as unknown as SzamlazzCredentialProvider;
  const store = {
    put: async () => {
      calls.pdfPut++;
    },
  } as unknown as DocumentStore;
  const stock = {
    postIssuedInvoice: async () => {
      calls.stock++;
      return { alreadyPosted: false, movedLines: 1 };
    },
  } as unknown as BillingDocumentStockRepository;
  const client = {
    // a futásidejű kliensnek VAN kiállító metódusa: ha az osztály valaha hívná, a teszt itt bukik
    generateInvoice: async () => {
      throw new Error("a kivezető út kiállító hívást indított");
    },
    queryDocument: async (xml: string) => {
      const key =
        /<(?:szamlaKulsoAzon|szamlaszam)>([^<]*)</.exec(xml)?.[1] ?? "";
      calls.queries.push(key);
      calls.queryXml.push(xml);
      const answer = answers[key];
      const value = typeof answer === "function" ? answer(key) : answer;
      if (value === undefined) throw new Error(`nincs válasz: ${key}`);
      if (value instanceof Error) throw value;
      return value;
    },
    downloadInvoicePdf: async (): Promise<SzamlazzAgentResponse> => {
      calls.pdfRequests++;
      return { successful: true, pdf: Buffer.from("PDF") };
    },
  };
  const service = new BillingIssuingResolutionService(
    documents,
    repository,
    issueRepository,
    credentials,
    store,
    stock,
    client,
    options.env ?? LIVE,
  );
  return { service, calls };
}

describe("ellenőrzés (check): csak olvas", () => {
  it("bizonytalan ág, a Számlázz.hu a mi azonosítónkra számot ad -> ISSUED javaslat, írás nincs", async () => {
    const { service, calls } = setup({
      answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.action, "RECORD_ISSUED");
    assert.equal(check.invoiceNumber, "E-TST-2026-7");
    assert.equal(check.expectedUpdatedAt, UPDATED_AT.toISOString());
    assert.equal(check.kind, "NO_NOTE");
    assert.deepEqual(calls.queries, ["doc-1"]);
    assert.equal(calls.recorded.length + calls.drafts.length, 0);
    assert.equal(calls.audits.length, 1);
    assert.equal(calls.audits[0]!.action, "BILLING_ISSUING_CHECKED");
  });

  it("az AuditLogba csak szám, típus, végösszeg és hibakód kerül, vevő-adat nem", async () => {
    const { service, calls } = setup({
      answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
    });
    await service.check("doc-1", USER);
    const text = JSON.stringify(calls.audits[0]!.metadata);
    assert.doesNotMatch(text, /Titkos|Fő utca|vevo@/);
    assert.match(text, /E-TST-2026-7/);
    assert.match(text, /1270/);
  });

  it("nincs azonosító (7), a pozitív kontroll megtalált, a sor régi -> DRAFT javaslat", async () => {
    const { service, calls } = setup({
      answers: { "doc-1": NOT_FOUND_XML, "ctl-1": FOUND_XML("E-CTL-1") },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.action, "BACK_TO_DRAFT");
    assert.equal(check.lookup, "NOT_FOUND");
    assert.deepEqual(calls.queries, ["doc-1", "ctl-1"]);
  });

  it("a kontroll NEM találja meg (a kérés alakja hibás lehet) -> nem tudjuk, nincs DRAFT", async () => {
    const { service } = setup({
      answers: { "doc-1": NOT_FOUND_XML, "ctl-1": NOT_FOUND_XML },
    });
    assert.equal((await service.check("doc-1", USER)).action, "NONE");
  });

  it("a kontroll más számot ad -> nem tudjuk", async () => {
    const { service } = setup({
      answers: { "doc-1": NOT_FOUND_XML, "ctl-1": FOUND_XML("E-MAS-9") },
    });
    assert.equal((await service.check("doc-1", USER)).action, "NONE");
  });

  it("nincs kiállított bizonylat a kontrollhoz -> nem tudjuk", async () => {
    const { service, calls } = setup({
      answers: { "doc-1": NOT_FOUND_XML },
      control: null,
    });
    assert.equal((await service.check("doc-1", USER)).action, "NONE");
    assert.deepEqual(calls.queries, ["doc-1"]);
  });

  it("fiatal sor -> nem tudjuk, akkor is, ha minden más rendben", async () => {
    const { service } = setup({
      over: { updatedAt: new Date(Date.now() - 5 * 60_000) },
      answers: { "doc-1": NOT_FOUND_XML, "ctl-1": FOUND_XML("E-CTL-1") },
    });
    assert.equal((await service.check("doc-1", USER)).action, "NONE");
  });

  it("időtúllépés vagy érthetetlen válasz -> nem tudjuk", async () => {
    for (const answer of [new Error("ETIMEDOUT"), "<html>502</html>"]) {
      const { service } = setup({ answers: { "doc-1": answer } });
      const check = await service.check("doc-1", USER);
      assert.equal(check.action, "NONE");
      assert.equal(check.lookup, "UNKNOWN");
    }
  });

  it("RECORDING_FAILED: a szövegben álló számmal egyező találat -> ISSUED", async () => {
    const { service } = setup({
      over: {
        syncError:
          "A Számlázz.hu kiállította a(z) E-TST-2026-7 bizonylatot, de a rögzítése nálunk nem sikerült. Rögzítsd kézzel ezt a számot.",
      },
      answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.kind, "RECORDING_FAILED");
    assert.equal(check.action, "RECORD_ISSUED");
  });

  it("STRAY_PREVIEW: számlaszám szerint keres (az előnézetnek nincs külső azonosítója)", async () => {
    const { service, calls } = setup({
      over: {
        syncError:
          "Egy előnézet-kérés valódi bizonylatot hozott létre a Számlázz.hu-n: E-TST-2026-7. Ellenőrizd.",
      },
      answers: { "E-TST-2026-7": FOUND_XML("E-TST-2026-7") },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.kind, "STRAY_PREVIEW");
    assert.equal(check.action, "RECORD_ISSUED");
    assert.match(calls.queryXml[0]!, /<szamlaszam>E-TST-2026-7</);
    assert.doesNotMatch(calls.queryXml[0]!, /szamlaKulsoAzon/);
  });

  it("a kontroll AZONOS TÍPUSÚ bizonylat kell legyen: beragadt díjbekérőhöz csak számla van -> nem tudjuk", async () => {
    const { service, calls } = setup({
      over: { documentType: "PROFORMA" },
      controlType: "INVOICE",
      answers: { "doc-1": NOT_FOUND_XML, "ctl-1": FOUND_XML("E-CTL-1") },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.action, "NONE");
    assert.deepEqual(calls.controlRequests, ["PROFORMA"]);
    assert.deepEqual(calls.queries, ["doc-1"]);
  });

  it("azonos típusú kontrollal a beragadt díjbekérő DRAFT javaslatot kap", async () => {
    const { service } = setup({
      over: { documentType: "PROFORMA" },
      controlType: "PROFORMA",
      answers: { "doc-1": NOT_FOUND_XML, "ctl-1": FOUND_XML("E-CTL-1") },
    });
    assert.equal((await service.check("doc-1", USER)).action, "BACK_TO_DRAFT");
  });

  it("nem kezdi el: se ISSUING, se próbázható állapot; nem saját sor; nem éles mód", async () => {
    for (const options of [
      { over: { status: "ISSUE_FAILED" } },
      { over: { source: "OTHER" } },
      { env: {} },
      { env: { SZAMLAZZ_AGENT_MODE: "stub" } },
    ])
      await assert.rejects(
        setup(options).service.check("doc-1", USER),
        ConflictException,
        JSON.stringify(options),
      );
  });
});

describe("végrehajtás (resolve): újra lekérdez, egyezést vár", () => {
  const confirm = {
    expectedUpdatedAt: UPDATED_AT.toISOString(),
    action: "RECORD_ISSUED" as const,
    invoiceNumber: "E-TST-2026-7",
  };

  it("RECORD_ISSUED: a Számlázz.hu számával és keltével ír, PDF-et kér, készletet könyvel", async () => {
    const { service, calls } = setup({
      answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
    });
    await service.resolve("doc-1", confirm, USER);
    assert.equal(calls.recorded.length, 1);
    const written = calls.recorded[0]!;
    assert.equal(written.invoiceNumber, "E-TST-2026-7");
    assert.equal(
      (written.issueDate as Date).toISOString().slice(0, 10),
      "2026-10-27",
    );
    assert.equal(
      (written.expectedUpdatedAt as Date).toISOString(),
      UPDATED_AT.toISOString(),
    );
    assert.equal(written.emailStatus, "PENDING");
    assert.equal(calls.pdfRequests, 1);
    assert.equal(calls.pdfPut, 1);
    assert.equal(calls.stock, 1);
    assert.doesNotMatch(
      JSON.stringify(written.auditMetadata),
      /Titkos|Fő utca/,
    );
  });

  it("a végrehajtás MÁSODSZOR is lekérdez: ha közben eltűnt a találat, nem ír", async () => {
    let first = true;
    const { service, calls } = setup({
      answers: {
        "doc-1": () => {
          if (first) {
            first = false;
            return FOUND_XML("E-TST-2026-7");
          }
          return NOT_FOUND_XML;
        },
        "ctl-1": FOUND_XML("E-CTL-1"),
      },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.action, "RECORD_ISSUED");
    await assert.rejects(
      service.resolve("doc-1", confirm, USER),
      ConflictException,
    );
    assert.equal(calls.recorded.length + calls.drafts.length, 0);
  });

  it("eltérő megerősítés (szám, akció, updatedAt) -> 409, írás nincs", async () => {
    for (const bad of [
      { ...confirm, invoiceNumber: "E-TST-2026-8" },
      { ...confirm, action: "BACK_TO_DRAFT" as const, invoiceNumber: null },
      { ...confirm, expectedUpdatedAt: new Date(0).toISOString() },
    ]) {
      const { service, calls } = setup({
        answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
      });
      await assert.rejects(
        service.resolve("doc-1", bad, USER),
        ConflictException,
      );
      assert.equal(calls.recorded.length + calls.drafts.length, 0);
    }
  });

  it("BACK_TO_DRAFT: csak a megerősített javaslatra, a régi szöveg az AuditLogba kerül", async () => {
    const { service, calls } = setup({
      over: {
        syncError: "A Számlázz.hu válasza nem érkezett meg (ETIMEDOUT).",
      },
      answers: { "doc-1": NOT_FOUND_XML, "ctl-1": FOUND_XML("E-CTL-1") },
    });
    await service.resolve(
      "doc-1",
      {
        expectedUpdatedAt: UPDATED_AT.toISOString(),
        action: "BACK_TO_DRAFT",
        invoiceNumber: null,
      },
      USER,
    );
    assert.equal(calls.drafts.length, 1);
    assert.match(JSON.stringify(calls.drafts[0]!.auditMetadata), /ETIMEDOUT/);
    assert.equal(calls.recorded.length, 0);
  });

  it("BACK_TO_DRAFT: a hiányzó invoiceNumber (undefined) ugyanaz, mint a null", async () => {
    const { service, calls } = setup({
      answers: { "doc-1": NOT_FOUND_XML, "ctl-1": FOUND_XML("E-CTL-1") },
    });
    await service.resolve(
      "doc-1",
      {
        expectedUpdatedAt: UPDATED_AT.toISOString(),
        action: "BACK_TO_DRAFT",
      } as unknown as Parameters<typeof service.resolve>[1],
      USER,
    );
    assert.equal(calls.drafts.length, 1);
  });

  it("a feltételes írás nem sikerült (a sor közben megváltozott) -> 409, nincs utómunka", async () => {
    const { service, calls } = setup({
      answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
      writeOk: false,
    });
    await assert.rejects(
      service.resolve("doc-1", confirm, USER),
      ConflictException,
    );
    assert.equal(calls.pdfRequests + calls.stock, 0);
  });

  it("javaslat nélküli (nem tudjuk) sorra semmilyen megerősítés nem ír", async () => {
    const { service, calls } = setup({
      answers: { "doc-1": new Error("ETIMEDOUT") },
    });
    for (const action of ["RECORD_ISSUED", "BACK_TO_DRAFT"] as const)
      await assert.rejects(
        service.resolve(
          "doc-1",
          {
            expectedUpdatedAt: UPDATED_AT.toISOString(),
            action,
            invoiceNumber: action === "RECORD_ISSUED" ? "E-TST-2026-7" : null,
          },
          USER,
        ),
        ConflictException,
      );
    assert.equal(calls.recorded.length + calls.drafts.length, 0);
  });
});

describe("PRÓBA: a lekérdezés mérése nem ISSUING soron (csak olvas, nem javasol)", () => {
  const issued = { status: "ISSUED", invoiceNumber: "E-TST-2026-7" };

  it("kiállított sor: a Számlázz.hu a saját számát adja -> a lekérdezés működik, javaslat nincs", async () => {
    const { service, calls } = setup({
      over: issued,
      answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.probe, true);
    assert.equal(check.kind, null);
    assert.equal(check.lookup, "FOUND");
    assert.equal(check.action, "NONE");
    assert.equal(check.invoiceNumber, null);
    assert.match(check.reason, /a lekérdezés működik/);
    assert.deepEqual(calls.queries, ["doc-1"]);
    // csak a nyom kerül az AuditLogba, állapot-írás nincs
    assert.equal(calls.audits.length, 1);
    assert.match(JSON.stringify(calls.audits[0]!.metadata), /"probe":true/);
    assert.doesNotMatch(
      JSON.stringify(calls.audits[0]!.metadata),
      /Titkos|Fő utca|vevo@/,
    );
    assert.equal(calls.recorded.length + calls.drafts.length, 0);
  });

  it("kiállított sor, de a Számlázz.hu 7-est ad -> ELLENTMONDÁS, a 7-es nem hihető", async () => {
    const { service } = setup({
      over: issued,
      answers: { "doc-1": NOT_FOUND_XML },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.lookup, "NOT_FOUND");
    assert.match(check.reason, /ELLENTMONDÁS/);
    assert.equal(check.action, "NONE");
  });

  it("kiállított sor, más számmal -> ELLENTMONDÁS", async () => {
    const { service } = setup({
      over: issued,
      answers: { "doc-1": FOUND_XML("E-MAS-9") },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.lookup, "FOUND");
    assert.match(check.reason, /ELLENTMONDÁS/);
  });

  it("vázlat: a 7-es hibakód a várt (sosem kiállított azonosító)", async () => {
    const { service } = setup({
      over: { status: "DRAFT" },
      answers: { "doc-1": NOT_FOUND_XML },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.lookup, "NOT_FOUND");
    assert.equal(check.action, "NONE");
    assert.match(check.reason, /hibakód 7.*várható/);
    assert.doesNotMatch(check.reason, /ELLENTMONDÁS/);
  });

  it("vázlat, amire a Számlázz.hu számot ad -> ELLENTMONDÁS", async () => {
    const { service } = setup({
      over: { status: "DRAFT" },
      answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
    });
    assert.match((await service.check("doc-1", USER)).reason, /ELLENTMONDÁS/);
  });

  it("időtúllépés -> nem tudjuk", async () => {
    const { service } = setup({
      over: issued,
      answers: { "doc-1": new Error("ETIMEDOUT") },
    });
    const check = await service.check("doc-1", USER);
    assert.equal(check.lookup, "UNKNOWN");
    assert.equal(check.action, "NONE");
  });

  it("a próba is csak éles módban, és csak saját ISSUED/DRAFT soron megy", async () => {
    for (const options of [
      { over: issued, env: {} },
      { over: issued, env: { SZAMLAZZ_AGENT_MODE: "stub" } },
      { over: { ...issued, source: "OTHER" } },
      { over: { status: "ISSUE_FAILED" } },
    ])
      await assert.rejects(
        setup({
          answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
          ...options,
        }).service.check("doc-1", USER),
        ConflictException,
        JSON.stringify(options),
      );
  });

  it("a végrehajtás próba-soron 409: csak ISSUING sort ír", async () => {
    for (const over of [issued, { status: "DRAFT" }]) {
      const { service, calls } = setup({
        over,
        answers: { "doc-1": FOUND_XML("E-TST-2026-7") },
      });
      await assert.rejects(
        service.resolve(
          "doc-1",
          {
            expectedUpdatedAt: UPDATED_AT.toISOString(),
            action: "RECORD_ISSUED",
            invoiceNumber: "E-TST-2026-7",
          },
          USER,
        ),
        ConflictException,
      );
      assert.equal(calls.recorded.length + calls.drafts.length, 0);
    }
  });
});
