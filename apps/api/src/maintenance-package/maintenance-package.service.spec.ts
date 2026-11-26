import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";

import { MaintenancePackageService } from "./maintenance-package.service.js";
import type { MaintenancePackageRepository } from "./maintenance-package.repository.js";
import type { MaintenanceInvoiceDraftService } from "../maintenance-invoice/maintenance-invoice-draft.service.js";

const LEZARVA = new Date("2026-09-24T12:00:00Z");

function worksheet(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    number: "ML-2026-001",
    hiddenAt: null,
    versions: [{ id: "v1", closedAt: LEZARVA }],
    documents: [
      {
        id: "doc-1",
        worksheetVersionId: "v1",
        type: "GENERATED_SHEET",
        fileName: "munkalap.pdf",
        contentType: "application/pdf",
        content: Buffer.from("%PDF-1.4\nworksheet"),
        storageKey: null,
      },
    ],
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-a",
    jobNumber: "KL-2026-00001",
    customerId: "customer-a",
    worksheets: [worksheet()],
    // a hozzárendelt (kapcsolódó) munkalapok: a tároló mindig megadja, alapból nincs
    linkedWorksheets: [],
    maintenanceOrder: {
      id: "order-1",
      number: "MR-2026-001",
      documents: [
        {
          fileName: "megrendelolap-alairt.pdf",
          contentType: "application/pdf",
          content: Buffer.from("%PDF-1.4\norder"),
        },
      ],
    },
    completionCertificate: {
      id: "cert-1",
      number: "ALT-2026-001",
      documents: [
        {
          type: "SIGNED_FORM",
          fileName: "igazolas-alairt.pdf",
          contentType: "application/pdf",
          content: Buffer.from("%PDF-1.4\ncertificate"),
        },
      ],
      invoices: [],
    },
    ...overrides,
  } as never;
}

function serviceWith(
  data: unknown,
  invoiceOverrides: Partial<Record<string, unknown>> = {},
) {
  const repository = {
    packageData: async (_id: string) => data,
  } as unknown as MaintenancePackageRepository;
  const invoices = {
    pdfFor: async (_invoiceId: string) => Buffer.from("%PDF-1.4\ninvoice"),
    isCancelled: async () => false,
    ...invoiceOverrides,
  } as unknown as MaintenanceInvoiceDraftService;
  return new MaintenancePackageService(repository, invoices);
}

