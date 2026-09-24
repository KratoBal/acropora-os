import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import {
  aquariumMeasurementParameter,
  type AquariumMeasurementListResponse,
  type AquariumMeasurementOccasion,
  type AquariumMeasurementParameterCode,
  type AquariumMeasurementValue,
} from "@acropora/types";

import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import type { CreateAquariumMeasurementDto } from "./dto/aquarium-measurement.dto.js";

/**
 * A MÉRÉSI ALKALOM NEM SAJÁT TÁBLA -- A `measuredAt` A TERMÉSZETES KULCSA.
 *
 * Balázs kérése: "egy mérés = egy mérési alkalom, több paraméterrel." A
 * séma (`AquariumMeasurement`, 0 sor élesben, önmagában is meglévő) ezt
 * DENORMALIZÁLTAN tárolja: egy alkalom annyi sort ír, ahány paramétert
 * mértek, mindegyik UGYANAZT a `measuredAt`, `measuredById`, `source` és
 * `notes` értéket viszi. Egy külön "alkalom" tábla bevezetése ide plusz
 * egy szintet, plusz egy idegen kulcsot tenne minden meglévő és jövőbeli
 * sorra -- a séma MA is válaszol mindenre, amit ez a kör kér (lista,
 * felvitel, törlés egy alkalomra), tehát ez a bővítés a mérés nélkül
 * spekulatív lenne.
 *
 * AZ ALKALOM AZONOSÍTÓJA A `measuredAt` ISO-ALAKJA. Két alkalom nem
 * eshet egybe ugyanarra az ezredmásodpercre -- ha valaha mégis, az egy
 * MÁSIK, önmagában is mérendő kérdés, nem ennek a körnek a hatóköre.
 */

function toValues(
  rows: readonly { parameterCode: string; value: Prisma.Decimal }[],
): AquariumMeasurementValue[] {
  return rows.map((row) => ({
    parameterCode: row.parameterCode as AquariumMeasurementParameterCode,
    value: row.value.toNumber(),
  }));
}

function groupIntoOccasions(
  rows: readonly {
    parameterCode: string;
    value: Prisma.Decimal;
    measuredAt: Date;
    measuredById: string | null;
    source: string | null;
    notes: string | null;
  }[],
  measuredByName: (userId: string) => string | undefined,
): AquariumMeasurementOccasion[] {
  const byOccasion = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const key = row.measuredAt.toISOString();
    const existing = byOccasion.get(key);
    if (existing) existing.push(row);
    else byOccasion.set(key, [row]);
  }
  return [...byOccasion.entries()]
    .map(([id, occasionRows]) => {
      const first = occasionRows[0]!;
      return {
        id,
        measuredAt: id,
        measuredById: first.measuredById ?? undefined,
        measuredByName: first.measuredById
          ? measuredByName(first.measuredById)
          : undefined,
        source: first.source ?? undefined,
        notes: first.notes ?? undefined,
        values: toValues(occasionRows),
      };
    })
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
}

/**
 * A `created` MEZŐ A PUSH-ÉRTESÍTÉS EGYETLEN VÉDELME AZ ISMÉTELT KÜLDÉS
 * ELLEN.
 *
 * Balázs kérése: "az offline sorból később beérkező mérés is ugyanígy
 * értesít (egyszer, az idempotencia-kulcs szerint)." Ha a hívó csak az
 * `AquariumMeasurementOccasion`-t kapná vissza, a szolgáltatás-réteg NEM
 * tudná megkülönböztetni a "most jött létre" és a "már létezett, a kulcs
 * miatt visszaadtuk" esetet -- egy megismételt kérés (retry) tehát
 * MÁSODSZOR is push-ot küldene. Lásd `aquarium-measurements.service.ts`
 * `create()`-jét, ahol ez a mező dönt.
 */
export interface AquariumMeasurementCreateResult {
  occasion: AquariumMeasurementOccasion;
  created: boolean;
}

