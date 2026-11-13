import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import {
  personDisplayName,
  type OperationsReportEntryInput,
  type OperationsReportScheduleInput,
} from "@acropora/types";

import { collectUnitSubtreeIds } from "../service-assets/unit-subtree.js";

/** Melyik bejegyzések kerülnek a kimutatás SORAI közé. */
export type OperationsReportEntryFilter =
  /** A helyszín (részfájával) a RÖGZÍTÉSKOR: az archivált és az áthelyezett eszköz múltja is a helyén marad. */
  | { departmentIds: readonly string[] }
  /** Egyetlen eszköz bejegyzései. */
  | { assetId: string }
  /** Ezeknek az eszközöknek a bejegyzései, helyszíntől függetlenül (a „kimaradt" számításhoz: a heti feladat egy áthelyezés előtt is teljesült). */
  | { assetIds: readonly string[] };

export interface OperationsReportScope {
  /** A helyszín (és a partner) neve a kimutatás fejlécéhez; `null`, ha egy eszközre kértük. */
  siteLabel: string | null;
  /**
   * AZ ÉLŐ ESZKÖZÖK (az archivált nem): az ütemezett sablonok ezekre bontódnak ki, mert egy archivált eszközön már nincs mi
   * esedékes. A sorok viszont NEM ebből állnak, hanem a bejegyzések rögzítéskori helyszínéből (`entryFilter`): a kimutatás bizonyíték,
   * és a múltja nem változhat egy későbbi archiválástól vagy áthelyezéstől.
   */
  assets: { id: string; label: string; categoryId: string | null }[];
  entryFilter: OperationsReportEntryFilter;
}

/**
 * A HAVI KIMUTATÁS ADATAI (task os-uzemeltetesi-naplo, S4): a hatókör eszközei, a bejegyzések és az ütemezett sablonok. Csak olvas.
 * A számítást a közös `buildOperationsReport` végzi (`@acropora/types`): ez a réteg csak a sorokat hozza a bemenet alakjára.
 */
@Injectable()
export class OperationsReportRepository {
  /**
   * A HATÓKÖR: egy HELYSZÍN (és a részfája: a „Biodóm" a Nagy medencén lógó eszközöket is magában foglalja) vagy egy eszköz. Az
   * archivált eszköz nem számít. `null`: a helyszín vagy az eszköz nem található.
   */
  async scope(input: {
    departmentId?: string;
    assetId?: string;
  }): Promise<OperationsReportScope | null> {
    if (input.assetId) {
      const asset = await prisma.asset.findUnique({
        where: { id: input.assetId },
        select: {
          id: true,
          assetNumber: true,
          name: true,
          categoryId: true,
          archivedAt: true,
        },
      });
      if (!asset) return null;
      return {
        siteLabel: null,
        entryFilter: { assetId: asset.id },
        assets: [
          {
            id: asset.id,
            label: `${asset.assetNumber} ${asset.name}`,
            categoryId: asset.categoryId,
          },
        ],
      };
    }
    const root = await prisma.worksheetDepartment.findUnique({
      where: { id: input.departmentId },
      select: {
        id: true,
        name: true,
        customerId: true,
        customer: { select: { displayName: true } },
      },
    });
    if (!root) return null;
    const units = await prisma.worksheetDepartment.findMany({
      where: { customerId: root.customerId },
      select: { id: true, name: true, parentId: true },
    });
    const subtree = collectUnitSubtreeIds(units, root.id);
    const assets = await prisma.asset.findMany({
      where: { departmentId: { in: subtree }, archivedAt: null },
      select: { id: true, assetNumber: true, name: true, categoryId: true },
      orderBy: [{ assetNumber: "asc" }, { id: "asc" }],
    });
    return {
      siteLabel: `${root.customer.displayName} · ${root.name}`,
      entryFilter: { departmentIds: subtree },
      assets: assets.map((asset) => ({
        id: asset.id,
        label: `${asset.assetNumber} ${asset.name}`,
        categoryId: asset.categoryId,
      })),
    };
  }

