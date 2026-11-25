import type { Prisma, ServiceJobStatus } from "@acropora/database";
import type {
  CommonServiceState,
  CommonServiceStatus,
  CommonServiceStatusReason,
} from "@acropora/types";

/**
 * A KÖZÖS ÁLLAPOT SZŰRŐKÉNT (kártya 7f23785c, terv 8/c pont).
 *
 * A levezetett Elkészült EGY állítmány, és három helyen kell: a sor feliratán
 * (`commonJobStatus` a `@acropora/types`-ban, a munkalapok tényeiből), a
 * számlálón (csempe, fül) és a szerveroldali fül-szűrőn. A tárolt `status`
 * szerinti `groupBy` ezt nem tudja, ezért a számláló és a szűrő ezt a
 * feltételt kapja, a sor pedig ugyanazt a tényt olvassa
 * (`ServiceJobsRepository.commonWorksheetFacts`). Az egyezést az
 * `common-status.integration.spec.ts` ugyanazon az adaton méri.
 *
 * A "legutolsó verzió" a `WorksheetLatestVersion` nézet (munkalaponként a
 * legnagyobb sorszámú), ugyanúgy, mint a karbantartás Kész szabályánál
 * (`maintenance-done.ts`): EXISTS és NOT EXISTS részlekérdezés, azonosító-lista
 * nélkül.
 */

/** Van munkalapja, és mindegyiknek a legutolsó verziója aláírásra vár vagy aláírt. */
const WORKSHEETS_FINISHED: Prisma.ServiceJobWhereInput = {
  worksheets: {
    some: {},
    none: {
      OR: [
        { latestVersion: { is: null } },
        {
          latestVersion: {
            is: { status: { notIn: ["AWAITING_SIGNATURE", "SIGNED"] } },
          },
        },
      ],
    },
  },
};

/** Az Elkészült CSAK az IN_PROGRESS jegyre vezetődik le (terv 8/a-b). */
export const COMMON_DONE_WHERE: Prisma.ServiceJobWhereInput = {
  AND: [{ status: "IN_PROGRESS" }, WORKSHEETS_FINISHED],
};

const ONLY = (statuses: ServiceJobStatus[]): Prisma.ServiceJobWhereInput => ({
  status: { in: statuses },
});

export function commonStatusWhere(
  status: CommonServiceStatus,
): Prisma.ServiceJobWhereInput {
  switch (status) {
    case "NEW":
      return ONLY(["NEW"]);
    case "IN_PROGRESS":
      return {
        OR: [
          ONLY(["TRIAGED", "SCHEDULED"]),
          { AND: [{ status: "IN_PROGRESS" }, { NOT: WORKSHEETS_FINISHED }] },
        ],
      };
    case "WAITING":
      return ONLY(["WAITING_FOR_PARTS", "WAITING_FOR_CUSTOMER"]);
    case "DONE":
      return COMMON_DONE_WHERE;
    case "CLOSED":
      return ONLY(["COMPLETED", "CANCELLED"]);
  }
}

/** A fül szűrője: a kért közös állapotok bármelyike. */
export function commonStatusesWhere(
  statuses: readonly CommonServiceStatus[],
): Prisma.ServiceJobWhereInput {
  return { OR: statuses.map(commonStatusWhere) };
}

/**
 * Az öt darabszám a tárolt állapotok számából és az Elkészült számából. Az
 * Elkészült a Folyamatban (IN_PROGRESS) része, ezért abból vonódik le; a
 * Felmérve és az Ütemezve a Folyamatbanhoz adódik (terv 3. pont).
 */
export function commonCountsFrom(
  counts: Record<ServiceJobStatus, number>,
  done: number,
): Record<CommonServiceStatus, number> {
  return {
    NEW: counts.NEW,
    IN_PROGRESS: counts.TRIAGED + counts.SCHEDULED + counts.IN_PROGRESS - done,
    WAITING: counts.WAITING_FOR_PARTS + counts.WAITING_FOR_CUSTOMER,
    DONE: done,
    CLOSED: counts.COMPLETED + counts.CANCELLED,
  };
}

/** A válasz két mezője egy levezetett állapotból (lista-elem és adatlap). */
export function commonFields(state: CommonServiceState): {
  commonStatus: CommonServiceStatus;
  commonReason: CommonServiceStatusReason | null;
} {
  return { commonStatus: state.status, commonReason: state.reason };
}
