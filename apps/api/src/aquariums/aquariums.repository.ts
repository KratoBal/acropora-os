import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type {
  AquariumDetail,
  AquariumEquipment,
  AquariumListResponse,
  AquariumMeasurementParameterCode,
  AquariumMeasurementTarget,
  AquariumSelectableCustomerListResponse,
  AquariumSummary,
} from "@acropora/types";

import { withUniqueCode } from "../common/unique-code.util.js";
import { retryOnSerializationConflict } from "../common/transaction-retry.util.js";
import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { resolveAquariumVolume } from "./aquarium-volume.js";
import type {
  CreateAquariumDto,
  UpdateAquariumDto,
} from "./dto/aquarium.dto.js";

const detailInclude = {
  customer: {
    select: { id: true, displayName: true, phone: true, email: true },
  },
  department: { select: { id: true, name: true } },
  equipment: { orderBy: { createdAt: "asc" as const } },
  maintainers: {
    orderBy: { createdAt: "asc" as const },
    include: { user: { select: { id: true, displayName: true } } },
  },
  targets: { orderBy: { parameterCode: "asc" as const } },
} satisfies Prisma.AquariumInclude;

type AquariumDetailRow = Prisma.AquariumGetPayload<{
  include: typeof detailInclude;
}>;

/**
 * A `measurements` ÉS A `maintainers` A LISTA-PILOT KÉRÉSÉRE KERÜLT IDE
 * (acrobot, 2026-09-24 16:19): a Figma terv lista-oszlopai ("Karbantartók",
 * "Utolsó vízmérés") ezt igényelték, és korábban csak a `detailInclude`
 * ismerte őket.
 *
 * MINDKETTŐ EGY-EGY BATCH-ELT LEKÉRDEZÉS, NEM SORONKÉNTI: a Prisma egy
 * `findMany`-hez tartozó `include`-ot -- take/orderBy-jal együtt is -- EGY
 * kiegészítő lekérdezésként oldja fel (WHERE aquariumId IN (...) egy
 * ROW_NUMBER()-ablakfüggvénnyel a `take: 1`-hez), a lapméret (25) nem a
 * lekérdezések számát szorozza, csak az IN-lista hosszát.
 */
const listInclude = {
  customer: { select: { id: true, displayName: true } },
  department: { select: { id: true, name: true } },
  _count: { select: { equipment: true } },
  maintainers: {
    include: { user: { select: { id: true, displayName: true } } },
  },
  measurements: {
    take: 1,
    orderBy: { measuredAt: "desc" as const },
    select: { measuredAt: true },
  },
} satisfies Prisma.AquariumInclude;

type AquariumListRow = Prisma.AquariumGetPayload<{
  include: typeof listInclude;
}>;

function optionalText(value: string | undefined | null) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
}

