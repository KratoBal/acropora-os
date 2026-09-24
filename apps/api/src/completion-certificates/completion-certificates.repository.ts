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
}
