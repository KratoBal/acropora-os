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

import { StubSzamlazzAgentClient } from "../integrations/szamlazz/szamlazz-agent-stub.client.js";
import {
  HttpSzamlazzAgentClient,
  SzamlazzAgentHttpError,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import {
  buildSzamlazzAgentStornoXml,
  type SzamlazzAgentResponse,
} from "../integrations/szamlazz/szamlazz-agent-xml.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { osCancellation } from "./billing-document-detail-read.js";
import type { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import { BillingDocumentStornoService } from "./billing-document-storno.service.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import type {
  BillingDocumentRow,
  BillingDocumentsRepository,
} from "./billing-documents.repository.js";

/**
 * A SZTORNÓ (számlázási brief, 1. pont). MI PIROSÍT: a kérés a séma sorrendjén
 * kívül vagy rossz mezőnéven megy; hívás kikapcsolt kapcsolóval, díjbekérőre
 * vagy nem kiállított számlára; két kattintásból két hívás; egy elutasítás,
 * ami nem ISSUE_FAILED, vagy egy ismeretlen kimenet, ami nem marad ISSUING-ben;
 * a sztornó összege nem az eredeti ellentettje; a készlet nem jön vissza; a
 * részletek nem mondják meg, hogy a számla sztornózva van.
 */
const USER = { id: "user-1" } as AuthenticatedUser;
const ON = { BILLING_ISSUE_ENABLED: "true" };
const d = (value: string) => new Prisma.Decimal(value);
const PDF = Buffer.from("%PDF-1.4 sztorno");

describe("a sztornó kérése", () => {
  it("a séma sorrendjében: kulcs, e-számla, letöltés, válaszverzió; szám, kelte, ok, típus", () => {
    const xml = buildSzamlazzAgentStornoXml({
      agentKey: "k",
      invoiceNumber: "E-1",
      electronic: true,
      issueDate: "2026-10-12",
      reason: "rossz <vevő>",
    });
    assert.match(
      xml,
      /<beallitasok><szamlaagentkulcs>k<\/szamlaagentkulcs><eszamla>true<\/eszamla><szamlaLetoltes>true<\/szamlaLetoltes><valaszVerzio>2<\/valaszVerzio><\/beallitasok><fejlec><szamlaszam>E-1<\/szamlaszam><keltDatum>2026-10-12<\/keltDatum><megjegyzes>rossz &lt;vevő&gt;<\/megjegyzes><tipus>SS<\/tipus><\/fejlec><\/xmlszamlast>$/,
    );
    // ok nélkül a megjegyzés kimarad; papír számlánál nem e-számla
    const plain = buildSzamlazzAgentStornoXml({
      agentKey: "k",
      invoiceNumber: "P-1",
      electronic: false,
      issueDate: "2026-10-12",
      reason: "  ",
    });
    assert.match(plain, /<eszamla>false<\/eszamla>/);
    assert.doesNotMatch(plain, /megjegyzes/);
  });

  it("az action-szamla_agent_st mezőn megy; a stub is ismeri", async () => {
    let mezo: unknown;
    const client = new HttpSzamlazzAgentClient(
      "https://example.invalid/szamla/",
      (async (_url: string | URL, init?: RequestInit) => {
        mezo = (init?.body as FormData).get("action-szamla_agent_st");
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz"><sikeres>true</sikeres><szamlaszam>E-9</szamlaszam></xmlszamlavalasz>`,
          { status: 200 },
        );
      }) as typeof fetch,
    );
    const r = await client.stornoInvoice("<xmlszamlast/>");
    const stub = await new StubSzamlazzAgentClient().stornoInvoice();
    assert.ok(mezo instanceof Blob);
    assert.equal(r.invoiceNumber, "E-9");
    assert.match(stub.invoiceNumber ?? "", /^TESZT-SZTORNO-/);
  });
});

type Storno = {
  id: string;
  status: string;
  invoiceNumber: string | null;
  issueDate: Date | null;
  pdfStorageKey: string | null;
  syncError: string | null;
};

