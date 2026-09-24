import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type {
  AquariumDetail,
  AquariumEquipment,
  AquariumListResponse,
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
  equipment: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.AquariumInclude;

type AquariumDetailRow = Prisma.AquariumGetPayload<{
  include: typeof detailInclude;
}>;

const listInclude = {
  customer: { select: { id: true, displayName: true } },
  _count: { select: { equipment: true } },
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
    customerId: row.customer?.id,
    customerName: row.customer?.displayName,
    systemVolumeLiters: row.systemVolumeLiters?.toNumber(),
    equipmentCount: row._count.equipment,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: AquariumDetailRow): AquariumDetail {
  return {
    id: row.id,
    aquariumNumber: row.aquariumNumber,
    name: row.name,
    ownershipType: row.ownershipType === "STORE" ? "OWN" : row.ownershipType,
    waterBodyType: row.waterBodyType,
    customerId: row.customer?.id,
    customerName: row.customer?.displayName,
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
  };
}

@Injectable()
export class AquariumsRepository {
  async list(query: {
    page: number;
    pageSize: number;
    search?: string;
    ownershipType?: "OWN" | "CUSTOMER";
  }): Promise<AquariumListResponse> {
    const where: Prisma.AquariumWhereInput = {
      isActive: true,
      ...(query.ownershipType ? { ownershipType: query.ownershipType } : {}),
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

  async detail(id: string): Promise<AquariumDetail | null> {
    const row = await prisma.aquarium.findUnique({
      where: { id },
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
  ): Promise<AquariumDetail | null> {
    const row = await prisma.aquarium.findUnique({
      where: { clientOperationId },
      include: detailInclude,
    });
    return row ? toDetail(row) : null;
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
  ): Promise<AquariumDetail> {
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
  ): Promise<AquariumDetail> {
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
  ): Promise<AquariumDetail> {
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
  ): Promise<AquariumDetail> {
    await prisma.aquariumEquipment.delete({
      where: { id: equipmentId, aquariumId },
    });
    const row = await prisma.aquarium.findUniqueOrThrow({
      where: { id: aquariumId },
      include: detailInclude,
    });
    return toDetail(row);
  }
}
