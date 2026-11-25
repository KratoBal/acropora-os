import type { Prisma, ServiceJobStatus } from "@acropora/database";

import {
  PARTNER_STATUS_LABELS,
  partnerStatusFromCommon,
  type CommonServiceState,
  type CommonServiceStatus,
  type CommonServiceStatusReason,
  type PartnerClosedReason,
  type ServiceJobPartnerStatus,
} from "@acropora/types";

import { MAINTENANCE_DONE } from "./maintenance-done.js";

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
/** A hibajegy Elkészültje CSAK az IN_PROGRESS jegyre vezetődik le (terv 8/a-b). */
const REPAIR_DONE: Prisma.ServiceJobWhereInput = {
  AND: [{ status: "IN_PROGRESS" }, WORKSHEETS_FINISHED],
};

const ONLY = (statuses: ServiceJobStatus[]): Prisma.ServiceJobWhereInput => ({
  status: { in: statuses },
});

function repairWhere(status: CommonServiceStatus): Prisma.ServiceJobWhereInput {
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
      return REPAIR_DONE;
    case "CLOSED":
      return ONLY(["COMPLETED", "CANCELLED"]);
  }
}

/**
 * A KARBANTARTÁS (terv 3. pont, `commonJobStatus` MAINTENANCE ága): a jelvény szabálya, a tárolt állapottól függetlenül.
 * Lezárt = `MAINTENANCE_DONE`, Folyamatban = a tagadása; a másik három közös állapot karbantartásra nem fordul elő.
 */
function maintenanceWhere(
  status: CommonServiceStatus,
): Prisma.ServiceJobWhereInput | null {
  if (status === "CLOSED") return MAINTENANCE_DONE;
  if (status === "IN_PROGRESS") return { NOT: MAINTENANCE_DONE };
  return null;
}

/** Egy közös állapot szűrője, a két fajta saját szabályával. */
export function commonStatusWhere(
  status: CommonServiceStatus,
): Prisma.ServiceJobWhereInput {
  const maintenance = maintenanceWhere(status);
  const branches: Prisma.ServiceJobWhereInput[] = [
    { AND: [{ kind: "REPAIR" }, repairWhere(status)] },
  ];
  if (maintenance)
    branches.push({ AND: [{ kind: "MAINTENANCE" }, maintenance] });
  return { OR: branches };
}

/** A fül szűrője: a kért közös állapotok bármelyike. */
export function commonStatusesWhere(
  statuses: readonly CommonServiceStatus[],
): Prisma.ServiceJobWhereInput {
  return { OR: statuses.map(commonStatusWhere) };
}

/** A válasz két mezője egy levezetett állapotból (lista-elem és adatlap). */
export function commonFields(state: CommonServiceState): {
  commonStatus: CommonServiceStatus;
  commonReason: CommonServiceStatusReason | null;
} {
  return { commonStatus: state.status, commonReason: state.reason };
}

/**
 * A PARTNER RÖVIDEBB LISTÁJA UGYANABBÓL A LEVEZETETT ÁLLAPOTBÓL (kártya 7f23785c, 4. szelet; terv 3. és 10. pont): a négy partner-szó
 * (`PARTNER_STATUS_LABELS`) és a lezárt jegy kimenetele. A lista és az adatlap ezt a `commonFields` mellé teszi, tehát a partner
 * Elkészültje és a belső Elkészült ugyanabból a tényből jön.
 */
export function partnerFields(state: CommonServiceState): {
  partnerStatus: ServiceJobPartnerStatus;
  partnerStatusLabel: string;
  partnerClosedReason: PartnerClosedReason | null;
} {
  const partner = partnerStatusFromCommon(state);
  return {
    partnerStatus: partner.status,
    partnerStatusLabel: PARTNER_STATUS_LABELS[partner.status],
    partnerClosedReason: partner.closedReason,
  };
}

/** A válasz közös és partner-mezői egy levezetett állapotból (lista-elem és adatlap). */
export function statusFields(state: CommonServiceState) {
  return { ...commonFields(state), ...partnerFields(state) };
}

/**
 * Kell-e a sornak a munkalap-tények olvasása: a hibajegyből csak az IN_PROGRESS-é (csak arra fut az Elkészült), a karbantartásé
 * mindig (a szabálya csak a lapokból áll).
 */
export function needsWorksheetFacts(row: {
  status: ServiceJobStatus;
  kind: "REPAIR" | "MAINTENANCE";
}): boolean {
  return row.kind === "MAINTENANCE" || row.status === "IN_PROGRESS";
}