  /** A szűrőnek megfelelő bejegyzések a megadott időszakban (a kezdés szerint; a vége kizárt). */
  async entries(
    filter: OperationsReportEntryFilter,
    from: Date,
    to: Date,
  ): Promise<OperationsReportEntryInput[]> {
    const where =
      "departmentIds" in filter
        ? { departmentId: { in: [...filter.departmentIds] } }
        : "assetIds" in filter
          ? { assetId: { in: [...filter.assetIds] } }
          : { assetId: filter.assetId };
    if (
      ("departmentIds" in filter && filter.departmentIds.length === 0) ||
      ("assetIds" in filter && filter.assetIds.length === 0)
    )
      return [];
    const rows = await prisma.operationsLogEntry.findMany({
      where: { ...where, startedAt: { gte: from, lt: to } },
      select: {
        id: true,
        templateId: true,
        templateName: true,
        frequency: true,
        assetId: true,
        startedAt: true,
        finishedAt: true,
        anomaly: true,
        anomalyNote: true,
        asset: { select: { assetNumber: true, name: true } },
        serviceJob: { select: { jobNumber: true, status: true } },
        participants: {
          select: {
            user: { select: { displayName: true, nickname: true } },
          },
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
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      templateId: row.templateId,
      templateName: row.templateName,
      frequency: row.frequency,
      assetId: row.assetId,
      assetLabel: `${row.asset.assetNumber} ${row.asset.name}`,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt.toISOString(),
      participantNames: row.participants
        .map((participant) => personDisplayName(participant.user))
        .sort((a, b) => a.localeCompare(b, "hu")),
      anomaly: row.anomaly,
      anomalyNote: row.anomalyNote,
      serviceJob: row.serviceJob,
      values: row.values.map((value) => ({
        fieldKey: value.fieldKey,
        label: value.label,
        unit: value.unit,
        meterRole: value.meterRole,
        value:
          value.fieldType === "NUMBER"
            ? value.numberValue!.toNumber()
            : value.fieldType === "BOOLEAN"
              ? value.booleanValue!
              : value.textValue!,
      })),
    }));
  }

  /**
   * AZ ÜTEMEZETT SABLONOK A HATÓKÖR ESZKÖZEIN: a sablon az eszközre VAGY az eszköz kategóriájára szól (a kategória-sablon minden ilyen
   * kategóriájú eszközre külön esedékes). Csak a napi és a heti számít; a kivezetett sablont a számítás úgyis kihagyja, itt a
   * `isActive` jelzésként megy át.
   */
  async schedules(
    assets: readonly { id: string; label: string; categoryId: string | null }[],
  ): Promise<OperationsReportScheduleInput[]> {
    if (assets.length === 0) return [];
    const categoryIds = [
      ...new Set(
        assets.flatMap((asset) => (asset.categoryId ? [asset.categoryId] : [])),
      ),
    ];
    const templates = await prisma.operationsTaskTemplate.findMany({
      where: {
        frequency: { in: ["DAILY", "WEEKLY"] },
        OR: [
          { assetId: { in: assets.map((asset) => asset.id) } },
          ...(categoryIds.length > 0
            ? [{ assetCategoryId: { in: categoryIds } }]
            : []),
        ],
      },
      select: {
        id: true,
        name: true,
        frequency: true,
        isActive: true,
        createdAt: true,
        assetId: true,
        assetCategoryId: true,
      },
    });
    return templates.flatMap((template) =>
      assets
        .filter((asset) =>
          template.assetId
            ? template.assetId === asset.id
            : template.assetCategoryId !== null &&
              template.assetCategoryId === asset.categoryId,
        )
        .map((asset) => ({
          templateId: template.id,
          templateName: template.name,
          frequency: template.frequency,
          isActive: template.isActive,
          createdAt: template.createdAt.toISOString(),
          assetId: asset.id,
          assetLabel: asset.label,
        })),
    );
  }
}
