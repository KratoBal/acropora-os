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
      organizationalUnitName:
        patch.organizationalUnitName === undefined
          ? existing.organizationalUnitName
          : patch.organizationalUnitName,
      contactPersonName:
        patch.contactPersonName === undefined
          ? existing.contactPersonName
          : patch.contactPersonName,
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
    try {
      return await this.repository.update(id, data);
    } catch (error) {
      /*
        A REPOSITORY MINDEN MENTÉSKOR TÖRLI ÉS ÚJRAÉPÍTI A TÉTELEKET
        (`contracts.repository.ts` `update()`: `deleteMany` majd `create`)
        -- ez MÁR MA is így van, nem ez a szelet vezeti be. Ha egy tételhez
        már készült megrendelőlap (`MaintenanceOrderItem.contractItemId`,
        `onDelete: Restrict`), a törlés a Postgres-idegenkulcs-megkötésen
        akad el (P2003), és eddig NYERSEN futott tovább a felhasználóig.
        Ez a lelet a helyszín/eszköz-szerkesztő beépítésekor derült ki
        (2026-09-24): a webes szerkesztő mostantól MINDIG küld `items`-t,
        tehát ez az ág gyakrabban futna le, mint eddig -- de az ALAPHIBA
        nem új, minden szerződés-mentés érintett volt, ami tételhez kötött
        megrendelőlappal rendelkező szerződést mentett.
      */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      )
        throw new ConflictException(
          "A tételek nem módosíthatók, mert ezekhez már készült megrendelőlap.",
        );
      throw error;
    }
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
    organizationalUnitName?: string | null;
    contactPersonName?: string | null;
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
      organizationalUnitName: input.organizationalUnitName?.trim() || null,
      contactPersonName: input.contactPersonName?.trim() || null,
      items,
    };
  }
}
