import { Injectable, Logger } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import { assetOwnerScopeWhere } from "../service-assets/service-assets.types.js";
import { buildUnitPaths } from "../service-assets/unit-path.js";
import { targetOfRow } from "./template-target.js";
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
  assetCategoryId: true,
  isActive: true,
  uniformRecording: true,
  updatedAt: true,
  assets: {
    select: { asset: { select: { id: true, assetNumber: true, name: true } } },
  },
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
      removedAt: true,
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
  /** A kézzel választott eszközlista (az azonosítók egyediek); üres, ha a cél kategória. */
  assetIds: string[];
  assetCategoryId: string | null;
  /** `undefined`: a módosítás nem változtat a beállításon (a létrehozás mindig megadja). */
  uniformRecording?: boolean;
  fields: OperationsTaskFieldWrite[];
}

/** A mezőt módosította-e közben más: a betöltött `updatedAt` már nem egyezik (409). */
export class OperationsTemplateConflictError extends Error {}

const templateLog = new Logger("OperationsTemplates");

export function toDto(row: TemplateRow): OperationsTaskTemplateDto {
  const target = targetOfRow(row);
  // egy közvetlen írás (import, kézi SQL) kategóriát ÉS eszközlistát is hagyhatott: a felület a kategóriát mutatja, a rögzítés mindkettőt engedi
  if (target.both)
    templateLog.error(
      `A sablon (${row.id}) kategória-célú ÉS eszközlistát is hordoz: szabálysértő sor, a felület csak a kategóriát mutatja, a rögzítés mindkettőt engedi.`,
    );
  const all: OperationsTaskFieldDto[] = row.fields.map((field) => ({
    id: field.id,
    key: field.key,
    label: field.label,
    type: field.type,
    unit: field.unit,
    required: field.required,
    meterRole: field.meterRole,
    sortOrder: field.sortOrder,
    removedAt: field.removedAt ? field.removedAt.toISOString() : null,
  }));
  const fields = all.filter((field) => field.removedAt === null);
  const retiredFields = all.filter((field) => field.removedAt !== null);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    frequency: row.frequency,
    // a szolgáltatás tartja: kategória XOR nem üres eszközlista; a lista az eszköz száma szerint rendezett
    target: target.target,
    isActive: row.isActive,
    uniformRecording: row.uniformRecording,
    fields,
    retiredFields,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A SABLONOK CÉLJAI: az eszközök és a kategóriák azonosítói, ismétlés nélkül. A sablon PONTOSAN egy célra szól (kategória VAGY nem üres
 * eszközlista, a szolgáltatás tartja), de a függvény az üres listájú és kategória nélküli sort is elbírja: semmit nem vesz fel.
 */
export function templateTargets(
  rows: readonly {
    assets: readonly { assetId: string }[];
    assetCategoryId: string | null;
  }[],
): { assetIds: string[]; categoryIds: string[] } {
  const assetIds = new Set<string>();
  const categoryIds = new Set<string>();
  for (const row of rows) {
    for (const entry of row.assets) assetIds.add(entry.assetId);
    if (row.assetCategoryId) categoryIds.add(row.assetCategoryId);
  }
  return { assetIds: [...assetIds], categoryIds: [...categoryIds] };
}

/**
 * A KEZDŐKÉPERNYŐ KATALÓGUSÁNAK EGY ESZKÖZE (kártya f6694b49): amit a telefon a partner, helyszín, eszköz választáshoz olvas. Ugyanaz az
 * alak, mint az eszköz-lista sora azokon a mezőkön (a `unit.path` a gyökértől a helyszínig tartó nevek), hogy a telefon a mentett
 * másolatból (helyszín-letöltés) is ugyanezt a szerkezetet építse.
 */
export interface OperationsStartAsset {
  id: string;
  assetNumber: string;
  name: string;
  category?: string;
  owner: { id: string; displayName: string };
  unit: { id: string; path: string[] };
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

  /**
   * A REGISZTRÁCIÓ KÍNÁLATA EGY ESZKÖZHÖZ: az AKTÍV sablonok, amelyek erre az eszközre VAGY az eszköz kategóriájára szólnak. A
   * kivezetett sablon kiesik (a régi bejegyzései olvashatók maradnak).
   */
  async activeTemplatesForAsset(asset: {
    id: string;
    categoryId: string | null;
  }): Promise<OperationsTaskTemplateDto[]> {
    const rows = await prisma.operationsTaskTemplate.findMany({
      where: {
        isActive: true,
        OR: [
          { assets: { some: { assetId: asset.id } } },
          ...(asset.categoryId ? [{ assetCategoryId: asset.categoryId }] : []),
        ],
      },
      select: TEMPLATE_SELECT,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return rows.map(toDto);
  }

  /**
   * AZ ESZKÖZÖK, AMELYEKHEZ VAN AKTÍV SABLON: a telefon üzemeltetési napló kezdőképernyője ebből szűri a választható gépeket
   * (task f6694b49). UGYANAZ A SZABÁLY, mint az `activeTemplatesForAsset`-é: az eszközre VAGY az eszköz kategóriájára szóló, AKTÍV
   * sablon számít, a kivezetett nem. Az archivált eszköz nem szerepel (a sablonja sem kínál rá semmit).
   *
   * CSAK AZONOSÍTÓKAT ADUNK, és ez szándékos: a láthatóságot (partner, helyszín) a telefon az eszköz-listából hozza, ami a saját
   * hatókör-szűrőjén megy át; ez a lista csak azt mondja meg, melyik azonosítónak van mit rögzíteni. Egy azonosító-halmaz
   * nem hordoz nevet, partnert vagy helyszínt.
   */
  async assetIdsWithActiveTemplates(): Promise<string[]> {
    const templates = await prisma.operationsTaskTemplate.findMany({
      where: { isActive: true },
      select: { assets: { select: { assetId: true } }, assetCategoryId: true },
    });
    const { assetIds, categoryIds } = templateTargets(templates);
    const targets: Prisma.AssetWhereInput[] = [
      ...(assetIds.length ? [{ id: { in: assetIds } }] : []),
      ...(categoryIds.length ? [{ categoryId: { in: categoryIds } }] : []),
    ];
    // az üres `OR` a Prismában semmire sem illeszkedik (nem mindenre), tehát az eredmény ugyanaz lenne; a korai kilépés a felesleges lekérdezést spórolja
    if (targets.length === 0) return [];
    const rows = await prisma.asset.findMany({
      where: { archivedAt: null, OR: targets },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
  }

  /**
   * A KEZDŐKÉPERNYŐ KATALÓGUSA: a szerviz-partnerek AKTÍV, nem archivált eszközei, amelyekhez van aktív sablon (az eszközre vagy a
   * kategóriájára), a partnerrel és a helyszín teljes útjával. A telefon ebből építi a három listát: így a partner és a helyszín
   * is csak akkor szerepel, ha van ott rögzíthető eszköz (Balázs, 2026-11-15: "az OSSZES helyszin megjelenik").
   *
   * A HATÓKÖR UGYANAZ, mint az eszköz-listáé a telefonon (`ownerScope=SERVICE_PARTNER`, `status=ACTIVE`): a rögzítő jog belső
   * szerepeké, és a partner neve és a helyszín útja azokat a mezőket adja, amelyeket az eszköz-lista úgyis. Hely nélküli (nem
   * partner-alegységen álló) eszköz kimarad: nincs mit választani.
   */
  async startCatalogue(): Promise<OperationsStartAsset[]> {
    const templates = await prisma.operationsTaskTemplate.findMany({
      where: { isActive: true },
      select: { assets: { select: { assetId: true } }, assetCategoryId: true },
    });
    const { assetIds, categoryIds } = templateTargets(templates);
    const targets: Prisma.AssetWhereInput[] = [
      ...(assetIds.length ? [{ id: { in: assetIds } }] : []),
      ...(categoryIds.length ? [{ categoryId: { in: categoryIds } }] : []),
    ];
    if (targets.length === 0) return [];
    const rows = await prisma.asset.findMany({
      where: {
        archivedAt: null,
        status: "ACTIVE",
        ...assetOwnerScopeWhere("SERVICE_PARTNER"),
        OR: targets,
      },
      select: {
        id: true,
        assetNumber: true,
        name: true,
        categoryRef: { select: { name: true } },
        supplier: { select: { id: true, name: true } },
        department: {
          select: { id: true, name: true, parentId: true, customerId: true },
        },
      },
      orderBy: { id: "asc" },
    });
    const customerIds = [
      ...new Set(
        rows
          .map((row) => row.department?.customerId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const units = customerIds.length
      ? await prisma.worksheetDepartment.findMany({
          where: { customerId: { in: customerIds } },
          select: { id: true, name: true, parentId: true },
        })
      : [];
    const paths = buildUnitPaths(units);
    const out: OperationsStartAsset[] = [];
    for (const row of rows) {
      if (!row.supplier || !row.department) continue;
      out.push({
        id: row.id,
        assetNumber: row.assetNumber,
        name: row.name,
        ...(row.categoryRef ? { category: row.categoryRef.name } : {}),
        owner: { id: row.supplier.id, displayName: row.supplier.name },
        unit: {
          id: row.department.id,
          path: paths.get(row.department.id) ?? [row.department.name],
        },
      });
    }
    return out;
  }

  async templateById(id: string): Promise<OperationsTaskTemplateDto | null> {
    const row = await prisma.operationsTaskTemplate.findUnique({
      where: { id },
      select: TEMPLATE_SELECT,
    });
    return row ? toDto(row) : null;
  }

  /**
   * A sablon mezőinek kulcsai: az AKTÍVAK és a VALAHA HASZNÁLTAK (a kivezetetteké is). A kulcs-kiosztás ezekből dolgozik:
   * egy új mező nem kaphatja egy elhagyott mező kulcsát. `null`: a sablon nem található.
   */
  async fieldKeys(id: string): Promise<{
    used: Set<string>;
    active: Set<string>;
    /** Az AKTÍV mezők típusa kulcs szerint: a típusváltás nem írhatja át ugyanazt a kulcsot (barracuda, #2499). */
    typeOf: Map<string, OperationsTaskFieldType>;
  } | null> {
    const row = await prisma.operationsTaskTemplate.findUnique({
      where: { id },
      select: {
        fields: { select: { key: true, type: true, removedAt: true } },
      },
    });
    if (!row) return null;
    const active = row.fields.filter((f) => f.removedAt === null);
    return {
      used: new Set(row.fields.map((field) => field.key)),
      active: new Set(active.map((f) => f.key)),
      typeOf: new Map(active.map((f) => [f.key, f.type])),
    };
  }

  /** Az átadott azonosítók közül azok, amelyek eszköze létezik és nem archivált (a sablon csak élő eszközre szólhat). */
  async liveAssetIds(assetIds: readonly string[]): Promise<Set<string>> {
    const rows = await prisma.asset.findMany({
      where: { id: { in: [...assetIds] }, archivedAt: null },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
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
        assetCategoryId: input.assetCategoryId,
        uniformRecording: input.uniformRecording ?? false,
        createdById: actorId,
        updatedById: actorId,
        assets: {
          create: input.assetIds.map((assetId) => ({ assetId })),
        },
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
   * A SABLON ÉS A TELJES MEZŐKÉSZLET EGY TRANZAKCIÓBAN. A mezőket a KULCSUK szerint egyeztetjük: az AKTÍV mező frissül (a kulcsa és
   * az azonosítója marad), az új létrejön, az aktív, de a listából kimaradt mező KIVEZETÉST kap (`removedAt`), nem törlődik
   * (barracuda, #2497: a kulcsa soha nem kerül másik mezőhöz, a definíciója olvasható marad a régi bejegyzésekhez). Az AKTÍV
   * mezők vízóra szerepét ELŐBB lenullázzuk: a sablononkénti egyedi (előtte, utána) index egy szerep-cserénél a köztes állapotban
   * sértené magát; a kivezetett mező megtartja a szerepét, és az index rá nem szól.
   * Az `expectedUpdatedAt` az egyidejűség-őr: ha a sablont közben más módosította, `OperationsTemplateConflictError`.
   * `null`: a sablon nem található.
   */
  async replaceTemplate(
    id: string,
    input: OperationsTaskTemplateWrite & {
      isActive?: boolean;
      expectedUpdatedAt?: string | null;
    },
    actorId: string,
  ): Promise<OperationsTaskTemplateDto | null> {
    return prisma.$transaction(async (tx) => {
      // a sor zárja: két egyszerre induló módosítás közül a második megvárja az elsőt, és az új `updatedAt`-ot látja (409)
      await tx.$queryRaw`SELECT "id" FROM "OperationsTaskTemplate" WHERE "id" = ${id} FOR UPDATE`;
      const existing = await tx.operationsTaskTemplate.findUnique({
        where: { id },
        select: {
          updatedAt: true,
          fields: { select: { id: true, key: true, removedAt: true } },
        },
      });
      if (!existing) return null;
      if (
        input.expectedUpdatedAt &&
        new Date(input.expectedUpdatedAt).getTime() !==
          existing.updatedAt.getTime()
      )
        throw new OperationsTemplateConflictError();
      const active = existing.fields.filter(
        (field) => field.removedAt === null,
      );
      const keep = new Set(input.fields.map((field) => field.key));
      // ELŐBB a kimaradt mezők kivezetése: a kivezetett mező MEGTARTJA a vízóra szerepét (a régi bejegyzések kimutatásához), és
      // a részleges egyedi index rá már nem szól (barracuda, #2497 v2)
      const dropped = active
        .filter((field) => !keep.has(field.key))
        .map((field) => field.id);
      if (dropped.length > 0)
        await tx.operationsTaskField.updateMany({
          where: { id: { in: dropped } },
          data: { removedAt: new Date() },
        });
      // UTÁNA a MARADÓ aktív mezők szerepének lenullázása: a szerep-csere köztes állapota nem sértheti az indexet
      await tx.operationsTaskField.updateMany({
        where: { templateId: id, removedAt: null },
        data: { meterRole: null },
      });
      const idByKey = new Map(active.map((field) => [field.key, field.id]));
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
      await tx.operationsTaskTemplate.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          frequency: input.frequency,
          assetCategoryId: input.assetCategoryId,
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...(input.uniformRecording === undefined
            ? {}
            : { uniformRecording: input.uniformRecording }),
          updatedById: actorId,
        },
        select: { id: true },
      });
      // A CÉL CSERÉJE ugyanabban a tranzakcióban, a sor zárja alatt: a lista a megadottra áll (a kategória-célnál üres)
      await tx.operationsTaskTemplateAsset.deleteMany({
        where: {
          templateId: id,
          ...(input.assetIds.length > 0
            ? { assetId: { notIn: input.assetIds } }
            : {}),
        },
      });
      if (input.assetIds.length > 0)
        await tx.operationsTaskTemplateAsset.createMany({
          data: input.assetIds.map((assetId) => ({ templateId: id, assetId })),
          skipDuplicates: true,
        });
      const reread = await tx.operationsTaskTemplate.findUniqueOrThrow({
        where: { id },
        select: TEMPLATE_SELECT,
      });
      return toDto(reread);
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
