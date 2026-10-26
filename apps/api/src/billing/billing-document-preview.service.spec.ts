import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import type { SzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import { SzamlazzAgentHttpError } from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzAgentResponse } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { buildSzamlazzAgentInvoiceXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import type { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import { BillingDocumentPreviewService } from "./billing-document-preview.service.js";
import type {
  BillingDocumentRow,
  BillingDocumentsRepository,
} from "./billing-documents.repository.js";

/**
 * AZ ELŐNÉZET SZOLGÁLTATÁSA, HAMIS SZÁMLÁZZ.HU-VAL. A szolgáltatás
 * konstruktora SZÁNDÉKOSAN nem kap kiállító repót és dokumentumtárat, tehát
 * "nem foglal, nem ír, nem tárol" típus-szinten áll; ez a spec azt méri, hogy
 * a kérés alakja (elonezetpdf, külső azonosító nélkül) és a kimenetek jók.
 *
 * Mi pirosít: hívás kikapcsolt vagy ellentmondásos kapcsolónál; hívás nem
 * vázlatra; `szamlaKulsoAzon` a kérésben; `elonezetpdf` hiánya; PDF nélküli
 * vagy nem PDF válasz átadása; álszámlázó módban kimenő hívás.
 */
const ON = { BILLING_ISSUE_ENABLED: "true" };
const STUB = { SZAMLAZZ_AGENT_MODE: "stub" };
const d = (value: string) => new Prisma.Decimal(value);
const PDF = Buffer.from("%PDF-1.4 elonezet");

function row(status = "DRAFT", over: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    status,
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
    sourceType: "MANUAL",
    sourceId: null,
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
    ...over,
  } as unknown as BillingDocumentRow;
}

function setup(
  options: {
    found?: BillingDocumentRow | null;
    env?: NodeJS.ProcessEnv;
    respond?: () => Promise<SzamlazzAgentResponse>;
    /** Replaces the request builder (a test drops the preview marker with it). */
    buildXml?: typeof buildSzamlazzAgentInvoiceXml;
    strayFails?: boolean;
  } = {},
) {
  const calls = {
    generate: 0,
    resolve: 0,
    xml: [] as string[],
    stray: [] as Array<[string, string]>,
  };
  const documents = {
    find: async () => (options.found === undefined ? row() : options.found),
  } as unknown as BillingDocumentsRepository;
  const credentials = {
    resolve: async () => {
      calls.resolve++;
      return { agentKey: "test-key", source: "database", revision: "db:1" };
    },
  } as unknown as SzamlazzCredentialProvider;
  const issueRepository = {
    markStrayIssue: async (id: string, note: string) => {
      calls.stray.push([id, note]);
      if (options.strayFails) throw new Error("adatbázis nem elérhető");
      return { count: 1 };
    },
  } as unknown as BillingDocumentIssueRepository;
  const client: SzamlazzAgentClient = {
    generateInvoice: async (xml: string) => {
      calls.generate++;
      calls.xml.push(xml);
      return (
        options.respond?.() ??
        Promise.resolve({ successful: true, pdf: PDF } as SzamlazzAgentResponse)
      );
    },
  };
  const service = new BillingDocumentPreviewService(
    documents,
    credentials,
    issueRepository,
    client,
    options.env ?? ON,
    options.buildXml,
  );
  return { service, calls };
}

describe("BillingDocumentPreviewService", () => {
  it("asks for a preview PDF without an external id and hands the bytes back", async () => {
    const { service, calls } = setup();
    const bytes = await service.preview("doc-1");
    assert.deepEqual(bytes, PDF);
    assert.equal(calls.generate, 1);
    const xml = calls.xml[0]!;
    assert.match(xml, /<elonezetpdf>true<\/elonezetpdf>/);
    assert.match(xml, /<sendEmail>false<\/sendEmail>/);
    assert.match(xml, /<szamlaagentkulcs>test-key<\/szamlaagentkulcs>/);
    // a külső azonosító nélkül nem foglalhatja le a későbbi kiállításét
    assert.doesNotMatch(xml, /szamlaKulsoAzon/);
    // a normál úton a vészág írása nem fut
    assert.equal(calls.stray.length, 0);
  });

  /*
    A FUTÁSIDEJŰ ŐR (barracuda, #1874): ha egy átírás elveszítené az
    `elonezetpdf` jelölést, az éles kliens VALÓDI számlát állítana ki. MI
    PIROSÍT: ha a kérés jelölés nélkül is elmegy.
  */
  it("does not send a request that lost the preview marker", async () => {
    const { service, calls } = setup({
      buildXml: (input) =>
        buildSzamlazzAgentInvoiceXml(input).replace(
          "<elonezetpdf>true</elonezetpdf>",
          "",
        ),
    });
    await assert.rejects(service.preview("doc-1"), ServiceUnavailableException);
    assert.equal(calls.generate, 0);
    assert.equal(calls.stray.length, 0);
  });

  /*
    HA AZ ELŐNÉZET MÉGIS SZÁMOT HOZ, A SZÁMLÁZZ.HU KIÁLLÍTOTT. MI PIROSÍT: ha a
    PDF-et szó nélkül visszaadja; ha a szám nem kerül a bizonylat mellé; ha a
    szám a hibaüzenetből hiányzik; ha a bizonylat-írás hibája elnyelné a hibát.
  */
  it("fails loudly when the preview answer carries an invoice number, and records it", async () => {
    const { service, calls } = setup({
      respond: async () => ({
        successful: true,
        invoiceNumber: "E-2026-77",
        pdf: PDF,
      }),
    });
    await assert.rejects(
      service.preview("doc-1"),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        /E-2026-77/.test(error.message),
    );
    assert.equal(calls.stray.length, 1);
    assert.equal(calls.stray[0]![0], "doc-1");
    assert.match(calls.stray[0]![1], /E-2026-77/);
  });

  it("still fails loudly when recording the stray number fails", async () => {
    const { service, calls } = setup({
      strayFails: true,
      respond: async () => ({
        successful: true,
        invoiceNumber: "E-2026-78",
        pdf: PDF,
      }),
    });
    await assert.rejects(
      service.preview("doc-1"),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        /E-2026-78/.test(error.message),
    );
    assert.equal(calls.stray.length, 1);
  });

  it("refuses when issuing is switched off or contradictory, before any call", async () => {
    for (const env of [{}, { ...ON, ...STUB }]) {
      const { service, calls } = setup({ env });
      await assert.rejects(service.preview("doc-1"), ConflictException);
      assert.equal(calls.generate, 0);
      assert.equal(calls.resolve, 0);
    }
  });

  it("answers 404 for an unknown document", async () => {
    const { service, calls } = setup({ found: null });
    await assert.rejects(service.preview("x"), NotFoundException);
    assert.equal(calls.generate, 0);
  });

  it("does not preview a document that is not a draft", async () => {
    for (const status of ["ISSUED", "ISSUING", "ISSUE_FAILED"]) {
      const { service, calls } = setup({ found: row(status) });
      await assert.rejects(service.preview("doc-1"), ConflictException);
      assert.equal(calls.generate, 0);
    }
  });

  it("answers 400 and does not call out for a draft that cannot be built", async () => {
    const { service, calls } = setup({
      found: row("DRAFT", { customer: null }),
    });
    await assert.rejects(service.preview("doc-1"), BadRequestException);
    assert.equal(calls.generate, 0);
  });

  it("passes a Számlázz.hu rejection on as a 400 with its code", async () => {
    const { service } = setup({
      respond: async () => ({
        successful: false,
        errorCode: "57",
        errorMessage: "Hibás adószám",
      }),
    });
    await assert.rejects(
      service.preview("doc-1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /\(57\)/.test(error.message) &&
        /Hibás adószám/.test(error.message),
    );
  });

  it("does not hand over a success without a PDF, or with something that is not one", async () => {
    for (const pdf of [undefined, Buffer.from("<html>nem pdf</html>")]) {
      const { service } = setup({
        respond: async () => ({ successful: true, pdf }),
      });
      await assert.rejects(
        service.preview("doc-1"),
        ServiceUnavailableException,
      );
    }
  });

  it("maps a transport failure to 503", async () => {
    for (const failure of [
      new SzamlazzAgentHttpError(502, "bad gateway"),
      new Error("ECONNRESET"),
    ]) {
      const { service } = setup({
        respond: async () => {
          throw failure;
        },
      });
      await assert.rejects(
        service.preview("doc-1"),
        ServiceUnavailableException,
      );
    }
  });

  it("in stub mode makes no outgoing call, reads no key and returns a MINTA sheet", async () => {
    const { service, calls } = setup({ env: STUB });
    const bytes = await service.preview("doc-1");
    assert.equal(calls.generate, 0);
    assert.equal(calls.resolve, 0);
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "%PDF");
    assert.match(bytes.toString("latin1"), /MINTA/);
  });
});
