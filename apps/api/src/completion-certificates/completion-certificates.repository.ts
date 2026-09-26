import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

const certificateInclude = {
  serviceJob: {
    select: {
      id: true,
      title: true,
      completedAt: true,
      customerId: true,
      customer: {
        select: {
          id: true,
          displayName: true,
          taxNumber: true,
          addresses: {
            where: { isDefault: true },
            take: 1,
            select: { line1: true, line2: true, postalCode: true, city: true },
          },
        },
      },
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
};

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
        items: {
          create: input.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitNet: item.unitNet,
            vatRatePercent: item.vatRatePercent,
          })),
        },
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
      where: { serviceJob: visibility },
      orderBy: { issuedAt: "desc" },
      select: portalCertificateSelect,
    });
  }

  portalDetail(
    id: string,
    visibility: Prisma.ServiceJobWhereInput,
  ): Promise<PortalCompletionCertificateRow | null> {
    return this.database.completionCertificate.findFirst({
      where: { AND: [{ id }, { serviceJob: visibility }] },
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
