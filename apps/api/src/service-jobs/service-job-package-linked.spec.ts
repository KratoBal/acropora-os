import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import {
  serviceJobSheetSections,
  visibleLinkedWorksheets,
} from "./service-job-sheet-content.js";
import { ServiceJobPackageService } from "./service-job-package.service.js";
import type { ServiceJobPackageRepository } from "./service-job-package.repository.js";

/*
  WHAT TURNS THIS RED (card 5b366f5d, part B): the package of a maintenance sheet not carrying the linked worksheets' issued PDFs
  (or carrying a draft-marked one when the final exists); a linked worksheet that is not closed, or has no issued sheet, not holding
  the package back (and with the repair-ticket sentence instead of the link one); a linked worksheet appearing on a repair
  ticket's package; the partner's unit rule not reaching the query, or a hidden linked worksheet reaching a partner; the job PDF
  section missing, listing hours or a price, or appearing on a sheet that takes no links.
*/
const LEZARVA = new Date("2026-09-16T12:00:00Z");

const INTERNAL = {
  id: "internal-user",
  email: "internal@acropora.hu",
  displayName: "Belső Ember",
  role: "SERVICE",
  customerId: null,
  supplierId: null,
} as AuthenticatedUser;

const PARTNER = {
  id: "partner-user",
  email: "partner@example.test",
  displayName: "Partner",
  role: "PARTNER_SERVICE",
  customerId: "customer-a",
  supplierId: null,
} as AuthenticatedUser;

const sheet = (
  id: string,
  fileName: string,
  type: "GENERATED_SHEET" | "SIGNED_SHEET" = "GENERATED_SHEET",
) => ({
  id: `${id}-${type}`,
  worksheetVersionId: `${id}-v1`,
  type,
  fileName,
  contentType: "application/pdf",
  content: Buffer.from("%PDF-1.4\nworksheet"),
  storageKey: null,
});

function worksheet(
  id: string,
  over: {
    number?: string | null;
    closed?: boolean;
    hiddenAt?: Date | null;
    documents?: ReturnType<typeof sheet>[];
  } = {},
) {
  return {
    id,
    number: "number" in over ? over.number : id.toUpperCase(),
    hiddenAt: over.hiddenAt ?? null,
    createdAt: new Date("2026-11-10T10:00:00Z"),
    versions: [
      {
        id: `${id}-v1`,
        closedAt: over.closed === false ? null : LEZARVA,
        subject: `${id} tárgya`,
      },
    ],
    documents: over.documents ?? [sheet(id, `munkalap-${id}.pdf`)],
  };
}

function job(over: Record<string, unknown> = {}) {
  return {
    id: "job-a",
    jobNumber: "KAR-2026-001",
    kind: "MAINTENANCE",
    title: "Novemberi karbantartás",
    description: null,
    status: "COMPLETED",
    createdAt: new Date("2026-11-01T08:00:00Z"),
    customer: { displayName: "AquaForma Kft." },
    departmentPath: ["Állatkert"],
    events: [
      {
        id: "close",
        createdAt: new Date("2026-11-18T12:00:00Z"),
        toStatus: "COMPLETED",
        note: null,
      },
    ],
    assets: [],
    assignees: [],
    worksheets: [],
    linkedWorksheets: [],
    ...over,
  };
}

function serviceWith(data: unknown, unitIds: string[] = []) {
  const seen: { scope?: unknown } = {};
  const repository = {
    assignedUnitIds: async () => unitIds,
    packageData: async (_id: string, _v: unknown, scope: unknown) => {
      seen.scope = scope;
      return data;
    },
  } as unknown as ServiceJobPackageRepository;
  return { service: new ServiceJobPackageService(repository), seen };
}

const has = (bytes: Buffer, text: string) => bytes.includes(Buffer.from(text));