function setup(
  options: {
    status?: string;
    documentType?: string;
    storno?: Storno | null;
    env?: NodeJS.ProcessEnv;
    answer?: () => SzamlazzAgentResponse;
    createThrows?: unknown;
    final?: { status: string; stornoed?: boolean } | null;
    /** A sztornó foglalása UTÁN látszó végszámla (a kettő egyszerre indult). */
    finalAfterClaim?: { status: string } | null;
  } = {},
) {
  const state = {
    storno: options.storno ?? null,
    calls: [] as string[],
    created: null as Record<string, unknown> | null,
    stock: [] as unknown[][],
    puts: [] as string[],
  };
  const original = () =>
    ({
      id: "doc-1",
      status: options.status ?? "ISSUED",
      documentType: options.documentType ?? "INVOICE",
      invoiceNumber: "E-1",
      invoiceFormat: "ELECTRONIC",
      partnerName: "Kitalált Kft.",
      partnerTaxNumber: "12345678-2-42",
      customerId: "cust-1",
      currency: "HUF",
      paymentMethod: "Átutalás",
      language: "hu",
      buyerSnapshot: null,
      netAmount: d("1000"),
      vatAmount: d("270"),
      grossAmount: d("1270"),
      correctionInvoices: state.storno ? [state.storno] : [],
      lines: [],
      mailDeliveries: [],
      createdAt: new Date("2026-10-01T10:00:00Z"),
      updatedAt: new Date("2026-10-01T10:00:00Z"),
    }) as unknown as BillingDocumentRow;
  const documents = {
    find: async () => original(),
    finalInvoiceOf: async () => {
      const final =
        state.storno?.status === "ISSUING" &&
        options.finalAfterClaim !== undefined
          ? options.finalAfterClaim
          : options.final;
      return final
        ? {
            id: "fin-1",
            invoiceNumber: final.status === "ISSUED" ? "E-VEG-1" : null,
            status: final.status,
            correctionInvoices:
              "stornoed" in final && final.stornoed ? [{ id: "st-f" }] : [],
          }
        : null;
    },
  } as unknown as BillingDocumentsRepository;
  const service = new BillingDocumentStornoService(
    documents,
    {
      resolve: async () => ({ agentKey: "kulcs", revision: "r" }),
    } as unknown as SzamlazzCredentialProvider,
    {
      put: async (key: { ownerId: string }) =>
        void state.puts.push(key.ownerId),
    } as unknown as DocumentStore,
    {
      postStornoReturn: async (...args: unknown[]) => {
        state.stock.push(args);
        return null;
      },
    } as unknown as BillingDocumentStockRepository,
    {
      stornoInvoice: async (xml: string) => {
        state.calls.push(xml);
        return (
          options.answer ??
          (() => ({
            successful: true,
            invoiceNumber: "E-STORNO-1",
            grossTotal: -1270,
            pdf: PDF,
          }))
        )();
      },
    },
    options.env ?? ON,
  );
  const storno = () => state.storno!;
  (service as unknown as { database: unknown }).database = {
    invoice: {
      create: async (args: { data: Record<string, unknown> }) => {
        if (options.createThrows) throw options.createThrows;
        state.created = args.data;
        state.storno = {
          id: "storno-1",
          status: String(args.data.status),
          invoiceNumber: null,
          issueDate: null,
          pdfStorageKey: null,
          syncError: null,
        };
        return { id: "storno-1" };
      },
      updateMany: async (args: {
        where: { id: string; status: string };
        data: Record<string, unknown>;
      }) => {
        if (!state.storno || state.storno.status !== args.where.status)
          return { count: 0 };
        Object.assign(storno(), args.data);
        return { count: 1 };
      },
      update: async (args: { data: Record<string, unknown> }) => {
        Object.assign(storno(), args.data);
        return {};
      },
    },
  };
  return { service, state };
}

