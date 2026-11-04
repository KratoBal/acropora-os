import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type {
  CompletionCertificatesRepository,
  PartnerOrderIssuanceSnapshot,
  PreparedPartnerOrderIssue,
} from "./completion-certificates.repository.js";
import { CompletionCertificatesService } from "./completion-certificates.service.js";

/**
 * TIG A MEGRENDELÉSBŐL (Megrendelések S2). MI PIROSÍT: ha a kiállítás nem a
 * pillanatkép (a zár alatti olvasás) alapján dönt; ha lemondott megrendelésre,
 * cím nélküli vevőre vagy a hátralévőnél többre kiállít; ha a sor nem viszi a
 * mennyiségi egységet és a megrendelés tételét; ha a TIG fejléce nem a
 * megrendelést és az ajánlatot nevezi meg; ha a választott opció kiesik.
 */
const ACTOR = {
  id: "user-1",
  email: "iroda@acropora.hu",
  displayName: "Kovács Anna",
} as AuthenticatedUser;
const D = (v: string) => new Prisma.Decimal(v);

function snapshot(
  overrides: Partial<PartnerOrderIssuanceSnapshot> = {},
): PartnerOrderIssuanceSnapshot {
  return {
    order: { id: "po-1", orderNumber: "M-2026-001", status: "OPEN" },
    quote: {
      id: "q-1",
      quoteNumber: "AJ-2026-014",
      title: "Állatkerti tengeri akvárium",
    },
    customer: {
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
    versionItems: [
      {
        id: "qi-1",
        blockPosition: 0,
        position: 0,
        name: "Üvegtisztítás",
        description: null,
        quantity: D("3"),
        unit: "m2",
        unitNetPrice: D("2000"),
        vatRatePercent: D("27"),
        isOptional: false,
      },
      {
        id: "qi-opt",
        blockPosition: 0,
        position: 1,
        name: "Választható UV",
        description: null,
        quantity: D("1"),
        unit: "db",
        unitNetPrice: D("50000"),
        vatRatePercent: D("27"),
        isOptional: true,
      },
    ],
    selectedOptionalItemIds: ["qi-opt"],
    currency: "HUF",
    certifiedLines: [],
    lastNumberOfYear: async () => "TI-2026-007",
    ...overrides,
  };
}

function serviceWith(snap: PartnerOrderIssuanceSnapshot | null) {
  const prepared: PreparedPartnerOrderIssue[] = [];
  const repository = {
    issueForPartnerOrder: async (
      _orderId: string,
      prepare: (
        s: PartnerOrderIssuanceSnapshot,
      ) => Promise<PreparedPartnerOrderIssue>,
    ) => {
      if (!snap) return null;
      const p = await prepare(snap);
      prepared.push(p);
      return { id: "cert-new", number: p.number };
    },
  } as unknown as CompletionCertificatesRepository;
  return { service: new CompletionCertificatesService(repository), prepared };
}

describe("CompletionCertificatesService.issueForPartnerOrder", () => {
  it("kérés nélkül minden tétel a teljes mennyiséggel, egységgel és tétel-hivatkozással megy", async () => {
    const { service, prepared } = serviceWith(snapshot());
    const result = await service.issueForPartnerOrder("po-1", undefined, ACTOR);
    assert.deepEqual(result, { id: "cert-new", number: "TI-2026-008" });
    const [p] = prepared;
    assert.deepEqual(
      p!.items.map((i) => [
        i.quoteItemId,
        i.quantity.toString(),
        i.quantityUnit,
        i.unitNet.toString(),
      ]),
      [
        ["qi-1", "3", "m2", "2000"],
        ["qi-opt", "1", "db", "50000"],
      ],
    );
    assert.equal(p!.issuedByName, "Kovács Anna");
    assert.equal(p!.document.contentType, "application/pdf");
    assert.ok(p!.document.content.subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.equal(p!.document.fileName, "teljesitesi-igazolas-TI-2026-008.pdf");
  });

  it("részteljesítés: csak a kért tétel, a kért mennyiséggel; a hátralévőnél több 400", async () => {
    const { service, prepared } = serviceWith(
      snapshot({
        certifiedLines: [
          {
            quoteItemId: "qi-1",
            quantity: D("2"),
            unitNet: D("2000"),
            vatRatePercent: D("27"),
          },
        ],
      }),
    );
    await service.issueForPartnerOrder(
      "po-1",
      [{ quoteItemId: "qi-1", quantity: "0,5" }],
      ACTOR,
    );
    assert.deepEqual(
      prepared[0]!.items.map((i) => [i.quoteItemId, i.quantity.toString()]),
      [["qi-1", "0.5"]],
    );
    await assert.rejects(
      () =>
        service.issueForPartnerOrder(
          "po-1",
          [{ quoteItemId: "qi-1", quantity: "1,5" }],
          ACTOR,
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("Üvegtisztítás") &&
        error.message.includes("1 van hátra"),
    );
  });

  it("lemondott megrendelésre, cím nélküli vevőre és teljesített megrendelésre nem állít ki", async () => {
    for (const [nev, snap] of [
      [
        /Lemondott megrendelésre/,
        snapshot({
          order: { id: "po-1", orderNumber: "M-1", status: "CANCELLED" },
        }),
      ],
      [
        /nincs alapértelmezett címe/,
        snapshot({
          customer: { displayName: "X", taxNumber: null, addresses: [] },
        }),
      ],
      [
        /minden tétele teljesítve/,
        snapshot({
          certifiedLines: [
            {
              quoteItemId: "qi-1",
              quantity: D("3"),
              unitNet: D("2000"),
              vatRatePercent: D("27"),
            },
            {
              quoteItemId: "qi-opt",
              quantity: D("1"),
              unitNet: D("50000"),
              vatRatePercent: D("27"),
            },
          ],
        }),
      ],
    ] as const) {
      const { service, prepared } = serviceWith(snap);
      await assert.rejects(
        () => service.issueForPartnerOrder("po-1", undefined, ACTOR),
        nev,
        String(nev),
      );
      assert.equal(prepared.length, 0, String(nev));
    }
    const { service } = serviceWith(null);
    await assert.rejects(
      () => service.issueForPartnerOrder("po-x", undefined, ACTOR),
      /A megrendelés nem található/,
    );
  });

  it("a nem választott opció nem tétel: ha kérik, idegen tételként elutasítja", async () => {
    const { service } = serviceWith(snapshot({ selectedOptionalItemIds: [] }));
    await assert.rejects(
      () =>
        service.issueForPartnerOrder(
          "po-1",
          [{ quoteItemId: "qi-opt", quantity: "1" }],
          ACTOR,
        ),
      /nem ennek a megrendelésnek/,
    );
  });

  it("más pénznemű megrendelésre nem állít ki, mert a TIG egész forintra kerekít", async () => {
    const { service, prepared } = serviceWith(snapshot({ currency: "EUR" }));
    await assert.rejects(
      () => service.issueForPartnerOrder("po-1", undefined, ACTOR),
      /forintban készül, ez a megrendelés EUR pénznemű/,
    );
    assert.equal(prepared.length, 0);
  });

  it("a tételek sorrendje a megrendelésé: blokk, majd a blokkon belüli hely", async () => {
    const { service, prepared } = serviceWith(
      snapshot({
        versionItems: [
          {
            ...snapshot().versionItems[0]!,
            id: "qi-b",
            name: "Második",
            blockPosition: 1,
            position: 0,
          },
          {
            ...snapshot().versionItems[0]!,
            id: "qi-a",
            name: "Első",
            blockPosition: 0,
            position: 3,
          },
        ],
        selectedOptionalItemIds: [],
      }),
    );
    await service.issueForPartnerOrder("po-1", undefined, ACTOR);
    assert.deepEqual(
      prepared[0]!.items.map((item) => item.description),
      ["Első", "Második"],
    );
  });
});
