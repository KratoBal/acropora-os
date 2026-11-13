import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import {
  personDisplayName,
  type OperationsLogEntryDto,
  type OperationsLogEntryPhotoDto,
  type OperationsLogEntryValueDto,
  type OperationsMeterRole,
  type OperationsTaskFieldType,
  type OperationsTaskFrequency,
} from "@acropora/types";

import { assignableUserWhere } from "../common/service-assignment.js";
import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";

const ENTRY_SELECT = {
  id: true,
  clientOperationId: true,
  templateId: true,
  templateName: true,
  frequency: true,
  startedAt: true,
  finishedAt: true,
  recordedById: true,
  anomaly: true,
  anomalyNote: true,
  internalNote: true,
  createdAt: true,
  asset: { select: { id: true, assetNumber: true, name: true } },
  serviceJob: { select: { id: true, jobNumber: true, status: true } },
  recordedBy: {
    select: { id: true, displayName: true, nickname: true },
  },
  participants: {
    select: {
      user: { select: { id: true, displayName: true, nickname: true } },
    },
  },
  documents: {
    select: {
      id: true,
      fieldKey: true,
      fieldLabel: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      caption: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  values: {
    select: {
      fieldKey: true,
      fieldType: true,
      label: true,
      unit: true,
      meterRole: true,
      numberValue: true,
      booleanValue: true,
      textValue: true,
    },
  },
} satisfies Prisma.OperationsLogEntrySelect;

type EntryRow = Prisma.OperationsLogEntryGetPayload<{
  select: typeof ENTRY_SELECT;
}>;

/** Egy érték a tároláshoz: a mező pillanatfelvétele és a típusnak megfelelő érték-oszlop. */
export interface OperationsLogEntryValueWrite {
  fieldKey: string;
  fieldType: Exclude<OperationsTaskFieldType, "PHOTO">;
  label: string;
  unit: string | null;
  meterRole: OperationsMeterRole | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  textValue: string | null;
}

export interface OperationsLogEntryWrite {
  clientOperationId: string;
  templateId: string;
  templateName: string;
  frequency: OperationsTaskFrequency;
  assetId: string;
  /** A helyszín a rögzítés pillanatában (az eszköz akkori helyszíne): a havi kimutatás ezen készül, az áthelyezés a múltat nem mozdítja. */
  departmentId: string | null;
  startedAt: Date;
  finishedAt: Date;
  /** A rögzítő is benne van (a szolgáltatás teszi bele). */
  participantIds: string[];
  anomaly: boolean;
  anomalyNote: string | null;
  internalNote: string | null;
  values: OperationsLogEntryValueWrite[];
}

export interface OperationsLogEntryFilter {
  assetId?: string;
  templateId?: string;
  from?: Date;
  to?: Date;
  anomalyOnly?: boolean;
  limit: number;
}

function personDto(person: {
  id: string;
  displayName: string;
  nickname: string | null;
}) {
  return { id: person.id, displayName: personDisplayName(person) };
}

function valueOf(row: EntryRow["values"][number]) {
  if (row.fieldType === "NUMBER") return row.numberValue!.toNumber();
  if (row.fieldType === "BOOLEAN") return row.booleanValue!;
  return row.textValue!;
}

type PhotoRow = EntryRow["documents"][number];

function photoDto(photo: PhotoRow): OperationsLogEntryPhotoDto {
  return { ...photo, createdAt: photo.createdAt.toISOString() };
}

function toDto(row: EntryRow): OperationsLogEntryDto {
  const values: OperationsLogEntryValueDto[] = row.values.map((value) => ({
    fieldKey: value.fieldKey,
    fieldType: value.fieldType,
    label: value.label,
    unit: value.unit,
    meterRole: value.meterRole,
    value: valueOf(value),
  }));
  return {
    id: row.id,
    clientOperationId: row.clientOperationId,
    templateId: row.templateId,
    templateName: row.templateName,
    frequency: row.frequency,
    asset: row.asset,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    recordedBy: personDto(row.recordedBy),
    participants: row.participants
      .map((participant) => personDto(participant.user))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "hu")),
    anomaly: row.anomaly,
    anomalyNote: row.anomalyNote,
    serviceJob: row.serviceJob,
    internalNote: row.internalNote,
    values,
    photos: row.documents.map((photo) => photoDto(photo)),
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class OperationsLogEntriesRepository {
  /** Az eszköz, amelyre a bejegyzés szól: a sablon-célhoz (eszköz vagy kategória) szükséges adatokkal. */
  async assetRef(assetId: string) {
    return prisma.asset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        assetNumber: true,
        name: true,
        categoryId: true,
        departmentId: true,
      },
    });
  }

  async assignableColleagues(): Promise<{ id: string; name: string }[]> {
    const rows = await prisma.user.findMany({
      where: assignableUserWhere(),
      select: { id: true, displayName: true, nickname: true },
    });
    return rows
      .map((row) => ({ id: row.id, name: personDisplayName(row) }))
      .sort((a, b) => a.name.localeCompare(b.name, "hu"));
  }

  /** A megadottak közül azok, akik választhatók (aktív belső kolléga). */
  async assignableIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await prisma.user.findMany({
      where: { id: { in: [...ids] }, ...assignableUserWhere() },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  async byClientOperationId(
    clientOperationId: string,
  ): Promise<{ entry: OperationsLogEntryDto; recordedById: string } | null> {
    const row = await prisma.operationsLogEntry.findUnique({
      where: { clientOperationId },
      select: ENTRY_SELECT,
    });
    return row ? { entry: toDto(row), recordedById: row.recordedById } : null;
  }

  async byId(id: string): Promise<OperationsLogEntryDto | null> {
    const row = await prisma.operationsLogEntry.findUnique({
      where: { id },
      select: ENTRY_SELECT,
    });
    return row ? toDto(row) : null;
  }

  async list(
    filter: OperationsLogEntryFilter,
  ): Promise<{ items: OperationsLogEntryDto[]; hasMore: boolean }> {
    const rows = await prisma.operationsLogEntry.findMany({
      where: {
        ...(filter.assetId ? { assetId: filter.assetId } : {}),
        ...(filter.templateId ? { templateId: filter.templateId } : {}),
        ...(filter.anomalyOnly ? { anomaly: true } : {}),
        ...(filter.from || filter.to
          ? {
              startedAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lt: filter.to } : {}),
              },
            }
          : {}),
      },
      select: ENTRY_SELECT,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: filter.limit + 1,
    });
    return {
      items: rows.slice(0, filter.limit).map(toDto),
      hasMore: rows.length > filter.limit,
    };
  }

  /**
   * A BEJEGYZÉS ÉS A RÉSZTVEVŐI, ÉRTÉKEI EGY TRANZAKCIÓBAN. Az idempotencia a `clientOperationId` egyedi indexén múlik: a
   * szolgáltatás a beszúrás ELŐTT keres (a rendes eset), ez a `catch` a versenyhelyzetet fogja (két párhuzamos újraküldés): ilyenkor
   * a nyertes sorát adjuk vissza.
   */
  async create(
    input: OperationsLogEntryWrite,
    actorId: string,
  ): Promise<{
    entry: OperationsLogEntryDto;
    recordedById: string;
    created: boolean;
  }> {
    try {
      const row = await prisma.operationsLogEntry.create({
        data: {
          clientOperationId: input.clientOperationId,
          templateId: input.templateId,
          assetId: input.assetId,
          departmentId: input.departmentId,
          templateName: input.templateName,
          frequency: input.frequency,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          recordedById: actorId,
          anomaly: input.anomaly,
          anomalyNote: input.anomalyNote,
          internalNote: input.internalNote,
          participants: {
            create: input.participantIds.map((userId) => ({ userId })),
          },
          values: { create: input.values },
        },
        select: ENTRY_SELECT,
      });
      return { entry: toDto(row), recordedById: actorId, created: true };
    } catch (error) {
      if (isPrismaUniqueConstraintViolation(error, "clientOperationId")) {
        const winner = await this.byClientOperationId(input.clientOperationId);
        if (winner) return { ...winner, created: false };
      }
      throw error;
    }
  }

  /** A bejegyzés, amelyhez kép csatolható: ki rögzítette, és melyik sablonból. */
  async entryRef(id: string) {
    return prisma.operationsLogEntry.findUnique({
      where: { id },
      select: { id: true, recordedById: true, templateId: true },
    });
  }

  async photoByClientOperationId(clientOperationId: string) {
    const row = await prisma.operationsLogEntryDocument.findUnique({
      where: { clientOperationId },
      select: {
        id: true,
        entryId: true,
        fieldKey: true,
        fieldLabel: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        caption: true,
        createdAt: true,
        uploadedById: true,
      },
    });
    return row ? { photo: photoDto(row), ...row } : null;
  }

  async photoCount(entryId: string, fieldKey: string): Promise<number> {
    return prisma.operationsLogEntryDocument.count({
      where: { entryId, fieldKey },
    });
  }

  async addPhoto(input: {
    id: string;
    entryId: string;
    fieldKey: string;
    fieldLabel: string;
    clientOperationId: string | null;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    content: Buffer | null;
    storageKey?: string | null;
    thumbnail: Buffer | null;
    caption: string | null;
    actorUserId: string;
  }): Promise<OperationsLogEntryPhotoDto> {
    const row = await prisma.operationsLogEntryDocument.create({
      data: {
        id: input.id,
        entryId: input.entryId,
        fieldKey: input.fieldKey,
        fieldLabel: input.fieldLabel,
        clientOperationId: input.clientOperationId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        content: input.content ? Uint8Array.from(input.content) : null,
        storageKey: input.storageKey ?? null,
        thumbnail: input.thumbnail ? Uint8Array.from(input.thumbnail) : null,
        caption: input.caption,
        uploadedById: input.actorUserId,
      },
      select: {
        id: true,
        fieldKey: true,
        fieldLabel: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        caption: true,
        createdAt: true,
      },
    });
    return photoDto(row);
  }

  async photo(entryId: string, documentId: string) {
    return prisma.operationsLogEntryDocument.findFirst({
      where: { id: documentId, entryId },
      select: {
        fileName: true,
        contentType: true,
        content: true,
        storageKey: true,
      },
    });
  }

  async photoThumbnail(entryId: string, documentId: string) {
    const row = await prisma.operationsLogEntryDocument.findFirst({
      where: { id: documentId, entryId },
      select: { fileName: true, thumbnail: true },
    });
    return row?.thumbnail
      ? { fileName: row.fileName, thumbnail: row.thumbnail }
      : null;
  }

  /**
   * A BEJEGYZÉS ÉS A HIBAJEGY ÖSSZEKÖTÉSE. Csak akkor ír, ha a bejegyzésnek még nincs jegye (`serviceJobId IS NULL`): két párhuzamos
   * újraküldés közül a második nem írja át az elsőét. `false`: már volt jegye (a hívó a meglévőt olvassa).
   */
  async linkServiceJob(
    entryId: string,
    serviceJobId: string,
  ): Promise<boolean> {
    const result = await prisma.operationsLogEntry.updateMany({
      where: { id: entryId, serviceJobId: null },
      data: { serviceJobId },
    });
    return result.count > 0;
  }

  /** Egy bejegyzés a jegy szövegéhez: amit a jegy leírása hordoz. */
  async ticketContext(entryId: string) {
    return prisma.operationsLogEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        anomaly: true,
        anomalyNote: true,
        templateName: true,
        startedAt: true,
        serviceJobId: true,
        recordedById: true,
        asset: {
          select: {
            id: true,
            assetNumber: true,
            name: true,
            // a hely partnere: az eszköz saját `customerId` mezője denormalizált és hiányozhat, a helyszín partnere nem
            department: { select: { customerId: true } },
          },
        },
      },
    });
  }
}
