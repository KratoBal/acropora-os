import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

import { unitPathsFor } from "../common/unit-path-lookup.js";

const orderInclude = {
  contract: {
    select: {
      id: true,
      number: true,
      title: true,
      customerId: true,
      organizationalUnitName: true,
      contactPersonName: true,
      customer: { select: { id: true, displayName: true } },
    },
  },
  items: {
    include: {
      contractItem: {
        select: { id: true, position: true, departmentId: true },
      },
    },
  },
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

export type MaintenanceOrderItemInput = {
  contractItemId: string;
  description: string;
  unitNet: Prisma.Decimal;
  quantity: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
};

export type MaintenanceOrderGeneratedDocument = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  content: Buffer;
};

@Injectable()
export class MaintenanceOrdersRepository {
  private readonly database = prisma;

  list(contractId: string) {
    return this.database.maintenanceOrder.findMany({
      where: { contractId },
      orderBy: { issuedAt: "desc" },
      include: orderInclude,
    });
  }

  detail(id: string) {
    return this.database.maintenanceOrder.findUnique({
      where: { id },
      include: orderInclude,
    });
  }

  /**
   * A SZERZŐDÉS ÉS A KIVÁLASZTOTT TÉTELEK, KIÁLLÍTÁSHOZ.
   *
   * Csak azokat a tételeket adja vissza, amik TÉNYLEG ehhez a szerződéshez
   * tartoznak -- ha a hívó egy másik szerződés tétel-azonosítóját küldi be
   * (elgépelés vagy összefésült űrlap), az csendben kimaradna a szűrés
   * nélkül, és a hívó azt hinné, megrendelte, amit valójában nem.
   */
  contractForIssuance(contractId: string, itemIds: string[]) {
    return this.database.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        organizationalUnitName: true,
        contactPersonName: true,
        customer: { select: { id: true, displayName: true } },
        items: {
          where: { id: { in: itemIds } },
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            description: true,
            unitNet: true,
            quantity: true,
            occasionsPerYear: true,
            vatRatePercent: true,
            departmentId: true,
          },
        },
      },
    });
  }

  /** A helyszínek teljes útja, hibaüzenetbe -- ugyanaz a felbontás, mint a munkalapon. */
  departmentPaths(departmentIds: readonly string[]) {
    return unitPathsFor(this.database, [...departmentIds]);
  }

  defaultAddress(customerId: string) {
    return this.database.customerAddress.findFirst({
      where: { customerId, isDefault: true },
      select: { line1: true, line2: true, postalCode: true, city: true },
    });
  }

  async lastNumberOfYear(prefix: string): Promise<string | null> {
    const row = await this.database.maintenanceOrder.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return row?.number ?? null;
  }

  /**
   * HÁNY NEM VISSZAVONT RENDELÉS ESIK ERRE A TÉTELRE, EBBEN AZ ÉVBEN -- a
   * kettős rendelés elleni őrző alapja. `REVOKED` állapotú rendelés tétele
   * NEM számít bele: egy visszavont kiállítás felszabadítja az alkalmat.
   */
  async issuedOccasionCounts(
    contractItemIds: string[],
    occasionYear: number,
  ): Promise<Map<string, number>> {
    if (!contractItemIds.length) return new Map();
    const rows = await this.database.maintenanceOrderItem.groupBy({
      by: ["contractItemId"],
      where: {
        contractItemId: { in: contractItemIds },
        maintenanceOrder: {
          occasionYear,
          status: { not: "REVOKED" },
        },
      },
      _count: { contractItemId: true },
    });
    return new Map(
      rows.map((row) => [row.contractItemId, row._count.contractItemId]),
    );
  }

  /**
   * A KIÁLLÍTÁS: A REKORD, A TÉTEL-MÁSOLATOK ÉS A GENERÁLT PDF EGY
   * TRANZAKCIÓBAN. Ha külön mennének, egy megszakadt kérés után a rendelés
   * már létezne, a PDF viszont nélküle -- és a felület egy dokumentum
   * nélküli, kiadhatatlan kiállítást mutatna.
   */
  async issue(input: {
    contractId: string;
    number: string;
    occasionYear: number;
    issuedByName: string | null;
    items: MaintenanceOrderItemInput[];
    document: MaintenanceOrderGeneratedDocument;
  }) {
    return this.database.maintenanceOrder.create({
      data: {
        contractId: input.contractId,
        number: input.number,
        occasionYear: input.occasionYear,
        issuedByName: input.issuedByName,
        items: {
          create: input.items.map((item) => ({
            contractItemId: item.contractItemId,
            description: item.description,
            unitNet: item.unitNet,
            quantity: item.quantity,
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
      include: orderInclude,
    });
  }

  document(orderId: string, documentId: string) {
    return this.database.maintenanceOrderDocument.findFirst({
      where: { id: documentId, maintenanceOrderId: orderId },
      select: { fileName: true, contentType: true, content: true },
    });
  }

  addSignedDocument(orderId: string, file: Express.Multer.File) {
    return this.database.maintenanceOrderDocument.create({
      data: {
        maintenanceOrderId: orderId,
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

  markSigned(orderId: string, serviceJobId: string) {
    return this.database.maintenanceOrder.update({
      where: { id: orderId },
      data: { status: "SIGNED", signedAt: new Date(), serviceJobId },
      include: orderInclude,
    });
  }

  markRevoked(
    orderId: string,
    revokedByName: string | null,
    reason: string | null,
  ) {
    return this.database.maintenanceOrder.update({
      where: { id: orderId },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByName,
        revokeReason: reason,
      },
      include: orderInclude,
    });
  }
}
