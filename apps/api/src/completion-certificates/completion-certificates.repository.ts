import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

/** a TIG vevője, a számla kapujához és címéhez (munkalapról vagy megrendelésről ugyanígy) */
const certificateCustomerArgs = {
  select: {
    id: true,
    // a vevő adószám-kapujához (`customerTaxNumberProblem`): a típus és a partner-tükör
    type: true,
    partner: { select: { id: true } },
    displayName: true,
    companyName: true,
    taxNumber: true,
    euTaxNumber: true,
    paymentDueDays: true,
    addresses: {
      where: { isDefault: true },
      take: 1,
      select: { line1: true, line2: true, postalCode: true, city: true },
    },
  },
} satisfies Prisma.CustomerDefaultArgs;

const certificateInclude = {
  serviceJob: {
    select: {
      id: true,
      title: true,
      completedAt: true,
      customerId: true,
      customer: certificateCustomerArgs,
      maintenanceOrder: {
        select: {
          id: true,
          number: true,
          contract: { select: { number: true } },
        },
      },
      worksheets: {
        select: { id: true, number: true },
        orderBy: { createdAt: "asc" as const },
        take: 1,
      },
    },
  },
  // Megrendelések S3: a megrendeléses TIG vevője a megrendelésen áll
  partnerOrder: {
    select: { orderNumber: true, customer: certificateCustomerArgs },
  },
  items: true,
  documents: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      type: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
};

export type CompletionCertificateItemInput = {
  description: string;
  quantity: Prisma.Decimal;
  unitNet: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
  /** Megrendelések S2: a mennyiségi egység és a megrendelés tétele (szervizes sornál nincs) */
  quantityUnit?: string;
  quoteItemId?: string;
};

/**
 * A MEGRENDELÉS PILLANATKÉPE A KIÁLLÍTÁSHOZ (Megrendelések S2), a megrendelés
 * sorának zárja alatt olvasva: a megrendelés, a vevő, az elfogadott ajánlat-verzió
 * tételei és elfogadása, és a megrendelés eddigi TIG-sorai.
 */
export type PartnerOrderIssuanceSnapshot = {
  order: { id: string; orderNumber: string; status: string };
  quote: { id: string; quoteNumber: string; title: string };
  customer: {
    displayName: string;
    taxNumber: string | null;
    addresses: {
      line1: string;
      line2: string | null;
      postalCode: string;
      city: string;
    }[];
  } | null;
  /** az elfogadott verzió tételei, `selectOrderItems` bemenete (murena, S1) */
  versionItems: {
    id: string;
    blockPosition: number;
    position: number;
    name: string;
    description: Prisma.JsonValue | null;
    quantity: Prisma.Decimal;
    unit: string;
    unitNetPrice: Prisma.Decimal;
    vatRatePercent: Prisma.Decimal;
    isOptional: boolean;
  }[];
  selectedOptionalItemIds: string[];
  /** a rögzített ajánlat-verzió pénzneme (a TIG forintban készül) */
  currency: string;
  certifiedLines: {
    quoteItemId: string;
    quantity: Prisma.Decimal;
    unitNet: Prisma.Decimal;
    vatRatePercent: Prisma.Decimal;
  }[];
  lastNumberOfYear: (prefix: string) => Promise<string | null>;
};

export type PreparedPartnerOrderIssue = {
  number: string;
  issuedByName: string | null;
  items: CompletionCertificateItemInput[];
  document: CompletionCertificateGeneratedDocument;
};

/** A kiállítás tranzakciójának felső határa: a PDF a zár alatt készül. */
export const PARTNER_ORDER_ISSUE_TIMEOUT_MS = 30_000;

export type CompletionCertificateGeneratedDocument = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  content: Buffer;
};

/**
 * A PORTÁL SELECTJE -- STRUKTURÁLISAN ÁR NÉLKÜL, ugyanaz az indok, mint a
 * `MaintenanceOrdersRepository` `portalOrderSelect`-jénél: egy `select`,
 * ami a mezőt le sem kérdezi, nem tud visszakerülni a válaszba egy
 * jóhiszemű bővítésnél.
 */
