import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import type {
  OperationsMeterRole,
  OperationsTaskFieldDto,
  OperationsTaskFieldType,
  OperationsTaskFrequency,
  OperationsTaskTemplateDto,
} from "@acropora/types";

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  frequency: true,
  assetId: true,
  assetCategoryId: true,
  isActive: true,
  updatedAt: true,
  asset: { select: { id: true, assetNumber: true, name: true } },
  assetCategory: { select: { id: true, name: true } },
  fields: {
    select: {
      id: true,
      key: true,
      label: true,
      type: true,
      unit: true,
      required: true,
      meterRole: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.OperationsTaskTemplateSelect;

type TemplateRow = Prisma.OperationsTaskTemplateGetPayload<{
  select: typeof TEMPLATE_SELECT;
}>;

/** Egy mező a tároláshoz: a kulcsa már kiosztva (`assignOperationsFieldKeys`). */
export interface OperationsTaskFieldWrite {
  key: string;
  label: string;
  type: OperationsTaskFieldType;
  unit: string | null;
  required: boolean;
  meterRole: OperationsMeterRole | null;
}

export interface OperationsTaskTemplateWrite {
  name: string;
  description: string | null;
  frequency: OperationsTaskFrequency;
  assetId: string | null;
  assetCategoryId: string | null;
  fields: OperationsTaskFieldWrite[];
}

function toDto(row: TemplateRow): OperationsTaskTemplateDto {
  const fields: OperationsTaskFieldDto[] = row.fields.map((field) => ({
    id: field.id,
    key: field.key,
    label: field.label,
    type: field.type,
    unit: field.unit,
    required: field.required,
    meterRole: field.meterRole,
    sortOrder: field.sortOrder,
  }));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    frequency: row.frequency,
    // a CHECK tartja: a kettő közül pontosan egy kitöltött
    target: row.asset
      ? {
          kind: "ASSET",
          assetId: row.asset.id,
          assetNumber: row.asset.assetNumber,
          name: row.asset.name,
        }
      : {
          kind: "CATEGORY",
          categoryId: row.assetCategory!.id,
          name: row.assetCategory!.name,
        },
    isActive: row.isActive,
    fields,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class OperationsLogRepository {
  async listTemplates(
    includeInactive: boolean,
  ): Promise<OperationsTaskTemplateDto[]> {
    const rows = await prisma.operationsTaskTemplate.findMany({
      where: includeInactive ? {} : { isActive: true },
      select: TEMPLATE_SELECT,
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
    });
    return rows.map(toDto);
  }

  async templateById(id: string): Promise<OperationsTaskTemplateDto | null> {
    const row = await prisma.operationsTaskTemplate.findUnique({
      where: { id },
      select: TEMPLATE_SELECT,
    });
    return row ? toDto(row) : null;
  }

  /** Létezik-e az eszköz, és nem archivált (a sablon csak élő eszközre szólhat). */
  async assetIsLive(assetId: string): Promise<boolean> {
    const row = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { archivedAt: true },
    });
    return row !== null && row.archivedAt === null;
  }

  /** Létezik-e az eszköz-kategória, és aktív. */
  async categoryIsActive(categoryId: string): Promise<boolean> {
    const row = await prisma.assetCategory.findUnique({
      where: { id: categoryId },
      select: { isActive: true },
    });
    return row?.isActive === true;
  }

  async createTemplate(
    input: OperationsTaskTemplateWrite,
    actorId: string,
  ): Promise<OperationsTaskTemplateDto> {
    const created = await prisma.operationsTaskTemplate.create({
      data: {
        name: input.name,
        description: input.description,
        frequency: input.frequency,
        assetId: input.assetId,
        assetCategoryId: input.assetCategoryId,
        createdById: actorId,
        updatedById: actorId,
        fields: {
          create: input.fields.map((field, index) => ({
            ...field,
            sortOrder: index,
          })),
        },
      },
      select: TEMPLATE_SELECT,
    });
    return toDto(created);
  }

  /**
   * A SABLON ÉS A TELJES MEZŐKÉSZLET EGY TRANZAKCIÓBAN. A mezőket a KULCSUK szerint egyeztetjük: a meglévő frissül (a kulcsa és
   * az azonosítója marad), az új létrejön, ami nincs a listában, törlődik. A vízóra szerepet ELŐBB lenullázzuk: a sablononkénti
   * egyedi (előtte, utána) index egy szerep-cserénél (a két mező felcserélődik) a köztes állapotban sértené magát.
   * `null`: a sablon nem található.
   */
  async replaceTemplate(
    id: string,
    input: OperationsTaskTemplateWrite & { isActive?: boolean },
    actorId: string,
  ): Promise<OperationsTaskTemplateDto | null> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.operationsTaskTemplate.findUnique({
        where: { id },
        select: { id: true, fields: { select: { id: true, key: true } } },
      });
      if (!existing) return null;
      await tx.operationsTaskField.updateMany({
        where: { templateId: id },
        data: { meterRole: null },
      });
      const keep = new Set(input.fields.map((field) => field.key));
      const removable = existing.fields
        .filter((field) => !keep.has(field.key))
        .map((field) => field.id);
      if (removable.length > 0)
        await tx.operationsTaskField.deleteMany({
          where: { id: { in: removable } },
        });
      const idByKey = new Map(
        existing.fields.map((field) => [field.key, field.id]),
      );
      for (const [index, field] of input.fields.entries()) {
        const fieldId = idByKey.get(field.key);
        if (fieldId)
          await tx.operationsTaskField.update({
            where: { id: fieldId },
            data: { ...field, sortOrder: index },
          });
        else
          await tx.operationsTaskField.create({
            data: { ...field, templateId: id, sortOrder: index },
          });
      }
      const updated = await tx.operationsTaskTemplate.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          frequency: input.frequency,
          assetId: input.assetId,
          assetCategoryId: input.assetCategoryId,
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          updatedById: actorId,
        },
        select: TEMPLATE_SELECT,
      });
      return toDto(updated);
    });
  }

  /** A kivezetés: a sor megmarad (a bejegyzések hivatkozni fognak rá). `false`: nem található. */
  async retireTemplate(id: string, actorId: string): Promise<boolean> {
    const result = await prisma.operationsTaskTemplate.updateMany({
      where: { id },
      data: { isActive: false, updatedById: actorId },
    });
    return result.count > 0;
  }
}
