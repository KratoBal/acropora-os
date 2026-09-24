import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { CompletionCertificatesService } from "./completion-certificates.service.js";

/**
 * VALÓDI ADATBÁZIS NÉLKÜL, UGYANÚGY, MINT A
 * `maintenance-orders.service.spec.ts`: a repository helyén kézzel írt
 * hamis objektum áll, ami a VÁRT sorrendet és feltételeket méri.
 */

const ACTOR: AuthenticatedUser = {
  id: "user-1",
  email: "iroda@acropora.hu",
  displayName: "Kovács Anna",
  role: "MANAGER",
  customerId: null,
} as AuthenticatedUser;

function jobRow(
  overrides: Partial<{
    kind: string;
    hasCertificate: boolean;
    hasOrder: boolean;
    itemCount: number;
    worksheetStatuses: Array<string | undefined>;
  }> = {},
) {
  const itemCount = overrides.itemCount ?? 1;
  return {
    id: "job-1",
    kind: overrides.kind ?? "MAINTENANCE",
    title: "Cápasuli akvárium felügyeleti rendszerek",
    completedAt: new Date("2026-06-30T00:00:00Z"),
    completionCertificate: overrides.hasCertificate
      ? { id: "certificate-existing" }
      : null,
    customer: {
      id: "customer-1",
      displayName: "Fővárosi Állat- és Növénykert",
      taxNumber: "15490658-2-42",
      addresses: [
        {
          line1: "Állatkerti krt. 6-12.",
          line2: null,
          postalCode: "1146",
          city: "Budapest",
        },
      ],
    },
    maintenanceOrder:
      overrides.hasOrder === false
        ? null
        : {
            id: "order-1",
            number: "MR-2026-001",
            contract: { number: "SZ2026/0000019" },
            items: Array.from({ length: itemCount }, (_, index) => ({
              description: `Tétel ${index + 1}`,
              unitNet: new Prisma.Decimal(700000),
              vatRatePercent: new Prisma.Decimal(27),
            })),
          },
    worksheets: (overrides.worksheetStatuses ?? ["SIGNED"]).map(
      (status, index) => ({
        id: `worksheet-${index + 1}`,
        number: `BIO-2026-00${index + 1}`,
        versions: status ? [{ status }] : [],
      }),
    ),
  };
}

function fakeRepository(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    serviceJobForIssuance: async () => jobRow(),
    lastNumberOfYear: async () => null,
    issue: async (input: unknown) => ({
      id: "certificate-1",
      ...(input as object),
    }),
    detail: async () => null,
    addSignedDocument: async () => ({ id: "document-1" }),
    document: async () => null,
    list: async () => [],
    ...overrides,
  };
}

function makeService(
  repositoryOverrides: Partial<Record<string, unknown>> = {},
) {
  const repository = fakeRepository(repositoryOverrides);
  const service = new CompletionCertificatesService(repository as never);
  return { service, repository };
}

describe("CompletionCertificatesService.issue", () => {
  it("csak MAINTENANCE fajtájú lapra állít ki igazolást", async () => {
    const { service } = makeService({
      serviceJobForIssuance: async () => jobRow({ kind: "REPAIR" }),
    });
    await assert.rejects(
      () => service.issue({ serviceJobId: "job-1" }, ACTOR),
      /Csak karbantartási lapra/,
    );
  });

  it("elutasítja, ha a laphoz már van igazolás", async () => {
    const { service } = makeService({
      serviceJobForIssuance: async () => jobRow({ hasCertificate: true }),
    });
    await assert.rejects(
      () => service.issue({ serviceJobId: "job-1" }, ACTOR),
      /már készült teljesítési igazolás/,
    );
  });

  it("elutasítja, ha a laphoz nem tartozik megrendelőlap", async () => {
    const { service } = makeService({
      serviceJobForIssuance: async () => jobRow({ hasOrder: false }),
    });
    await assert.rejects(
      () => service.issue({ serviceJobId: "job-1" }, ACTOR),
      /nem tartozik megrendelőlap/,
    );
  });

  /**
   * "AZ ALÁÍRT MUNKALAPOKBÓL" -- MI PIROSÍT: ha a szolgáltatás nem nézi meg
   * minden érintett munkalap ÁLLAPOTÁT kiállítás előtt. Enélkül egy olyan
   * karbantartás is igazolást kapna, amit a vevő még nem fogadott el.
   */
  it("elutasítja, ha bármelyik munkalap nincs aláírva", async () => {
    const { service } = makeService({
      serviceJobForIssuance: async () =>
        jobRow({ worksheetStatuses: ["SIGNED", "AWAITING_SIGNATURE"] }),
    });
    await assert.rejects(
      () => service.issue({ serviceJobId: "job-1" }, ACTOR),
      /Nem minden munkalap van aláírva/,
    );
  });

  it("elutasítja, ha egy munkalapnak egyáltalán nincs verziója", async () => {
    const { service } = makeService({
      serviceJobForIssuance: async () =>
        jobRow({ worksheetStatuses: [undefined] }),
    });
    await assert.rejects(
      () => service.issue({ serviceJobId: "job-1" }, ACTOR),
      /Nem minden munkalap van aláírva/,
    );
  });

  /**
   * POZITÍV KONTROLL: érvényes bemenetre valóban létrejön az igazolás, és a
   * tételek a megrendelőlap tételeiből jönnek, tételenként 1 alkalommal.
   * Enélkül a fenti öt negatív állítás akkor is zöld lenne, ha a
   * szolgáltatás semmilyen bemenetre nem hozna létre semmit.
   */
  it("érvényes bemenetre létrehozza az igazolást, tételenként 1 alkalommal", async () => {
    const captured: { issueInput?: { items: Array<{ quantity: unknown }> } } =
      {};
    const { service } = makeService({
      serviceJobForIssuance: async () => jobRow({ itemCount: 2 }),
      issue: async (input: { items: Array<{ quantity: unknown }> }) => {
        captured.issueInput = input;
        return { id: "certificate-1" };
      },
    });
    const result = await service.issue({ serviceJobId: "job-1" }, ACTOR);
    assert.equal((result as { id: string }).id, "certificate-1");
    assert.ok(captured.issueInput);
    assert.equal(captured.issueInput.items.length, 2);
    for (const item of captured.issueInput.items) {
      assert.equal((item.quantity as Prisma.Decimal).toString(), "1");
    }
  });
});

describe("CompletionCertificatesService.uploadSignedDocument", () => {
  it("csak valódi PDF-fájlt fogad el", async () => {
    const { service } = makeService({
      detail: async () => ({ id: "certificate-1" }),
    });
    const file = {
      mimetype: "application/pdf",
      buffer: Buffer.from("nem pdf"),
      originalname: "hamis.pdf",
      size: 10,
    } as Express.Multer.File;
    await assert.rejects(
      () => service.uploadSignedDocument("certificate-1", file),
      /Csak valódi PDF-fájl/,
    );
  });

  it("POZITÍV KONTROLL: valódi PDF-fájlt elfogad", async () => {
    const { service } = makeService({
      detail: async () => ({ id: "certificate-1" }),
    });
    const file = {
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 ..."),
      originalname: "alairt.pdf",
      size: 10,
    } as Express.Multer.File;
    const result = await service.uploadSignedDocument("certificate-1", file);
    assert.equal((result as { id: string }).id, "document-1");
  });
});