describe("a karbantartási lap csomagja a hozzákapcsolt munkalapokkal", () => {
  it("a hozzákapcsolt munkalap kiadott PDF-je benne van, kapcsolodo- előtaggal, a saját munkalap mellett", async () => {
    const { service } = serviceWith(
      job({
        worksheets: [worksheet("own")],
        linkedWorksheets: [{ worksheet: worksheet("feri") }],
      }),
    );
    const file = await service.download("job-a", INTERNAL);
    assert.ok(has(file.bytes, "munkalap-own.pdf"));
    assert.ok(has(file.bytes, "kapcsolodo-munkalap-feri.pdf"));
  });

  it("a hozzákapcsolt munkalapnál is a VÉGLEGES lap megy, nem a lezáráskori", async () => {
    const { service } = serviceWith(
      job({
        linkedWorksheets: [
          {
            worksheet: worksheet("feri", {
              documents: [
                sheet("feri", "lezaraskori.pdf", "GENERATED_SHEET"),
                sheet("feri", "vegleges.pdf", "SIGNED_SHEET"),
              ],
            }),
          },
        ],
      }),
    );
    const file = await service.download("job-a", INTERNAL);
    assert.ok(has(file.bytes, "kapcsolodo-vegleges.pdf"));
    assert.ok(!has(file.bytes, "lezaraskori.pdf"));
  });

  it("a hibajegy csomagjába hozzákapcsolt munkalap nem kerül (a hibajegy nem fogad hivatkozást)", async () => {
    const { service } = serviceWith(
      job({
        kind: "REPAIR",
        linkedWorksheets: [{ worksheet: worksheet("feri") }],
      }),
    );
    const file = await service.download("job-a", INTERNAL);
    assert.ok(!has(file.bytes, "munkalap-feri.pdf"));
  });

  it("a lezáratlan hozzákapcsolt munkalap visszatartja a csomagot, a saját mondatával és a számával", async () => {
    const { service } = serviceWith(
      job({
        linkedWorksheets: [
          { worksheet: worksheet("feri", { closed: false, number: "KAR-22" }) },
        ],
      }),
    );
    await assert.rejects(
      () => service.download("job-a", INTERNAL),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const message = error.message;
        assert.match(message, /karbantartási lap dokumentumcsomagja/);
        assert.match(message, /Nincs lezárva: KAR-22/);
        assert.match(message, /vedd le a kapcsolatot/);
        assert.doesNotMatch(message, /vedd le a hibajegyről/);
        return true;
      },
    );
  });

  it("a lezárt, de kiadott példány nélküli hozzákapcsolt munkalap is visszatart", async () => {
    const { service } = serviceWith(
      job({
        linkedWorksheets: [
          { worksheet: worksheet("feri", { documents: [], number: "KAR-22" }) },
        ],
      }),
    );
    await assert.rejects(
      () => service.download("job-a", INTERNAL),
      /kiadott munkalap hiányzik: KAR-22/,
    );
  });

  it("a rejtett hozzákapcsolt munkalap a partner csomagjában nincs és nem is tart vissza, a belsőben benne van", async () => {
    const hidden = worksheet("feri", {
      hiddenAt: new Date("2026-11-17T10:00:00Z"),
    });
    const { service } = serviceWith(
      job({ linkedWorksheets: [{ worksheet: hidden }] }),
    );
    const partner = await service.download("job-a", PARTNER);
    assert.ok(!has(partner.bytes, "munkalap-feri.pdf"));
    const internal = await service.download("job-a", INTERNAL);
    assert.ok(has(internal.bytes, "kapcsolodo-munkalap-feri.pdf"));
  });

  it("a partner egység-szabálya a lekérdezésig ér, a belsősre nem szűkít", async () => {
    const partner = serviceWith(job(), ["unit-1"]);
    await partner.service.download("job-a", PARTNER);
    assert.deepEqual(partner.seen.scope, { departmentId: { in: ["unit-1"] } });

    const internal = serviceWith(job());
    await internal.service.download("job-a", INTERNAL);
    assert.deepEqual(internal.seen.scope, {});
  });
});

describe("a karbantartási lap PDF-jének hozzákapcsolt munkalap szakasza", () => {
  const base = {
    jobNumber: "KAR-2026-001",
    status: "COMPLETED" as const,
    customerName: "AquaForma Kft.",
    departmentPath: ["Állatkert"],
    title: "Novemberi karbantartás",
    description: null,
    openedAt: new Date("2026-11-01T08:00:00Z"),
    closedAt: new Date("2026-11-18T12:00:00Z"),
    assets: [],
    assignees: [],
    log: [],
  };
  const sectionOf = (
    linkedWorksheets?: Parameters<
      typeof serviceJobSheetSections
    >[0]["linkedWorksheets"],
  ) =>
    serviceJobSheetSections({ ...base, linkedWorksheets }).find((section) =>
      section.title.startsWith("Kapcsolódó munkalapok"),
    );

  it("felsorolja a számot, a tárgyat és a napot, és kimondja, hogy munkaóra és ár nélkül", () => {
    const section = sectionOf([
      {
        number: "KAR-2026-022",
        subject: "Lámpák átszerelése",
        createdAt: new Date("2026-11-10T10:00:00Z"),
      },
    ]);
    assert.equal(
      section?.title,
      "Kapcsolódó munkalapok (munkaóra és ár nélkül)",
    );
    assert.equal(section?.lines.length, 1);
    assert.match(
      section!.lines[0]!,
      /KAR-2026-022 · Lámpák átszerelése · 2026\. november 10\./,
    );
    assert.doesNotMatch(
      section!.lines.join(" "),
      /óra|Ft|(?<![\p{L}])ár(?![\p{L}])/iu,
    );
  });

  it("üres halmaznál kimondja, hogy nincs, szám nélküli lapot is megnevez", () => {
    assert.deepEqual(sectionOf([])?.lines, ["Nincs kapcsolódó munkalap."]);
    const draft = sectionOf([
      {
        number: null,
        subject: "",
        createdAt: new Date("2026-11-10T10:00:00Z"),
      },
    ]);
    assert.match(draft!.lines[0]!, /^számozatlan munkalap · /);
  });

  it("a hibajegy PDF-jében nincs ilyen szakasz (nincs üres blokk)", () => {
    assert.equal(sectionOf(undefined), undefined);
  });
});

describe("a hozzákapcsolt munkalapok láthatósága a lap listáján", () => {
  const rows: { worksheet: { id: string; hiddenAt: Date | null } }[] = [
    { worksheet: { id: "visible", hiddenAt: null } },
    { worksheet: { id: "hidden", hiddenAt: new Date("2026-11-17T10:00:00Z") } },
  ];

  it("a partner a rejtettet nem látja a PDF listáján", () => {
    assert.deepEqual(
      visibleLinkedWorksheets(rows, false).map((r) => r.worksheet.id),
      ["visible"],
    );
  });

  it("a belsős mindkettőt látja", () => {
    assert.deepEqual(
      visibleLinkedWorksheets(rows, true).map((r) => r.worksheet.id),
      ["visible", "hidden"],
    );
  });
});