describe("a sztornó szolgáltatás", () => {
  it("kikapcsolt kapcsolóval, díjbekérőre vagy nem kiállított számlára nem hív", async () => {
    for (const s of [
      setup({ env: {} }),
      setup({ documentType: "PROFORMA" }),
      setup({ status: "DRAFT" }),
    ]) {
      await assert.rejects(
        s.service.storno("doc-1", undefined, USER),
        ConflictException,
      );
      assert.equal(s.state.calls.length, 0);
    }
  });

  it("az előleg nem sztornózható, amíg kiállított végszámla vonja le; a végszámla sztornója vagy egy vázlat nem akadály (barracuda, #1672)", async () => {
    for (const status of ["ISSUED", "ISSUING"]) {
      const s = setup({ documentType: "ADVANCE_INVOICE", final: { status } });
      await assert.rejects(
        s.service.storno("doc-1", undefined, USER),
        (error: unknown) =>
          error instanceof ConflictException &&
          /végszámla hivatkozik/.test(error.message),
        status,
      );
      assert.equal(s.state.calls.length, 0);
    }
    for (const final of [
      { status: "ISSUED", stornoed: true },
      { status: "DRAFT" },
      null,
    ]) {
      const s = setup({ documentType: "ADVANCE_INVOICE", final });
      await s.service.storno("doc-1", undefined, USER);
      assert.equal(s.state.calls.length, 1, JSON.stringify(final));
    }
  });

  /*
    A FOGLALÁS UTÁNI VISSZAOLVASÁS (barracuda, #1674): a végszámla kiállítása az
    őr és a foglalás között indult el. MI PIROSÍT: a sztornó ilyenkor is
    elmegy, vagy ISSUING-ben ragad ahelyett, hogy elutasítottra váltana.
  */
  it("a final invoice claimed between the guard and the storno's claim stops the storno before Számlázz.hu", async () => {
    const s = setup({
      documentType: "ADVANCE_INVOICE",
      final: { status: "DRAFT" },
      finalAfterClaim: { status: "ISSUING" },
    });
    await assert.rejects(
      s.service.storno("doc-1", undefined, USER),
      (error: unknown) =>
        error instanceof ConflictException &&
        /végszámla hivatkozik/.test(error.message),
    );
    assert.equal(s.state.calls.length, 0);
    assert.equal(s.state.storno?.status, "ISSUE_FAILED");
    assert.match(String(s.state.storno?.syncError), /végszámla hivatkozik/);
  });

  it("a végszámla is sztornózható, és a készlete visszajön (acrobot 28782)", async () => {
    const s = setup({ documentType: "FINAL_INVOICE" });
    await s.service.storno("doc-1", undefined, USER);
    assert.equal(s.state.calls.length, 1);
    assert.deepEqual(s.state.stock, [
      ["doc-1", "storno-1", "E-STORNO-1", "user-1"],
    ]);
  });

  it("siker: STORNO sor az eredetire hivatkozva, az eredeti ellentett összegei, PDF, készlet vissza", async () => {
    const s = setup();
    const detail = await s.service.storno("doc-1", "rossz vevő", USER);
    assert.equal(s.state.calls.length, 1);
    assert.match(s.state.calls[0]!, /<szamlaszam>E-1<\/szamlaszam>/);
    assert.deepEqual(
      [
        s.state.created?.documentType,
        s.state.created?.referencedInvoiceId,
        s.state.created?.sourceType,
      ],
      ["STORNO", "doc-1", undefined],
    );
    const sor = s.state.storno as unknown as Record<string, unknown>;
    assert.deepEqual(
      [
        sor.status,
        sor.invoiceNumber,
        String(sor.grossAmount),
        String(sor.netAmount),
      ],
      ["ISSUED", "E-STORNO-1", "-1270", "-1000"],
    );
    assert.deepEqual(s.state.puts, ["storno-1"]);
    assert.deepEqual(s.state.stock, [
      ["doc-1", "storno-1", "E-STORNO-1", "user-1"],
    ]);
    assert.deepEqual(
      [
        detail.cancellation?.source,
        detail.cancellation?.state,
        detail.cancellation?.stornoNumber,
      ],
      ["OS", "ISSUED", "E-STORNO-1"],
    );
  });

  it("elutasítva ISSUE_FAILED, és újra próbálható ugyanazzal a sorral", async () => {
    const s = setup({
      answer: () => ({
        successful: false,
        errorCode: "57",
        errorMessage: "XML hiba",
      }),
    });
    await assert.rejects(
      s.service.storno("doc-1", undefined, USER),
      BadRequestException,
    );
    assert.equal(s.state.storno?.status, "ISSUE_FAILED");
    const again = setup({
      storno: { ...s.state.storno! },
    });
    await again.service.storno("doc-1", undefined, USER);
    assert.deepEqual(
      [again.state.created, again.state.storno?.status],
      [null, "ISSUED"],
    );
  });

  it("ismeretlen kimenet: ISSUING marad, és a következő kattintás nem hív", async () => {
    const s = setup({
      answer: () => {
        throw new SzamlazzAgentHttpError(502, "");
      },
    });
    await assert.rejects(
      s.service.storno("doc-1", undefined, USER),
      ServiceUnavailableException,
    );
    assert.equal(s.state.storno?.status, "ISSUING");
    const next = setup({ storno: { ...s.state.storno! } });
    await assert.rejects(
      next.service.storno("doc-1", undefined, USER),
      ConflictException,
    );
    assert.equal(next.state.calls.length, 0);
  });

  it("két egyidejű kattintás: az egyedi index a másodikat hívás előtt megállítja", async () => {
    const s = setup({
      createThrows: new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "x",
      }),
    });
    await assert.rejects(
      s.service.storno("doc-1", undefined, USER),
      ConflictException,
    );
    assert.equal(s.state.calls.length, 0);
  });

  it("a már sztornózott számla: nincs új hívás, a készlet-visszavétel pótlódik", async () => {
    const s = setup({
      storno: {
        id: "storno-1",
        status: "ISSUED",
        invoiceNumber: "E-STORNO-1",
        issueDate: new Date("2026-10-12T08:00:00Z"),
        pdfStorageKey: "invoices/storno-1/billing-document.pdf",
        syncError: null,
      },
    });
    const detail = await s.service.storno("doc-1", undefined, USER);
    assert.equal(s.state.calls.length, 0);
    assert.deepEqual(s.state.stock, [
      ["doc-1", "storno-1", "E-STORNO-1", "user-1"],
    ]);
    assert.equal(detail.cancellation?.pdfAvailable, true);
  });
});

