import type { PrismaClient } from "@acropora/database";

/**
 * WHAT THE SHOP SEES OF A SHARED REEFCLUB AQUARIUM (plan v6.1, 4.4; slice 5a),
 * as the customer's PREVIEW shows it before sharing. One function for the
 * preview, so the list of fields and rows is written down once: the aquarium's
 * data, its target ranges and its measurements. Not in it: the account's
 * e-mail, its other aquariums, its shop links (plan 4.4).
 *
 * The OS reads the same rows through its own routes (detail, measurements);
 * `reefclub-megosztas.integration.spec.ts` (plan 5.2 point 14) compares the
 * two, so a field the shop gets and the preview does not show, or the other
 * way round, is a red test.
 *
 * It takes the client as a parameter so the ReefClub process passes its own
 * (`ReefClubDatabase`), never the internal singleton.
 */
export interface ReefClubShopView {
  aquarium: {
    name: string;
    waterBodyType: "AKVARIUM" | "TO";
    waterType: "EDESVIZI" | "TENGERI" | null;
    systemVolumeLiters: number | null;
  };
  targets: { parameterCode: string; min: number | null; max: number | null }[];
  occasions: {
    measuredAt: string;
    values: { parameterCode: string; value: number }[];
  }[];
}

export async function shopViewOf(
  database: Pick<PrismaClient, "aquarium" | "aquariumMeasurement">,
  aquariumId: string,
): Promise<ReefClubShopView | null> {
  const aquarium = await database.aquarium.findUnique({
    where: { id: aquariumId },
    select: {
      name: true,
      waterBodyType: true,
      waterType: true,
      systemVolumeLiters: true,
      targets: {
        select: { parameterCode: true, min: true, max: true },
        orderBy: { parameterCode: "asc" },
      },
    },
  });
  if (!aquarium) return null;
  const rows = await database.aquariumMeasurement.findMany({
    where: { aquariumId },
    select: { measuredAt: true, parameterCode: true, value: true },
    orderBy: [{ measuredAt: "desc" }, { parameterCode: "asc" }],
  });
  const occasions = new Map<string, ReefClubShopView["occasions"][number]>();
  for (const row of rows) {
    const key = row.measuredAt.toISOString();
    const occasion = occasions.get(key) ?? { measuredAt: key, values: [] };
    occasion.values.push({
      parameterCode: row.parameterCode,
      value: row.value.toNumber(),
    });
    occasions.set(key, occasion);
  }
  return {
    aquarium: {
      name: aquarium.name,
      waterBodyType: aquarium.waterBodyType,
      waterType: aquarium.waterType,
      systemVolumeLiters: aquarium.systemVolumeLiters?.toNumber() ?? null,
    },
    targets: aquarium.targets.map((target) => ({
      parameterCode: target.parameterCode,
      min: target.min?.toNumber() ?? null,
      max: target.max?.toNumber() ?? null,
    })),
    occasions: [...occasions.values()],
  };
}