@Injectable()
export class AquariumMeasurementsRepository {
  async list(aquariumId: string): Promise<AquariumMeasurementListResponse> {
    const rows = await prisma.aquariumMeasurement.findMany({
      where: { aquariumId },
      orderBy: [{ measuredAt: "desc" }, { createdAt: "asc" }],
    });
    const measuredByIds = [
      ...new Set(
        rows.flatMap((row) => (row.measuredById ? [row.measuredById] : [])),
      ),
    ];
    const users =
      measuredByIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: measuredByIds } },
            select: { id: true, displayName: true },
          })
        : [];
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));
    return {
      occasions: groupIntoOccasions(rows, (id) => nameById.get(id)),
    };
  }

  async byClientOperationId(
    aquariumId: string,
    clientOperationId: string,
  ): Promise<AquariumMeasurementOccasion | null> {
    const rows = await prisma.aquariumMeasurement.findMany({
      where: { aquariumId, clientOperationId },
    });
    if (rows.length === 0) return null;
    const measuredById = rows[0]!.measuredById;
    const user = measuredById
      ? await prisma.user.findUnique({
          where: { id: measuredById },
          select: { displayName: true },
        })
      : null;
    const occasions = groupIntoOccasions(rows, () => user?.displayName);
    return occasions[0] ?? null;
  }

  /**
   * A KLIENS-KULCS VÉDELME KÉTRÉTEGŰ, UGYANÚGY, MINT AZ AKVÁRIUM SAJÁT
   * `create()`-JÉNÉL: keresés a beszúrás előtt (a rendes eset), és egy
   * `catch`-ág az egyedi index ütközésére (a versenyhelyzet). Lásd
   * `aquariums.repository.ts` fejlécét.
   */
  async create(
    aquariumId: string,
    input: CreateAquariumMeasurementDto,
    actorUserId: string,
  ): Promise<AquariumMeasurementCreateResult> {
    if (input.clientOperationId) {
      const existing = await this.byClientOperationId(
        aquariumId,
        input.clientOperationId,
      );
      if (existing) return { occasion: existing, created: false };
    }

    const measuredAt = input.measuredAt
      ? new Date(input.measuredAt)
      : new Date();
    const source = input.source?.trim() || null;
    const notes = input.notes?.trim() || null;

    try {
      const created = await prisma.$transaction(async (tx) => {
        const rows = [];
        for (const entry of input.values) {
          const parameter = aquariumMeasurementParameter(
            entry.parameterCode as AquariumMeasurementParameterCode,
          );
          const row = await tx.aquariumMeasurement.create({
            data: {
              aquariumId,
              parameterCode: entry.parameterCode,
              value: entry.value,
              unit: parameter.unit,
              measuredAt,
              measuredById: actorUserId,
              source,
              notes,
              clientOperationId: input.clientOperationId ?? null,
            },
          });
          rows.push(row);
          /**
           * A DOMÉN-ESEMÉNY PARAMÉTERENKÉNT EGY -- a megosztott
           * `AquariumMeasurementRecorded` szerződés (`domain-events.ts`)
           * ezt a szemcsézettséget rögzíti előre (payload:
           * `{measurementId, parameterCode, value, unit}`, egyes számban).
           */
          await tx.domainEvent.create({
            data: {
              id: randomUUID(),
              eventType: "aquarium-measurement.recorded",
              aggregateType: "Aquarium",
              aggregateId: aquariumId,
              actorUserId,
              payload: {
                measurementId: row.id,
                parameterCode: row.parameterCode,
                value: row.value.toString(),
                unit: row.unit,
              },
              occurredAt: new Date(),
              schemaVersion: 1,
            },
          });
        }
        return rows;
      });

      const actor = await prisma.user.findUnique({
        where: { id: actorUserId },
        select: { displayName: true },
      });
      const occasion = groupIntoOccasions(
        created,
        () => actor?.displayName,
      )[0]!;
      return { occasion, created: true };
    } catch (error) {
      if (
        input.clientOperationId &&
        isPrismaUniqueConstraintViolation(error, "clientOperationId")
      ) {
        const existing = await this.byClientOperationId(
          aquariumId,
          input.clientOperationId,
        );
        if (existing) return { occasion: existing, created: false };
      }
      throw error;
    }
  }

  /**
   * EGY TELJES MÉRÉSI ALKALOM TÖRLÉSE -- MINDEN PARAMÉTERÉVEL EGYÜTT.
   *
   * Balázs kérése: "egy mérési alkalom törölhető (megerősítéssel),
   * szerkesztés nincs". A `measuredAt` a kulcs -- lásd a fájl fejlécét.
   */
  async delete(aquariumId: string, measuredAt: string): Promise<number> {
    const result = await prisma.aquariumMeasurement.deleteMany({
      where: { aquariumId, measuredAt: new Date(measuredAt) },
    });
    return result.count;
  }
}
