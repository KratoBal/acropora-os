import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { ServiceJobPackageService } from "./service-job-package.service.js";
import type { ServiceJobPackageRepository } from "./service-job-package.repository.js";

const INTERNAL = {
  id: "internal-user",
  email: "internal@acropora.hu",
  displayName: "Belső Ember",
  role: "SERVICE",
  customerId: null,
  supplierId: null,
} as AuthenticatedUser;

const PARTNER_A = {
  id: "partner-a-user",
  email: "partner-a@example.test",
  displayName: "Partner A",
  role: "PARTNER_SERVICE",
  customerId: "customer-a",
  supplierId: null,
} as AuthenticatedUser;

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-a",
    jobNumber: "SRV-2026-00482",
    title: "Hűtőkör nyomásvesztése",
    description: "A nyomás a normál érték alá esett.",
    status: "COMPLETED",
    createdAt: new Date("2026-09-14T08:42:00Z"),
    customer: { displayName: "AquaForma Kft." },
    departmentPath: ["Kossuth Lajos utca 18."],
    events: [
      {
        id: "close-event",
        createdAt: new Date("2026-09-16T12:18:00Z"),
        toStatus: "COMPLETED",
        note: null,
      },
    ],
    assets: [],
    assignees: [],
    worksheets: [],
    ...overrides,
  } as never;
}

function serviceWith(
  data: unknown,
  onVisibility?: (visibility: unknown) => void,
) {
  const repository = {
    assignedUnitIds: async () => [],
    packageData: async (_id: string, visibility: unknown) => {
      onVisibility?.(visibility);
      return data;
    },
  } as unknown as ServiceJobPackageRepository;
  return new ServiceJobPackageService(repository);
}

describe("elkészült hibajegy dokumentumcsomagja", () => {
  it("a partner másik partner hibajegyét elutasítja, nem üres csomagot ad", async () => {
    let visibility: unknown;
    const service = serviceWith(null, (value) => {
      visibility = value;
    });
    await assert.rejects(
      () => service.download("job-of-customer-b", PARTNER_A),
      (error: unknown) => error instanceof NotFoundException,
    );
    assert.deepEqual(visibility, {
      AND: [{ customerId: "customer-a" }, { openedById: "partner-a-user" }],
    });
  });

  it("a rejtett munkalap nincs a partner csomagjában, belső csomagban viszont benne van", async () => {
    /*
      A `type` 2026-09-21 ota KELL IDE, es a hianya NEM forditasi hiba volt: a
      `serviceWith` a bemenetet `unknown`-kent veszi at, tehat a varrat nem
      ellenoriz semmit. A mezo hianya igy CSENDBEN azt jelentette, hogy a
      csomag-osszeallito egyetlen lapot sem talal -- a teszt bukott, nem a
      fordito szolt.
    */
    const generated = (
      id: string,
      fileName: string,
      type: "GENERATED_SHEET" | "SIGNED_SHEET" = "GENERATED_SHEET",
    ) => ({
      id: `${id}-${type}`,
      worksheetVersionId: `${id}-version`,
      type,
      fileName,
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.4\nworksheet"),
      storageKey: null,
    });
    const data = job({
      worksheets: [
        {
          id: "visible",
          hiddenAt: null,
          versions: [{ id: "visible-version" }],
          documents: [generated("visible", "munkalap-látható.pdf")],
        },
        {
          id: "hidden",
          hiddenAt: new Date("2026-09-16T13:00:00Z"),
          versions: [{ id: "hidden-version" }],
          documents: [generated("hidden", "munkalap-rejtett.pdf")],
        },
      ],
    });
    const service = serviceWith(data);

    const partnerPackage = await service.download("job-a", PARTNER_A);
    const internalPackage = await service.download("job-a", INTERNAL);

    assert.ok(
      partnerPackage.bytes.includes(Buffer.from("munkalap-látható.pdf")),
    );
    assert.ok(
      !partnerPackage.bytes.includes(Buffer.from("munkalap-rejtett.pdf")),
    );
    assert.ok(
      internalPackage.bytes.includes(Buffer.from("munkalap-rejtett.pdf")),
    );
  });

  /**
   * KET LAP EGY VERZIOHOZ -- A VEGLEGES MEGY A CSOMAGBA.
   *
   * 2026-09-21 ota egy verziohoz ketto tartozhat: a lezaraskori
   * (`GENERATED_SHEET`, PISZKOZAT felirattal) es az alairas utani vegleges
   * (`SIGNED_SHEET`). A csomag az, amit a vevo es a partner megkap, tehat oda a
   * vegleges valo.
   *
   * MI PIROSIT: ha a valasztas visszaesik "az elso talalat"-ra vagy idorendre.
   * Az ELSO TALALAT azert veszelyes, mert a lekerdezes sorrendjetol fugg -- egy
   * `orderBy` atirasa MASIK fajlban csendben megforditana.
   */
  it("egy verzió KÉT lapjából a VÉGLEGES megy a csomagba", async () => {
    const lap = (
      id: string,
      fileName: string,
      type: "GENERATED_SHEET" | "SIGNED_SHEET",
    ) => ({
      id,
      worksheetVersionId: "v1",
      type,
      fileName,
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.4\nworksheet"),
      storageKey: null,
    });
    const service = serviceWith(
      job({
        worksheets: [
          {
            id: "w1",
            hiddenAt: null,
            versions: [{ id: "v1" }],
            /*
              A LEZARASKORI ALL ELOL a listaban -- szandekosan. Ha a valasztas
              "az elso talalat" lenne, EZ a sorrend adna a rossz lapot, es a
              teszt ettol a sortol pirosodik.
            */
            documents: [
              lap("d1", "munkalap-lezaraskori.pdf", "GENERATED_SHEET"),
              lap("d2", "munkalap-vegleges.pdf", "SIGNED_SHEET"),
            ],
          },
        ],
      }),
    );

    const packageFile = await service.download("job-a", PARTNER_A);

    assert.ok(packageFile.bytes.includes(Buffer.from("munkalap-vegleges.pdf")));
    assert.ok(
      !packageFile.bytes.includes(Buffer.from("munkalap-lezaraskori.pdf")),
    );
  });

  it("munkalap nélküli elkészült hibajegyből is elkészül a hibajegy PDF-je", async () => {
    const packageFile = await serviceWith(job()).download("job-a", PARTNER_A);
    assert.ok(
      packageFile.bytes.includes(Buffer.from("hibajegy-SRV-2026-00482.pdf")),
    );
  });

  it("nem elkészült hibajegyhez a szerver nem ad dokumentumcsomagot", async () => {
    const service = serviceWith(
      job({ status: "IN_PROGRESS", events: [], worksheets: [] }),
    );
    await assert.rejects(
      () => service.download("job-a", PARTNER_A),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it("a meghiúsult hibajegy nem ad dokumentumcsomagot", async () => {
    const service = serviceWith(
      job({
        status: "CANCELLED",
        events: [
          {
            id: "cancel-event",
            createdAt: new Date("2026-09-16T12:18:00Z"),
            toStatus: "CANCELLED",
            note: null,
          },
        ],
        worksheets: [],
      }),
    );
    await assert.rejects(
      () => service.download("job-a", PARTNER_A),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});