describe("a sztornó a részleteken", () => {
  it("folyamatban, elutasítva és kiállítva más-más alakban; sztornó nélkül null", () => {
    const base = {
      id: "s",
      invoiceNumber: "E-S",
      issueDate: new Date("2026-10-12T22:30:00Z"),
      pdfStorageKey: "k",
      syncError: "ok",
    };
    assert.equal(osCancellation({ correctionInvoices: [] } as never), null);
    assert.deepEqual(
      ["ISSUING", "ISSUE_FAILED", "ISSUED"].map((status) => {
        const c = osCancellation({
          correctionInvoices: [{ ...base, status }],
        } as never)!;
        return [c.state, c.stornoNumber, c.issueDate, c.error, c.pdfAvailable];
      }),
      [
        ["ISSUING", null, null, "ok", false],
        ["ISSUE_FAILED", null, null, "ok", false],
        // a kelte budapesti nap
        ["ISSUED", "E-S", "2026-10-13", null, true],
      ],
    );
  });
});

describe("a Számlázz.hu felületén sztornózott saját számla a részleteken", () => {
  it("a feed ikre mondja meg; az OS sztornója elsőbb; nem sztornózottnál null", async () => {
    const detail = async (storno: Storno | null, twinCancelled: boolean) => {
      const asked: string[] = [];
      const service = new BillingDocumentsService({
        find: async () =>
          ({
            ...(await setup({ storno }).service["documents"].find("doc-1")),
          }) as unknown as BillingDocumentRow,
        feedTwinCancelled: async (number: string) => {
          asked.push(number);
          return twinCancelled;
        },
      } as unknown as BillingDocumentsRepository);
      return [
        (await service.detail("doc-1")).cancellation ?? null,
        asked,
      ] as const;
    };
    const [site, asked] = await detail(null, true);
    assert.deepEqual(
      [site?.source, site?.stornoNumber, asked],
      ["SZAMLAZZ", null, ["E-1"]],
    );
    const [none] = await detail(null, false);
    assert.equal(none, null);
    const [os] = await detail(
      {
        id: "s",
        status: "ISSUED",
        invoiceNumber: "E-S",
        issueDate: new Date("2026-10-12T08:00:00Z"),
        pdfStorageKey: null,
        syncError: null,
      },
      true,
    );
    assert.equal(os?.source, "OS");
  });
});
