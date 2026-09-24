import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";

const contractInclude = {
  customer: { select: { id: true, displayName: true } },
  items: {
    orderBy: { position: "asc" as const },
    include: {
      department: { select: { id: true, name: true, code: true } },
      assets: {
        include: {
          asset: { select: { id: true, assetNumber: true, name: true } },
        },
      },
    },
  },
  documents: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
};

export type ContractInput = {
  customerId: string;
  number: string;
  title: string;
  validFrom: Date;
  validTo: Date | null;
  status: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
  notes: string | null;
  items: Array<{
    description: string;
    unitNet: Prisma.Decimal;
    quantity: Prisma.Decimal;
    occasionsPerYear: number;
    vatRatePercent: Prisma.Decimal;
    departmentId: string | null;
    assetIds: string[];
  }>;
};

@Injectable()
export class ContractsRepository {
  private readonly database = prisma;

  list() {
    return this.database.contract.findMany({
      orderBy: [{ validFrom: "desc" }, { number: "desc" }],
      include: contractInclude,
    });
  }

  /**
   * A szerződés közvetlenül `Customer`-hoz köt, míg a partner-lista a tükör
   * `Supplier` sorokat adja. Ez a rövid lista ezért nem új partnerkatalógus,
   * hanem a szerződés űrlapjának szükséges, helyes tulajdonosi választója.
   */
  customers() {
    return this.database.customer.findMany({
      where: { partner: { is: { isService: true, isActive: true } } },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, worksheetPartnerCode: true },
    });
  }

  detail(id: string) {
    return this.database.contract.findUnique({
      where: { id },
      include: contractInclude,
    });
  }

  customerExists(customerId: string) {
    return this.database.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
  }

  async departmentBelongsToCustomer(departmentId: string, customerId: string) {
    return this.database.worksheetDepartment.findFirst({
      where: { id: departmentId, customerId },
      select: { id: true },
    });
  }

  async assetsBelongToCustomer(assetIds: string[], customerId: string) {
    if (!assetIds.length) return [];
    return this.database.asset.findMany({
      where: { id: { in: assetIds }, customerId },
      select: { id: true },
    });
  }

  create(input: ContractInput) {
    return this.database.contract.create({
      data: this.data(input),
      include: contractInclude,
    });
  }

  async update(id: string, input: ContractInput) {
    return this.database.$transaction(async (tx) => {
      await tx.contractItem.deleteMany({ where: { contractId: id } });
      return tx.contract.update({
        where: { id },
        data: this.data(input),
        include: contractInclude,
      });
    });
  }

  addPdf(contractId: string, file: Express.Multer.File) {
    return this.database.contractDocument.create({
      data: {
        contractId,
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

  document(contractId: string, documentId: string) {
    return this.database.contractDocument.findFirst({
      where: { id: documentId, contractId },
      select: { fileName: true, contentType: true, content: true },
    });
  }

  private data(input: ContractInput): Prisma.ContractCreateInput {
    return {
      customer: { connect: { id: input.customerId } },
      number: input.number,
      title: input.title,
      validFrom: input.validFrom,
      validTo: input.validTo,
      status: input.status,
      notes: input.notes,
      items: {
        create: input.items.map((item, index) => ({
          position: index + 1,
          description: item.description,
          unitNet: item.unitNet,
          quantity: item.quantity,
          occasionsPerYear: item.occasionsPerYear,
          vatRatePercent: item.vatRatePercent,
          departmentId: item.departmentId,
          assets: { create: item.assetIds.map((assetId) => ({ assetId })) },
        })),
      },
    };
  }
}
