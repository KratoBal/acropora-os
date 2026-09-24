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
import { assetsOutsideDepartment } from "../common/assets-in-department.js";

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
          id: item.id,
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
        A REPOSITORY TÉTELENKÉNT UPSERT-EL (`contracts.repository.ts`
        `update()`), NEM TÖRLI+ÚJRAÉPÍTI AZ ÖSSZES SORT -- ez a viselkedés
        2026-09-24-én változott (Balázs éles hibája, Állatkert,
        SZ2026/0000019: a régi alak minden mentésnél új `id`-t adott a
        MEGMARADÓ tételeknek is). A P2003 tehát MOSTANTÓL csak akkor jön,
        ha a küldött tétel-lista TÉNYLEG kihagy egy olyan tételt, amihez
        már készült megrendelőlap (`MaintenanceOrderItem.contractItemId`,
        `onDelete: Restrict`) -- vagyis valódi törlési szándékra, nem
        minden mentésre.
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
        const departmentId = item.departmentId?.trim() || null;
        if (
          departmentId &&
          !(await this.repository.departmentBelongsToCustomer(
            departmentId,
            customerId,
          ))
        )
          throw new BadRequestException(
            "A megadott helyszín nem ehhez a partnerhez tartozik.",
          );
        /*
          A TÉTEL HELYSZÍNÉHEZ VISZONYÍTVA ELLENŐRZÜNK, NEM A SZERZŐDÉS
          PARTNERÉHEZ -- Balázs éles hibája (2026-09-24 21:48, Állatkert,
          SZ2026/0000019): a `JobAssetPicker` a HELYSZÍN alfája szerint
          kínálja fel az eszközöket (`assets-in-department.ts`), a korábbi
          `assetsBelongToCustomer` viszont a szerződés `customerId`-jét
          nézte. A kettő szétcsúszhat, ha ugyanahhoz a valós partnerhez
          (itt: Állatkert) KÉT `Customer` sor tartozik, és az eszköz meg a
          szerződés nem ugyanarra mutat -- ekkor a felkínált eszköz mindig
          elutasítva jött volna vissza, holott pontosan azt választották,
          amit a felület felkínált. Helyszín nélkül (a felület ezt sosem
          engedi meg, ha van kiválasztott eszköz) a régi, partner-szintű
          ellenőrzés marad az egyetlen védelem.
        */
        if (assetIds.length) {
          if (departmentId) {
            const outside = await assetsOutsideDepartment(
              assetIds,
              departmentId,
            );
            if (outside.length)
              throw new BadRequestException(
                "A megadott eszközök között idegen vagy ismeretlen eszköz van.",
              );
          } else {
            const owned = await this.repository.assetsBelongToCustomer(
              assetIds,
              customerId,
            );
            if (owned.length !== assetIds.length)
              throw new BadRequestException(
                "A megadott eszközök között idegen vagy ismeretlen eszköz van.",
              );
          }
        }
        return {
          id: item.id?.trim() || undefined,
          description: item.description.trim(),
          unitNet: new Prisma.Decimal(item.unitNet),
          quantity: new Prisma.Decimal(item.quantity),
          occasionsPerYear: item.occasionsPerYear,
          vatRatePercent: new Prisma.Decimal(item.vatRatePercent),
          departmentId,
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
