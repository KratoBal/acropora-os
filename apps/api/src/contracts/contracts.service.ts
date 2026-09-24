import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import {
  ContractItemDto,
  CreateContractDto,
  UpdateContractDto,
} from "./dto.js";
import {
  ContractsRepository,
  type ContractInput,
} from "./contracts.repository.js";
import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";
import { decideQuota } from "../service-assets/document-store/document-quota.js";

@Injectable()
export class ContractsService {
  constructor(private readonly repository: ContractsRepository) {}

  list() {
    return this.repository.list();
  }
  customers() {
    return this.repository.customers();
  }

  async detail(id: string) {
    const contract = await this.repository.detail(id);
    if (!contract) throw new NotFoundException("A szerződés nem található.");
    return contract;
  }

  async create(input: CreateContractDto) {
    const data = await this.normalize(input);
    try {
      return await this.repository.create(data);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("Ez a szerződésszám már létezik.");
      throw error;
    }
  }

  async update(id: string, patch: UpdateContractDto) {
    const existing = await this.detail(id);
    const data = await this.normalize({
      customerId: existing.customerId,
      number: patch.number ?? existing.number,
      title: patch.title ?? existing.title,
      validFrom: patch.validFrom ?? existing.validFrom.toISOString(),
      validTo:
        patch.validTo === undefined
          ? (existing.validTo?.toISOString() ?? null)
          : patch.validTo,
      status: patch.status ?? existing.status,
      notes: patch.notes === undefined ? existing.notes : patch.notes,
      items:
        patch.items ??
        existing.items.map((item) => ({
          description: item.description,
          unitNet: item.unitNet.toString(),
          quantity: item.quantity.toString(),
          occasionsPerYear: item.occasionsPerYear,
          vatRatePercent: item.vatRatePercent.toString(),
          departmentId: item.departmentId,
          assetIds: item.assets.map((asset) => asset.assetId),
        })),
    });
    return this.repository.update(id, data);
  }

  async addPdf(id: string, file: Express.Multer.File) {
    await this.detail(id);
    if (
      file.mimetype !== "application/pdf" ||
      !file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw new BadRequestException("Csak valódi PDF-fájl tölthető fel.");
    const limitBytes = Number(process.env.DOCUMENT_STORE_LIMIT_BYTES ?? 0);
    if (Number.isFinite(limitBytes) && limitBytes > 0) {
      const quota = decideQuota({
        usedBytes: await sumDocumentBytesInUse(),
        incomingBytes: file.buffer.length,
        limitBytes,
      });
      if (quota.state === "reject") throw new ConflictException(quota.reason);
    }
    return this.repository.addPdf(id, file);
  }

  async document(id: string, documentId: string) {
    const document = await this.repository.document(id, documentId);
    if (!document || !document.content)
      throw new NotFoundException("A dokumentum nem található.");
    return { ...document, bytes: document.content };
  }

  private async normalize(input: {
    customerId: string;
    number: string;
    title: string;
    validFrom: string;
    validTo?: string | null;
    status?: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
    notes?: string | null;
    items: ContractItemDto[];
  }): Promise<ContractInput> {
    const customerId = input.customerId.trim();
    if (!(await this.repository.customerExists(customerId)))
      throw new BadRequestException("A megadott partner nem található.");
    const validFrom = new Date(input.validFrom);
    const validTo = input.validTo ? new Date(input.validTo) : null;
    if (validTo && validTo < validFrom)
      throw new BadRequestException(
        "Az érvényesség vége nem lehet korábbi a kezdeténél.",
      );
    const items = await Promise.all(
      input.items.map(async (item) => {
        const assetIds = [...new Set(item.assetIds ?? [])];
        if (
          item.departmentId &&
          !(await this.repository.departmentBelongsToCustomer(
            item.departmentId,
            customerId,
          ))
        )
          throw new BadRequestException(
            "A megadott helyszín nem ehhez a partnerhez tartozik.",
          );
        const owned = await this.repository.assetsBelongToCustomer(
          assetIds,
          customerId,
        );
        if (owned.length !== assetIds.length)
          throw new BadRequestException(
            "A megadott eszközök között idegen vagy ismeretlen eszköz van.",
          );
        return {
          description: item.description.trim(),
          unitNet: new Prisma.Decimal(item.unitNet),
          quantity: new Prisma.Decimal(item.quantity),
          occasionsPerYear: item.occasionsPerYear,
          vatRatePercent: new Prisma.Decimal(item.vatRatePercent),
          departmentId: item.departmentId?.trim() || null,
          assetIds,
        };
      }),
    );
    return {
      customerId,
      number: input.number.trim(),
      title: input.title.trim(),
      validFrom,
      validTo,
      status: input.status ?? "DRAFT",
      notes: input.notes?.trim() || null,
      items,
    };
  }
}