function toEquipment(
  row: AquariumDetailRow["equipment"][number],
): AquariumEquipment {
  return {
    id: row.id,
    kind: row.kind,
    manufacturer: row.manufacturer ?? undefined,
    model: row.model ?? undefined,
    quantity: row.quantity,
    channelCount: row.channelCount ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function toSummary(row: AquariumListRow): AquariumSummary {
  return {
    id: row.id,
    aquariumNumber: row.aquariumNumber,
    name: row.name,
    ownershipType: row.ownershipType === "STORE" ? "OWN" : row.ownershipType,
    waterBodyType: row.waterBodyType,
    waterType: row.waterType ?? undefined,
    customerId: row.customer?.id,
    customerName: row.customer?.displayName,
    departmentId: row.department?.id,
    departmentName: row.department?.name,
    systemVolumeLiters: row.systemVolumeLiters?.toNumber(),
    equipmentCount: row._count.equipment,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    maintainers: row.maintainers.map((m) => ({
      userId: m.user.id,
      displayName: m.user.displayName,
    })),
    lastMeasuredAt: row.measurements[0]?.measuredAt.toISOString(),
  };
}

function toTarget(
  row: AquariumDetailRow["targets"][number],
): AquariumMeasurementTarget {
  return {
    parameterCode: row.parameterCode as AquariumMeasurementParameterCode,
    min: row.min?.toNumber(),
    max: row.max?.toNumber(),
  };
}

/**
 * A `canAssignAssets` MEZŐ EBBŐL A FÜGGVÉNYBŐL SZÁNDÉKOSAN HIÁNYZIK -- ez a
 * függvény egy Prisma-sorból épít adatlapot, a felhasználó-specifikus
 * képesség-jelölő viszont NEM a soron áll, hanem a hívó azonosítóján.
 * A hívó (`AquariumsService`) minden végpont-visszatérésen KÖTELEZŐEN ráteszi
 * (lásd `withCanAssignAssets` fejlécét ott) -- enélkül a mező NÉMÁN hiányozna
 * a válaszból, a kliens típusa pedig kötelezőnek hazudná.
 */
function toDetail(
  row: AquariumDetailRow,
): Omit<AquariumDetail, "canAssignAssets"> {
  return {
    id: row.id,
    aquariumNumber: row.aquariumNumber,
    name: row.name,
    ownershipType: row.ownershipType === "STORE" ? "OWN" : row.ownershipType,
    waterBodyType: row.waterBodyType,
    customerId: row.customer?.id,
    customerName: row.customer?.displayName,
    departmentId: row.department?.id,
    departmentName: row.department?.name,
    customerPhone: row.customer?.phone ?? undefined,
    customerEmail: row.customer?.email ?? undefined,
    systemVolumeLiters: row.systemVolumeLiters?.toNumber(),
    equipmentCount: row.equipment.length,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lengthCm: row.lengthCm?.toNumber(),
    widthCm: row.widthCm?.toNumber(),
    heightCm: row.heightCm?.toNumber(),
    systemVolumeIsManual: row.systemVolumeIsManual,
    waterType: row.waterType ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    notes: row.notes ?? undefined,
    equipment: row.equipment.map(toEquipment),
    maintainers: row.maintainers.map((m) => ({
      userId: m.user.id,
      displayName: m.user.displayName,
    })),
    // SZÁRMAZTATOTT, NEM A TÁROLT `maintainedByUs` OSZLOPBÓL -- lásd a
    // séma `AquariumMaintainer` fejlécét.
    maintainedByUs: row.maintainers.length > 0,
    targets: row.targets.map(toTarget),
  };
}

@Injectable()
export class AquariumsRepository {
  /**
   * A `visibility` KÜLÖN PARAMÉTER, NEM A `query` RÉSZE -- és ez a
   * `partner-scope.util.ts` szabálya szerint kötelező alak: a hatókört
   * `AND` ágként kötjük be, SOHA nem közös kulcsként a felhasználói
   * szűrőkkel, különben egy később spreadelt felhasználói `customerId`
   * csendben felülírhatná a jogosultságit. Lásd `aquarium-visibility.ts`.
   */
  async list(
    query: {
      page: number;
      pageSize: number;
      search?: string;
      ownershipType?: "OWN" | "CUSTOMER";
      waterBodyType?: "AKVARIUM" | "TO";
      customerId?: string;
    },
    visibility: Prisma.AquariumWhereInput = {},
  ): Promise<AquariumListResponse> {
    const filters: Prisma.AquariumWhereInput = {
      isActive: true,
      ...(query.ownershipType ? { ownershipType: query.ownershipType } : {}),
      ...(query.waterBodyType ? { waterBodyType: query.waterBodyType } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              {
                aquariumNumber: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                customer: {
                  displayName: { contains: query.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const where: Prisma.AquariumWhereInput = { AND: [filters, visibility] };
    const [rows, totalItems] = await Promise.all([
      prisma.aquarium.findMany({
        where,
        include: listInclude,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.aquarium.count({ where }),
    ]);
    return {
      items: rows.map(toSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  /**
   * `findFirst`, NEM `findUnique` -- A HATÓKÖR-SZŰRÉS MIATT.
   *
   * A `findUnique` csak egyedi mezőkből épített `where`-t fogad, egy
   * `AND`-be csomagolt extra feltételt nem. `visibility` alapértéke `{}`
   * (üres `AND`-ág), tehát a belsős hívók (nincs `visibility` átadva)
   * viselkedése változatlan marad.
   */
  async detail(
    id: string,
    visibility: Prisma.AquariumWhereInput = {},
  ): Promise<Omit<AquariumDetail, "canAssignAssets"> | null> {
    const row = await prisma.aquarium.findFirst({
      where: { AND: [{ id }, visibility] },
      include: detailInclude,
    });
    return row ? toDetail(row) : null;
  }

  /**
   * A MEGLÉVŐ ÜGYFÉL KERESÉSE, AZ AKVÁRIUM FELVITEL VÁLASZTÓJÁHOZ.
   *
   * Lásd `AquariumSelectableCustomer` fejlécét (`@acropora/types`): ez a
   * lekérdezés `aquariums.view` alatt fut, mert a mobil `SERVICE` szerepkör
   * nem éri el a `/customers`-t. Legfeljebb 20 találat, csak aktív, nem
   * partner-tulajdonú ügyfél (ugyanaz a szűrés, mint a `customers.repository`
   * `partner: null` során -- egy szerviz partner saját munkalap-vevő sora nem
   * akvárium-tulajdonos).
   *
   * A VÁROS A LEGKÖZELEBBI ALAPÉRTELMEZETT CÍMBŐL jön (`isDefault` első,
   * aztán a legrégebbi), egyetlen lekérdezésben -- nem a teljes cím-formázás
   * (`customers.repository.ts` `formatAddress`), csak a megkülönböztetéshez
   * elég egy mező.
   */
  async searchSelectableCustomers(
    search?: string,
  ): Promise<AquariumSelectableCustomerListResponse> {
    const rows = await prisma.customer.findMany({
      where: {
        partner: null,
        isActive: true,
        ...(search
          ? { displayName: { contains: search, mode: "insensitive" } }
          : {}),
      },
      select: {
        id: true,
        displayName: true,
        addresses: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          take: 1,
          select: { city: true },
        },
      },
      orderBy: { displayName: "asc" },
      take: 20,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        city: row.addresses[0]?.city,
      })),
    };
  }

  /**
   * A HELYSZÍNI FELVITEL MŰVELET-AZONOSÍTÓJÁHOZ TARTOZÓ AKVÁRIUM, HA MÁR
   * LÉTEZIK.
   *
   * KÜLÖN METÓDUS, NEM CSAK A `create()` BELSEJÉBEN, mert a szolgáltatás
   * (`AquariumsService.create()`) IS hívja, MÉGELŐTT az új ügyfelet
   * létrehozná -- lásd ott a fejlécet, miért nem elég a `create()` saját,
   * írás-időpontbeli védelme erre az esetre.
   */
  async byClientOperationId(
    clientOperationId: string,
  ): Promise<Omit<AquariumDetail, "canAssignAssets"> | null> {
    const row = await prisma.aquarium.findUnique({
      where: { clientOperationId },
      include: detailInclude,
    });
    return row ? toDetail(row) : null;
  }

  /**
   * IGAZ, HA A HELYSZÍN UGYANAHHOZ AZ ÜGYFÉLHEZ TARTOZIK.
   *
   * Ugyanaz a minta, mint a `worksheets.repository.ts` szülő-ellenőrzése
   * (`worksheetDepartment.findFirst({ where: { id, customerId } })`): az
   * idegen kulcs csak a LÉTEZÉST nézi, a tulajdonost nem -- ezt a
   * szolgáltatás-rétegnek kell ellenőriznie, mielőtt egy `departmentId`
   * bekerül egy akvárium sorára. Lásd az `Aquarium.departmentId`
   * séma-fejlécét, miért fontos, hogy a kettő sose csússzon el egymástól.
   */
  async departmentBelongsToCustomer(
    departmentId: string,
    customerId: string,
  ): Promise<boolean> {
    const row = await prisma.worksheetDepartment.findFirst({
      where: { id: departmentId, customerId },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * A SZÁMOZÁS AZ ESZKÖZSZÁM/VEVŐSZÁM MINTÁJÁT KÖVETI: `withUniqueCode`
   * húzza a kódot, és a tranzakció ütközésekor ÚJ kóddal próbálkozik újra --
   * lásd a `customers.repository.ts` és a `service-assets.repository.ts`
   * saját fejlécét ugyanerről.
   *
   * A TELJES TRANZAKCIÓ ÚJRAPRÓBÁLKOZIK EGY VALÓDI SERIALIZABLE-ÜTKÖZÉSEN
   * (P2034) IS, ugyanazzal az indokkal és ugyanazzal a segéddel, mint a
   * `service-assets.repository.ts` `create()`-je.
   *
   * A `clientOperationId` VÉDELME KÉT RÉTEGŰ, UGYANAZZAL AZ INDOKKAL, MINT A
   * `worksheets.repository.ts` `createDraft()`-ja: a keresés a létrehozás
   * ELŐTT fogja meg a rendes esetet (a kulcs már ismert), a `catch`-ben álló
   * második keresés pedig a VERSENYHELYZETET (két párhuzamos kérés a
   * keresés és a beszúrás között csúszik el) -- azt kizárólag az egyedi
   * index tudja elvágni, a keresés önmagában nem.
   *
   * AZ `_actorUserId` MA NEM ÍRÓDIK SEHOVA -- az `Aquarium` modellen nincs
   * `createdById` mező, és ehhez a körhöz nem tartozik saját eseménynapló
   * (`AquariumEvent`-féle tábla nincs). A paraméter azért marad a hívási
   * láncban (controller -> service -> repository), mert a többi modul
   * (`customers`, `service-assets`) ugyanígy adja tovább -- ha egyszer
   * auditnapló kerül ide, nem kell újra végigvinni az aláírást.
   */
  async create(
    input: Omit<CreateAquariumDto, "customerId" | "newCustomer"> & {
      customerId: string | null;
    },
    _actorUserId: string,
  ): Promise<Omit<AquariumDetail, "canAssignAssets">> {
    if (input.clientOperationId) {
      const meglevo = await this.byClientOperationId(input.clientOperationId);
      if (meglevo) return meglevo;
    }

    const volume = resolveAquariumVolume({
      lengthCm: input.lengthCm ?? null,
      widthCm: input.widthCm ?? null,
      heightCm: input.heightCm ?? null,
      volumeLiters: input.systemVolumeLiters ?? null,
      isManual: input.systemVolumeIsManual ?? false,
    });
    try {
      return await withUniqueCode(
        { prefix: "AKV", field: "aquariumNumber" },
        (aquariumNumber) =>
          retryOnSerializationConflict(() =>
            prisma.$transaction(
              async (tx) => {
                const row = await tx.aquarium.create({
                  data: {
                    aquariumNumber,
                    clientOperationId: input.clientOperationId ?? null,
                    customerId: input.customerId,
                    departmentId: input.departmentId ?? null,
                    name: input.name.trim(),
                    ownershipType: input.ownershipType,
                    waterBodyType: input.waterBodyType,
                    lengthCm: input.lengthCm ?? null,
                    widthCm: input.widthCm ?? null,
                    heightCm: input.heightCm ?? null,
                    systemVolumeLiters: volume.systemVolumeLiters,
                    systemVolumeIsManual: volume.systemVolumeIsManual,
                    waterType: input.waterType ?? null,
                    startedAt: input.startedAt
                      ? new Date(input.startedAt)
                      : null,
                    notes: optionalText(input.notes),
                    equipment: {
                      create: input.equipment.map((eq) => ({
                        kind: eq.kind,
                        manufacturer: optionalText(eq.manufacturer),
                        model: optionalText(eq.model),
                        quantity: eq.quantity ?? 1,
                        channelCount: eq.channelCount ?? null,
                        notes: optionalText(eq.notes),
                      })),
                    },
                    targets: {
                      create: input.targets
                        .filter(
                          (t) => t.min !== undefined || t.max !== undefined,
                        )
                        .map((t) => ({
                          parameterCode: t.parameterCode,
                          min: t.min ?? null,
                          max: t.max ?? null,
                        })),
                    },
                  },
                  include: detailInclude,
                });
                return toDetail(row);
              },
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            ),
          ),
      );
    } catch (error) {
      /**
       * A SZŰRÉS SZŰK: kizárólag a `clientOperationId` ütközése. Bármi más
       * VALÓDI hiba, és hangosan kell elbuknia -- ugyanaz a szabály, mint a
       * `worksheets.repository.ts`-ben.
       */
      if (
        input.clientOperationId &&
        isPrismaUniqueConstraintViolation(error, "clientOperationId")
      ) {
        const meglevo = await this.byClientOperationId(input.clientOperationId);
        if (meglevo) return meglevo;
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateAquariumDto,
    _actorUserId: string,
  ): Promise<Omit<AquariumDetail, "canAssignAssets">> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.aquarium.findUniqueOrThrow({ where: { id } });

      const dimensionsGiven =
        input.lengthCm !== undefined ||
        input.widthCm !== undefined ||
        input.heightCm !== undefined;
      const volumeGiven =
        input.systemVolumeLiters !== undefined ||
        input.systemVolumeIsManual !== undefined;
      const volume =
        dimensionsGiven || volumeGiven
          ? resolveAquariumVolume({
              lengthCm:
                input.lengthCm !== undefined
                  ? input.lengthCm
                  : existing.lengthCm,
              widthCm:
                input.widthCm !== undefined ? input.widthCm : existing.widthCm,
              heightCm:
                input.heightCm !== undefined
                  ? input.heightCm
                  : existing.heightCm,
              volumeLiters:
                input.systemVolumeLiters !== undefined
                  ? input.systemVolumeLiters
                  : existing.systemVolumeLiters,
              isManual:
                input.systemVolumeIsManual !== undefined
                  ? input.systemVolumeIsManual
                  : existing.systemVolumeIsManual,
            })
          : null;

      const changed = await tx.aquarium.updateMany({
        where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
        data: {
          ownershipType: input.ownershipType,
          customerId: input.customerId,
          departmentId: input.departmentId,
          name: input.name?.trim(),
          waterBodyType: input.waterBodyType,
          lengthCm: input.lengthCm,
          widthCm: input.widthCm,
          heightCm: input.heightCm,
          ...(volume
            ? {
                systemVolumeLiters: volume.systemVolumeLiters,
                systemVolumeIsManual: volume.systemVolumeIsManual,
              }
            : {}),
          waterType: input.waterType,
          startedAt:
            input.startedAt !== undefined
              ? input.startedAt
                ? new Date(input.startedAt)
                : null
              : undefined,
          notes: optionalText(input.notes),
          isActive: input.isActive,
        },
      });
      if (changed.count === 0) throw new Error("STALE_UPDATE");

      /**
       * A CÉLTARTOMÁNYOK KÜLÖN SZINKRONIZÁLÓDNAK, NEM A FENTI
       * `updateMany`-BEN: relációs kapcsolat, saját kulccsal
       * (`parameterCode`), tehát nem egyetlen oszlop-írás.
       *
       * HIÁNYZÓ `input.targets` (a mező sincs a törzsben) A MEGLÉVŐ SOROKAT
       * VÁLTOZATLANUL HAGYJA -- ugyanaz az elv, mint a szerződés-tételeknél
       * (`contracts.service.ts` `update()`), csak itt a kulcs a
       * `parameterCode`, nem egy generált id, tehát nincs "9 tétel"-szerű
       * id-csere kockázat: egy paraméter mindig UGYANAZT a sort találja meg.
       *
       * EGY, MINDKÉT OLDALÁN ÜRES SOR (min és max is hiányzik) TÖRLÉST
       * JELENT -- a felület nem küld ilyet szándékosan, de a szerver nem
       * bízik ebben: egy törölt bemenetnek nincs értelme tárolt sorként.
       */
      if (input.targets !== undefined) {
        const keepCodes = input.targets
          .filter((t) => t.min !== undefined || t.max !== undefined)
          .map((t) => t.parameterCode);
        await tx.aquariumMeasurementTarget.deleteMany({
          where: {
            aquariumId: id,
            ...(keepCodes.length > 0
              ? { parameterCode: { notIn: keepCodes } }
              : {}),
          },
        });
        for (const target of input.targets) {
          if (target.min === undefined && target.max === undefined) continue;
          await tx.aquariumMeasurementTarget.upsert({
            where: {
              aquariumId_parameterCode: {
                aquariumId: id,
                parameterCode: target.parameterCode,
              },
            },
            create: {
              aquariumId: id,
              parameterCode: target.parameterCode,
              min: target.min ?? null,
              max: target.max ?? null,
            },
            update: {
              min: target.min ?? null,
              max: target.max ?? null,
            },
          });
        }
      }

      const row = await tx.aquarium.findUniqueOrThrow({
        where: { id },
        include: detailInclude,
      });
      return toDetail(row);
    });
  }

  async addEquipment(
    aquariumId: string,
    eq: {
      kind: Prisma.AquariumEquipmentCreateInput["kind"];
      manufacturer?: string;
      model?: string;
      quantity?: number;
      channelCount?: number;
      notes?: string;
    },
  ): Promise<Omit<AquariumDetail, "canAssignAssets">> {
    await prisma.aquariumEquipment.create({
      data: {
        aquariumId,
        kind: eq.kind,
        manufacturer: optionalText(eq.manufacturer),
        model: optionalText(eq.model),
        quantity: eq.quantity ?? 1,
        channelCount: eq.channelCount ?? null,
        notes: optionalText(eq.notes),
      },
    });
    const row = await prisma.aquarium.findUniqueOrThrow({
      where: { id: aquariumId },
      include: detailInclude,
    });
    return toDetail(row);
  }

  async removeEquipment(
    aquariumId: string,
    equipmentId: string,
  ): Promise<Omit<AquariumDetail, "canAssignAssets">> {
    await prisma.aquariumEquipment.delete({
      where: { id: equipmentId, aquariumId },
    });
    const row = await prisma.aquarium.findUniqueOrThrow({
      where: { id: aquariumId },
      include: detailInclude,
    });
    return toDetail(row);
  }

  /**
   * VAN-E BEJELÖLVE A HÍVÓNÁL AZ ESZKÖZ-AKVÁRIUM HOZZÁRENDELÉS KÉPESSÉGE.
   *
   * SZÁNDÉKOSAN DUPLIKÁLT, NEM A `ServiceAssetsRepository` AZONOS NEVŰ
   * METÓDUSÁNAK ÚJRAFELHASZNÁLÁSA -- lásd ott a fejlécet a mintáról
   * (`MaterialRequestsRepository.hasMarkReceivedCapability`). Egy
   * cross-module import (aquariums -> service-assets) egy generikus,
   * felhasználó+képesség lekérdezésért túl szoros csatolás lenne; ez a
   * repó máshol is inkább az apró, ismétlődő lekérdezést választja a
   * megosztott absztrakció helyett.
   */
  async hasAquariumAssetAssignCapability(userId: string): Promise<boolean> {
    const row = await prisma.userServiceCapability.findUnique({
      where: {
        userId_capability: {
          userId,
          capability: "AQUARIUM_ASSET_ASSIGN",
        },
      },
    });
    return row !== null;
  }
}