const portalCertificateSelect = {
  id: true,
  number: true,
  issuedAt: true,
  issuedByName: true,
  serviceJob: { select: { departmentId: true } },
  items: { select: { id: true, description: true, quantity: true } },
  documents: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      type: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
} satisfies Prisma.CompletionCertificateSelect;

export type PortalCompletionCertificateRow =
  Prisma.CompletionCertificateGetPayload<{
    select: typeof portalCertificateSelect;
  }>;

@Injectable()
export class CompletionCertificatesRepository {
  private readonly database = prisma;

  list(serviceJobId: string) {
    return this.database.completionCertificate.findMany({
      where: { serviceJobId },
      orderBy: { issuedAt: "desc" },
      include: certificateInclude,
    });
  }

  detail(id: string) {
    return this.database.completionCertificate.findUnique({
      where: { id },
      include: certificateInclude,
    });
  }

  /**
   * A KARBANTARTÁSI LAP, A MEGRENDELŐLAP TÉTELEIVEL ÉS AZ ÜGYFÉL ADATAIVAL --
   * KIÁLLÍTÁSHOZ.
   *
   * A `maintenanceOrder` KÖTELEZŐ jelenléte a szolgáltatás-réteg dolga
   * (`null`, ha a lapot nem megrendelőlapból hozták létre) -- ez a
   * lekérdezés csak összegyűjti, amit egy esetleges kiállítás kérne.
   */
  serviceJobForIssuance(serviceJobId: string) {
    return this.database.serviceJob.findUnique({
      where: { id: serviceJobId },
      select: {
        id: true,
        kind: true,
        title: true,
        completedAt: true,
        completionCertificate: { select: { id: true } },
        customer: {
          select: {
            id: true,
            displayName: true,
            taxNumber: true,
            addresses: {
              where: { isDefault: true },
              take: 1,
              select: {
                line1: true,
                line2: true,
                postalCode: true,
                city: true,
              },
            },
          },
        },
        maintenanceOrder: {
          select: {
            id: true,
            number: true,
            contract: { select: { number: true } },
            items: {
              select: {
                description: true,
                unitNet: true,
                vatRatePercent: true,
              },
            },
          },
        },
        /*
          A MEGRENDELŐLAP NÉLKÜLI LAP TÉTELEI (felmérés S5): a lap
          létrehozásakor rögzített másolat (`ServiceJobContractItem`), a
          szerződés-tétel sorrendjében. A szerződés száma a lap szerződéséé.
        */
        contract: { select: { number: true } },
        contractItems: {
          orderBy: { contractItem: { position: "asc" } },
          select: {
            description: true,
            unitNet: true,
            vatRatePercent: true,
          },
        },
        worksheets: {
          select: {
            id: true,
            number: true,
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              select: { status: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  async lastNumberOfYear(prefix: string): Promise<string | null> {
    const row = await this.database.completionCertificate.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return row?.number ?? null;
  }

  /**
   * A MEGRENDELÉS TIG-JÉNEK KIÁLLÍTÁSA EGY TRANZAKCIÓBAN, a megrendelés sorának
   * zárja alatt (`SELECT ... FOR UPDATE`): két egyidejű kiállítás nem olvashatja
   * ugyanazt a hátralévőt. A `prepare` kapja a pillanatképet, és adja a számot,
   * a sorokat és a PDF-et (vagy dob, és akkor semmi nem íródik). `null`: nincs
   * ilyen megrendelés.
   */
  issueForPartnerOrder(
    orderId: string,
    prepare: (
      snapshot: PartnerOrderIssuanceSnapshot,
    ) => Promise<PreparedPartnerOrderIssue>,
  ) {
    return this.database.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "PartnerOrder" WHERE "id" = ${orderId} FOR UPDATE`;
        const order = await tx.partnerOrder.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            // a megrendelés AZ ALÁÍRT verziót és elfogadást rögzíti (murena, #2153), nem a
            // Quote mostani `acceptedVersionId`-jét: a tételek ezekből jönnek
            quoteVersionId: true,
            quoteVersion: { select: { currency: true } },
            acceptance: { select: { selectedOptionalItemIds: true } },
            customer: {
              select: {
                displayName: true,
                taxNumber: true,
                addresses: {
                  where: { isDefault: true },
                  take: 1,
                  select: {
                    line1: true,
                    line2: true,
                    postalCode: true,
                    city: true,
                  },
                },
              },
            },
            quote: { select: { id: true, quoteNumber: true, title: true } },
          },
        });
        if (!order) return null;
        const versionId = order.quoteVersionId;
        const [versionItems, certifiedLines] = await Promise.all([
          tx.quoteItem.findMany({
            where: { versionId },
            select: {
              id: true,
              position: true,
              block: { select: { position: true } },
              name: true,
              description: true,
              quantity: true,
              unit: true,
              unitNetPrice: true,
              vatRatePercent: true,
              isOptional: true,
            },
          }),
          tx.completionCertificateLineItem.findMany({
            where: { certificate: { partnerOrderId: orderId } },
            select: {
              quoteItemId: true,
              quantity: true,
              unitNet: true,
              vatRatePercent: true,
            },
          }),
        ]);
        const prepared = await prepare({
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
          },
          quote: {
            id: order.quote.id,
            quoteNumber: order.quote.quoteNumber,
            title: order.quote.title,
          },
          customer: order.customer,
          versionItems: versionItems.map(({ block, ...item }) => ({
            ...item,
            blockPosition: block.position,
          })),
          selectedOptionalItemIds: order.acceptance.selectedOptionalItemIds,
          currency: order.quoteVersion.currency,
          certifiedLines: certifiedLines.flatMap((line) =>
            line.quoteItemId
              ? [{ ...line, quoteItemId: line.quoteItemId }]
              : [],
          ),
          lastNumberOfYear: async (prefix) =>
            (
              await tx.completionCertificate.findFirst({
                where: { number: { startsWith: prefix } },
                orderBy: { number: "desc" },
                select: { number: true },
              })
            )?.number ?? null,
        });
        return tx.completionCertificate.create({
          data: {
            partnerOrderId: orderId,
            number: prepared.number,
            issuedByName: prepared.issuedByName,
            items: { create: prepared.items.map(lineItemData) },
            documents: {
              create: {
                type: "GENERATED_FORM",
                fileName: prepared.document.fileName,
                contentType: prepared.document.contentType,
                sizeBytes: prepared.document.sizeBytes,
                content: Uint8Array.from(prepared.document.content),
              },
            },
          },
          include: certificateInclude,
        });
      },
      { timeout: PARTNER_ORDER_ISSUE_TIMEOUT_MS },
    );
  }

  /** A megrendelés TIG-jei, a legújabb elöl (Megrendelések S2). */
  listForPartnerOrder(partnerOrderId: string) {
    return this.database.completionCertificate.findMany({
      where: { partnerOrderId },
      orderBy: { issuedAt: "desc" },
      include: certificateInclude,
    });
  }

  issue(input: {
    serviceJobId: string;
    number: string;
    issuedByName: string | null;
    items: CompletionCertificateItemInput[];
    document: CompletionCertificateGeneratedDocument;
  }) {
    return this.database.completionCertificate.create({
      data: {
        serviceJobId: input.serviceJobId,
        number: input.number,
        issuedByName: input.issuedByName,
        items: { create: input.items.map(lineItemData) },
        documents: {
          create: {
            type: "GENERATED_FORM",
            fileName: input.document.fileName,
            contentType: input.document.contentType,
            sizeBytes: input.document.sizeBytes,
            content: Uint8Array.from(input.document.content),
          },
        },
      },
      include: certificateInclude,
    });
  }

  document(certificateId: string, documentId: string) {
    return this.database.completionCertificateDocument.findFirst({
      where: { id: documentId, certificateId },
      select: { fileName: true, contentType: true, content: true },
    });
  }

  addSignedDocument(certificateId: string, file: Express.Multer.File) {
    return this.database.completionCertificateDocument.create({
      data: {
        certificateId,
        type: "SIGNED_FORM",
        fileName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        content: Uint8Array.from(file.buffer),
      },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        createdAt: true,
      },
    });
  }

  /**
   * A PORTÁL LISTÁJA -- A HÍVÓ LÁTHATÓSÁGA A KAPCSOLT `ServiceJob`-ON ÁLL.
   *
   * `visibility` a `serviceJobVisibilityWhere(...)` KÉSZ EREDMÉNYE, a
   * szolgáltatás-rétegből -- ugyanaz a réteg-rend, mint az
   * `AquariumsRepository.list(query, visibility)`-nél: a tároló nem tudja,
   * mi a `scope` vagy a `userId`, csak egy már kész `where`-ágat kap.
   *
   * A NESTELT `serviceJob: visibility` EGY-EGY (to-one) RELÁCIÓRA SZŰKÍT,
   * NEM `some`-mal egy listára -- tehát ez NEM ugyanaz az alattomos
   * túltágulás, amit az `aquarium-visibility.ts` a lista-relációk kapcsán
   * leír: itt a kapcsolt sor MAGA kell hogy megfeleljen a feltételnek,
   * nincs "bármelyik kapcsolódó sor" kétértelműség.
   */
  portalListForVisibility(
    visibility: Prisma.ServiceJobWhereInput,
  ): Promise<PortalCompletionCertificateRow[]> {
    return this.database.completionCertificate.findMany({
      // a megrendeléses TIG (Megrendelések S2) nem a portálé: munkalap nélkül
      // nincs láthatósága, és egy üres `visibility` sem engedheti át
      where: { serviceJobId: { not: null }, serviceJob: visibility },
      orderBy: { issuedAt: "desc" },
      select: portalCertificateSelect,
    });
  }

  portalDetail(
    id: string,
    visibility: Prisma.ServiceJobWhereInput,
  ): Promise<PortalCompletionCertificateRow | null> {
    return this.database.completionCertificate.findFirst({
      where: {
        AND: [
          { id },
          { serviceJobId: { not: null } },
          { serviceJob: visibility },
        ],
      },
      select: portalCertificateSelect,
    });
  }

  /** A helyszín NEVE (nem a teljes útja) -- lásd a hívó fejlécét. */
  async departmentNames(
    departmentIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (departmentIds.length === 0) return new Map();
    const rows = await this.database.worksheetDepartment.findMany({
      where: { id: { in: [...departmentIds] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /**
   * VAN-E BEJELÖLVE A HÍVÓNÁL AZ ALÁÍRT TELJESÍTÉSI IGAZOLÁS FELTÖLTÉSÉNEK
   * KÉPESSÉGE -- ugyanaz a minta, mint a `MaintenanceOrdersRepository`
   * `hasUploadSignedCapability()`-je, KÜLÖN `ServiceCapability` értékkel.
   */
  async hasUploadSignedCapability(userId: string): Promise<boolean> {
    const row = await this.database.userServiceCapability.findUnique({
      where: {
        userId_capability: {
          userId,
          capability: "COMPLETION_CERTIFICATE_UPLOAD_SIGNED",
        },
      },
    });
    return row !== null;
  }
}

function lineItemData(item: CompletionCertificateItemInput) {
  return {
    description: item.description,
    quantity: item.quantity,
    unitNet: item.unitNet,
    vatRatePercent: item.vatRatePercent,
    quantityUnit: item.quantityUnit ?? null,
    quoteItemId: item.quoteItemId ?? null,
  };
}