describe("a karbantartási lap dokumentumcsomagja", () => {
  it("nem létező vagy nem MAINTENANCE lapra 404-et ad", async () => {
    const service = serviceWith(null);
    await assert.rejects(
      () => service.assemble("job-a", "download"),
      (error: unknown) => error instanceof NotFoundException,
    );
  });

  it("rendben lévő állapotban mindhárom dokumentum a csomagba kerül", async () => {
    const csomag = await serviceWith(job()).assemble("job-a", "download");
    assert.ok(csomag.bytes.includes(Buffer.from("megrendelolap-alairt.pdf")));
    assert.ok(csomag.bytes.includes(Buffer.from("munkalap.pdf")));
    assert.ok(csomag.bytes.includes(Buffer.from("igazolas-alairt.pdf")));
  });

  /*
    LUCA DÖNTÉSE (2026-11-18 14:43 UTC; acrobot 55966): a LETÖLTÉS igazolás nélkül is megy, a csomagba az igazolás bekerül, ha van: az aláírt PDF, ennek hiányában a kiállított
    (aláíratlan). A KIKÜLDÉS kapuja marad. MI PIROSÍT: ha az igazolás nélküli letöltés elutasít; ha a csomagba nem kerül be a kiállított igazolás aláírt hiányában; ha az aláírt mellett a
    kiállított is bekerül (az aláírt a csomag igazolása); ha a kiküldés már nem kéri az igazolást vagy az aláírt példányát.
  */
  /*
    A STAGE-VÉGIGJÁRÁS TALÁLTA (2026-11-18, KT-2026-004; mind a négy stage-lap "megrendelőlap és szerződés nélkül" jött létre): a csomag minden lapnál kérte a megrendelőlapot, és a
    nélküle született lapra 503-at adott a "holott a karbantartási lap ebből jött létre" mondattal, ami hamis. MI PIROSÍT: ha a megrendelőlap nélküli lap letöltése hibával áll meg; ha
    a csomagba üres megrendelőlap-elem kerül; ha egy VAN megrendelőlap, de a PDF-je hiányzik, és ez már nem áll meg hangosan.
  */
  it("megrendelőlap nélkül született lapnál a csomag megrendelőlap-elem nélkül áll össze", async () => {
    const csomag = await serviceWith(job({ maintenanceOrder: null })).assemble(
      "job-a",
      "download",
    );
    assert.ok(csomag.bytes.includes(Buffer.from("munkalap.pdf")));
    assert.ok(!csomag.bytes.includes(Buffer.from("megrendelolap")));
  });

  it("ha VAN megrendelőlap, de a PDF-je hiányzik, a csomag hangosan megáll", async () => {
    await assert.rejects(
      () =>
        serviceWith(
          job({
            maintenanceOrder: { id: "order-1", number: "MR-1", documents: [] },
          }),
        ).assemble("job-a", "download"),
      /megrendelőlap aláírt PDF-je nem érhető el/,
    );
  });

  it("a lezáratlan számtalan munkalapot a tárgya nevezi meg a letöltés hibájában", async () => {
    await assert.rejects(
      () =>
        serviceWith(
          job({
            worksheets: [
              worksheet({
                number: null,
                versions: [
                  { id: "v1", closedAt: null, subject: "Cápasuli kis medence" },
                ],
                documents: [],
              }),
            ],
          }),
        ).assemble("job-a", "download"),
      /„Cápasuli kis medence” \(piszkozat\)/,
    );
  });

  it("teljesítési igazolás nélkül a LETÖLTÉS átmegy, a csomagban nincs igazolás", async () => {
    const csomag = await serviceWith(
      job({ completionCertificate: null }),
    ).assemble("job-a", "download");
    assert.ok(csomag.bytes.includes(Buffer.from("munkalap.pdf")));
    assert.ok(!csomag.bytes.includes(Buffer.from("teljesitesi-igazolas")));
    assert.ok(!csomag.bytes.includes(Buffer.from("igazolas-alairt.pdf")));
  });

  it("alá nem írt (csak kiállított) igazolásnál a LETÖLTÉS a kiállított PDF-et teszi a csomagba", async () => {
    const csomag = await serviceWith(
      job({
        completionCertificate: {
          id: "cert-1",
          number: "ALT-2026-001",
          documents: [
            {
              type: "GENERATED_FORM",
              fileName: "teljesitesi-igazolas-ALT-2026-001.pdf",
              contentType: "application/pdf",
              content: Buffer.from("%PDF-1.4\ngenerated-certificate"),
            },
          ],
          invoices: [],
        },
      }),
    ).assemble("job-a", "download");
    assert.ok(
      csomag.bytes.includes(
        Buffer.from("teljesitesi-igazolas-ALT-2026-001.pdf"),
      ),
    );
    assert.ok(csomag.bytes.includes(Buffer.from("generated-certificate")));
  });

  it("aláírt és kiállított igazolásnál az ALÁÍRT kerül a csomagba, a kiállított nem", async () => {
    const csomag = await serviceWith(
      job({
        completionCertificate: {
          id: "cert-1",
          number: "ALT-2026-001",
          documents: [
            {
              type: "SIGNED_FORM",
              fileName: "igazolas-alairt.pdf",
              contentType: "application/pdf",
              content: Buffer.from("%PDF-1.4\nsigned-certificate"),
            },
            {
              type: "GENERATED_FORM",
              fileName: "teljesitesi-igazolas-ALT-2026-001.pdf",
              contentType: "application/pdf",
              content: Buffer.from("%PDF-1.4\ngenerated-certificate"),
            },
          ],
          invoices: [],
        },
      }),
    ).assemble("job-a", "download");
    assert.ok(csomag.bytes.includes(Buffer.from("signed-certificate")));
    assert.ok(!csomag.bytes.includes(Buffer.from("generated-certificate")));
  });

  it("a KIKÜLDÉS kapuja marad: igazolás nélkül és alá nem írt igazolással is elutasít, névvel", async () => {
    await assert.rejects(
      () =>
        serviceWith(job({ completionCertificate: null })).assemble(
          "job-a",
          "send",
        ),
      (hiba: unknown) => {
        assert.match(
          (hiba as { message: string }).message,
          /Nincs kiállítva teljesítési igazolás/,
        );
        return hiba instanceof BadRequestException;
      },
    );
    await assert.rejects(
      () =>
        serviceWith(
          job({
            completionCertificate: {
              id: "cert-1",
              number: "ALT-2026-001",
              documents: [
                {
                  type: "GENERATED_FORM",
                  fileName: "teljesitesi-igazolas-ALT-2026-001.pdf",
                  contentType: "application/pdf",
                  content: Buffer.from("%PDF-1.4\ngenerated-certificate"),
                },
              ],
              invoices: [],
            },
          }),
        ).assemble("job-a", "send"),
      (hiba: unknown) => {
        assert.match(
          (hiba as { message: string }).message,
          /aláírt példánya hiányzik/,
        );
        return hiba instanceof BadRequestException;
      },
    );
  });

  /**
   * KALIBRÁCIÓ: ez az állítás pont azt méri, hogy a `purpose` ténylegesen
   * eljut a kapuig -- ha a szolgáltatás figyelmen kívül hagyná, a "download"
   * cél is elutasítana ugyanígy, és ez az állítás a másikéval azonos lenne.
   */
  it("mindent rendben találva a LETÖLTÉS átmegy, a KIKÜLDÉS számla nélkül elutasít", async () => {
    const adat = job();
    await serviceWith(adat).assemble("job-a", "download");
    await assert.rejects(
      () => serviceWith(adat).assemble("job-a", "send"),
      (hiba: unknown) => {
        assert.match(
          (hiba as { message: string }).message,
          /Nincs kiállítva számla/,
        );
        return hiba instanceof BadRequestException;
      },
    );
  });

  it("egy ISSUED számlával a KIKÜLDÉS 'nincs kiállítva számla' hiba nélkül átmegy, ÉS a számla PDF-je bekerül a csomagba", async () => {
    const adat = job({
      completionCertificate: {
        id: "cert-1",
        number: "ALT-2026-001",
        documents: [
          {
            type: "SIGNED_FORM",
            fileName: "igazolas-alairt.pdf",
            contentType: "application/pdf",
            content: Buffer.from("%PDF-1.4\ncertificate"),
          },
        ],
        invoices: [{ id: "invoice-1", invoiceNumber: "SZ2026-00042" }],
      },
    });
    let requestedInvoiceId: string | undefined;
    const packageFile = await serviceWith(adat, {
      pdfFor: async (invoiceId: string) => {
        requestedInvoiceId = invoiceId;
        return Buffer.from("%PDF-1.4\ninvoice-bytes");
      },
    }).assemble("job-a", "send");
    assert.equal(requestedInvoiceId, "invoice-1");
    assert.ok(
      packageFile.bytes.includes(Buffer.from("szamla-SZ2026-00042.pdf")),
    );
    assert.ok(packageFile.bytes.includes(Buffer.from("invoice-bytes")));
  });

  // barracuda a #2935-ön: a szerver kapuja ugyanazt a sztornó-jelet kérdezi, mint a panel (kártya 2cd1ed80)
  it("sztornózott ISSUED számlával a KIKÜLDÉS elutasít, a LETÖLTÉS nem kérdezi a sztornót", async () => {
    const adat = job({
      completionCertificate: {
        id: "cert-1",
        number: "ALT-2026-001",
        documents: [
          {
            type: "SIGNED_FORM",
            fileName: "igazolas-alairt.pdf",
            contentType: "application/pdf",
            content: Buffer.from("%PDF-1.4\ncertificate"),
          },
        ],
        invoices: [{ id: "invoice-1", invoiceNumber: "SZ2026-00042" }],
      },
    });
    const asked: unknown[] = [];
    const service = serviceWith(adat, {
      isCancelled: async (invoice: unknown) => {
        asked.push(invoice);
        return true;
      },
    });
    await assert.rejects(
      () => service.assemble("job-a", "send"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /sztornózták/.test(error.message),
    );
    assert.deepEqual(asked, [
      { id: "invoice-1", invoiceNumber: "SZ2026-00042" },
    ]);
    asked.length = 0;
    await service.assemble("job-a", "download");
    assert.deepEqual(asked, []);
  });

  it("lezáratlan munkalap megállítja a letöltést is, névvel", async () => {
    const service = serviceWith(
      job({
        worksheets: [
          worksheet({
            versions: [{ id: "v1", closedAt: null }],
            documents: [],
          }),
        ],
      }),
    );
    await assert.rejects(
      () => service.assemble("job-a", "download"),
      /Nincs lezárva: ML-2026-001/,
    );
  });

  it("rejtett munkalap kimarad a csomagból, de nem tartja vissza", async () => {
    const csomag = await serviceWith(
      job({ worksheets: [worksheet({ hiddenAt: new Date() })] }),
    ).assemble("job-a", "download");
    assert.ok(!csomag.bytes.includes(Buffer.from("munkalap.pdf")));
    assert.ok(csomag.bytes.includes(Buffer.from("megrendelolap-alairt.pdf")));
  });

  /*
    A HOZZÁRENDELT (KAPCSOLÓDÓ) MUNKALAPOK A CSOMAGBAN (Luca, 2026-11-25, kártya 5afb868a: "azokat nem rakja be hozzá, amiket
    hozzárendelek"). MI PIROSÍT: ha a hozzárendelt lap PDF-je nem kerül a csomagba; ha nem `kapcsolodo-` előtaggal kerül be (a
    lapon létrehozottal egy névtérben ütközne); ha a lezáratlan hozzárendelt lap nem tartja vissza a letöltést, vagy a SAJÁT
    lapra szóló mondattal ("vedd le a karbantartási lapról") tartja vissza; ha a kiadott példány nélküli hozzárendelt lap átmegy.
  */
  const linked = (overrides: Record<string, unknown> = {}) => ({
    worksheet: worksheet({
      id: "ws-linked",
      number: "ML-2026-050",
      documents: [
        {
          id: "doc-linked",
          worksheetVersionId: "v1",
          type: "GENERATED_SHEET",
          fileName: "munkalap-hozzarendelt.pdf",
          contentType: "application/pdf",
          content: Buffer.from("%PDF-1.4\nlinked-worksheet"),
          storageKey: null,
        },
      ],
      ...overrides,
    }),
  });

  it("a hozzárendelt munkalap kiadott PDF-je kapcsolodo- előtaggal a csomagba kerül, a sajátok előtag nélkül", async () => {
    const csomag = await serviceWith(
      job({ linkedWorksheets: [linked()] }),
    ).assemble("job-a", "download");
    assert.ok(
      csomag.bytes.includes(
        Buffer.from("kapcsolodo-munkalap-hozzarendelt.pdf"),
      ),
    );
    assert.ok(csomag.bytes.includes(Buffer.from("linked-worksheet")));
    // a lapon létrehozott lap nem kapott előtagot, és nem tűnt el
    assert.ok(csomag.bytes.includes(Buffer.from("munkalap.pdf")));
    assert.ok(!csomag.bytes.includes(Buffer.from("kapcsolodo-munkalap.pdf")));
  });

  it("a kiküldés csomagjába is bekerül a hozzárendelt lap", async () => {
    const csomag = await serviceWith(
      job({
        linkedWorksheets: [linked()],
        completionCertificate: {
          id: "cert-1",
          number: "ALT-2026-001",
          documents: [
            {
              type: "SIGNED_FORM",
              fileName: "igazolas-alairt.pdf",
              contentType: "application/pdf",
              content: Buffer.from("%PDF-1.4\ncertificate"),
            },
          ],
          invoices: [{ id: "inv-1", invoiceNumber: "SZ2026-00042" }],
        },
      }),
    ).assemble("job-a", "send");
    assert.ok(
      csomag.bytes.includes(
        Buffer.from("kapcsolodo-munkalap-hozzarendelt.pdf"),
      ),
    );
  });

  it("a lezáratlan hozzárendelt lap visszatartja a letöltést, a hozzárendelt lapra szóló mondattal és névvel", async () => {
    await assert.rejects(
      () =>
        serviceWith(
          job({
            linkedWorksheets: [
              linked({
                versions: [{ id: "v1", closedAt: null }],
                documents: [],
              }),
            ],
          }),
        ).assemble("job-a", "download"),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(
          error.message,
          /A hozzárendelt munkalap nincs lezárva: ML-2026-050\. Zárd le, vagy vedd le a kapcsolatot/,
        );
        // nem a saját lapra szóló "vedd le a karbantartási lapról" mondat
        assert.doesNotMatch(error.message, /Nincs lezárva: ML-2026-050/);
        return true;
      },
    );
  });

  it("a lezárt, de kiadott példány nélküli hozzárendelt lap is visszatartja, és ezt kimondja", async () => {
    await assert.rejects(
      () =>
        serviceWith(
          job({ linkedWorksheets: [linked({ documents: [] })] }),
        ).assemble("job-a", "download"),
      /A hozzárendelt munkalap le van zárva, de a kiadott példánya hiányzik: ML-2026-050/,
    );
  });

  it("a rejtett hozzárendelt lap kimarad a csomagból, de nem tartja vissza", async () => {
    const csomag = await serviceWith(
      job({ linkedWorksheets: [linked({ hiddenAt: new Date() })] }),
    ).assemble("job-a", "download");
    assert.ok(!csomag.bytes.includes(Buffer.from("munkalap-hozzarendelt.pdf")));
    assert.ok(csomag.bytes.includes(Buffer.from("munkalap.pdf")));
  });

  it("hozzárendelt lap nélkül a csomag változatlan", async () => {
    const csomag = await serviceWith(job()).assemble("job-a", "download");
    assert.ok(!csomag.bytes.includes(Buffer.from("kapcsolodo-")));
  });
});
