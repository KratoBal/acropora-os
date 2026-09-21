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

/*
  LEZARVA: a meglevo allitasok lapjai MIND zartak, es ez nem kenyelem.
  Mindegyiknek van KIADOTT PELDANYA, ami a lezarasi tranzakcioban keletkezik --
  egy nyitott verzio mellett tehat olyan allapotot allitanank elo, ami a
  valosagban nem all elo. A csomag-kapu allitasai a sajat lapjaikat maguk
  allitjak be.
*/
const LEZARVA = new Date("2026-09-16T12:00:00Z");

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
          number: "visible".toUpperCase(),
          hiddenAt: null,
          versions: [{ id: "visible-version", closedAt: LEZARVA }],
          documents: [generated("visible", "munkalap-látható.pdf")],
        },
        {
          id: "hidden",
          number: "hidden".toUpperCase(),
          hiddenAt: new Date("2026-09-16T13:00:00Z"),
          versions: [{ id: "hidden-version", closedAt: LEZARVA }],
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
            versions: [{ id: "v1", closedAt: LEZARVA }],
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

/**
 * A SZABALYT a `common/worksheet-signature-gate.spec.ts` meri; EZEK a
 * BEKOTEST. A ketto kulon romolhat el, es a szakadas NEMA: a tiszta fuggveny
 * zolden all, kozben a csomag ugyanugy szo nelkul kihagyja a lapot.
 */
describe("a csomag nem adhato at lezaratlan lappal", () => {
  const lap = (reszek: Record<string, unknown>) => ({
    id: "ws",
    number: "BIO-2026-100",
    hiddenAt: null,
    versions: [{ id: "v", closedAt: LEZARVA }],
    documents: [
      {
        id: "doc",
        worksheetVersionId: "v",
        type: "GENERATED_SHEET",
        fileName: "munkalap.pdf",
        contentType: "application/pdf",
        content: Buffer.from("%PDF-1.4\nsheet"),
        storageKey: null,
      },
    ],
    ...reszek,
  });

  it("a lezaratlan lap megallitja a csomagot, es MEGNEVEZI", async () => {
    const service = serviceWith(
      job({
        worksheets: [
          lap({ versions: [{ id: "v", closedAt: null }], documents: [] }),
        ],
      }),
    );

    await assert.rejects(
      () => service.download("job-a", INTERNAL),
      (hiba: unknown) => {
        const uzenet = (hiba as { message: string }).message;
        assert.match(uzenet, /Nincs lezárva: BIO-2026-100/);
        return true;
      },
    );
  });

  /**
   * A MASIK OK MAS MONDATOT KAP, mert a TEENDO mas. Egy lezart lapot nem lehet
   * "lezarni" -- ha a mondat oda kuldene, a kezelo olyat probalna, ami nem
   * letezik.
   */
  it("a LEZART, de peldany nelkuli lap NEM lezarasra kuld", async () => {
    const service = serviceWith(job({ worksheets: [lap({ documents: [] })] }));

    await assert.rejects(
      () => service.download("job-a", INTERNAL),
      (hiba: unknown) => {
        const uzenet = (hiba as { message: string }).message;
        assert.match(uzenet, /kiadott munkalap hiányzik: BIO-2026-100/);
        assert.doesNotMatch(uzenet, /Nincs lezárva/);
        assert.doesNotMatch(uzenet, /Zárd le a lapot/);
        return true;
      },
    );
  });

  /**
   * A HATOKOR-DONTES BEKOTVE: a partner csomagjaba a rejtett lap amugy sem
   * kerul bele, tehat nem is tarthatja vissza. A belso hivot igen.
   */
  it("a rejtett lezaratlan lap a partnernek ATENGEDI a csomagot, a belsosnek nem", async () => {
    const data = job({
      worksheets: [
        lap({
          id: "rejtett",
          hiddenAt: new Date("2026-09-16T13:00:00Z"),
          versions: [{ id: "v", closedAt: null }],
          documents: [],
        }),
      ],
    });

    const csomag = await serviceWith(data).download("job-a", PARTNER_A);
    assert.ok(csomag.bytes.length > 0);

    await assert.rejects(
      () => serviceWith(data).download("job-a", INTERNAL),
      /Nincs lezárva/,
    );
  });

  /**
   * ISMERT POZITIV KONTROLL A BEKOTESRE. Enelkul a fenti harom allitas akkor
   * is zold lenne, ha a kapu MINDIG dobna -- es a csomag sosem allna elo.
   */
  it("rendben levo lappal a csomag tovabbra is elkeszul", async () => {
    const csomag = await serviceWith(job({ worksheets: [lap({})] })).download(
      "job-a",
      INTERNAL,
    );
    assert.ok(csomag.bytes.includes(Buffer.from("munkalap.pdf")));
  });
});
