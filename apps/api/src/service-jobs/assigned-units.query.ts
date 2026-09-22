import { prisma } from "@acropora/database";

import { expandAssignedUnits } from "./assigned-units.js";

/**
 * A FELHASZNALO LATHATOSAGI EGYSEGEI, LEKERDEZVE ES KIBONTVA -- EGY HELYEN.
 *
 * === MIERT KELLETT KIEMELNI (2026-09-22, c654a5d4) ===
 *
 * KET taroló viselt `assignedUnitIds` nevu metodust, AZONOS NEVEN es KULONBOZO
 * jelentessel:
 *
 *     ServiceJobsRepository        lekerdez ES kibontja a reszfat
 *     ServiceJobPackageRepository  csak lekerdez, NEM bontja ki
 *
 * Es mind a ketto UGYANANNAK a `serviceJobVisibilityFor` fuggvenynek a bemenete.
 *
 * AMIG A LATHATOSAGI TENGELY A PARTNER GYUJTEMENYET SZURTE, EZ NEM LATSZOTT: a
 * feltetel nem-ures halmaz mellett az ugyfel minden jegyere igaz volt, tehat a
 * kibontas jelen vagy hianya ugyanazt az eredmenyt adta. Amint a tengely a SOR
 * sajat `departmentId` mezojere kerult, a ketto SZETVALT: egy gyermek-egysegben
 * allo jegy a listaban megjelent, a dokumentumcsomagja viszont 404-et adott
 * volna.
 *
 * === AMIERT EGYETLEN ORZO SEM SZOLT ===
 *
 * A ketto kulonbseget semmi nem merte: minden spec DUPLAT ad az
 * `assignedUnitIds` helyere (nyolc hivohelyen), tehat a VALODI megvalositasok
 * sosem alltak egymas mellett. Egy dupla nem tud kulonbseget tenni ket olyan
 * megvalositas kozott, amelyek egyiket sem futtatja.
 *
 * === ES AMIERT NEM AZ `assigned-units.ts` FAJLBA KERULT ===
 *
 * Az a fajl a fejlecében TISZTA FUGGVENYNEK nevezi magat, adatbazis nelkul. Egy
 * prisma-import ott csendben hamissa tenne a sajat leirasat -- es egy
 * megjegyzes, ami egy azota megvaltozott tulajdonsagot ir le, rosszabb a
 * semminel.
 */
export async function assignedUnitIdsFor(userId: string): Promise<string[]> {
  const assignments = await prisma.userWorksheetDepartment.findMany({
    where: { userId },
    select: { departmentId: true },
  });
  if (assignments.length === 0) return [];

  const assignedIds = assignments.map((row) => row.departmentId);
  const found = await prisma.worksheetDepartment.findMany({
    where: { id: { in: assignedIds } },
    select: { customerId: true },
  });
  const customerIds = [...new Set(found.map((row) => row.customerId))];
  const units = customerIds.length
    ? await prisma.worksheetDepartment.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true, name: true, parentId: true },
      })
    : [];

  return expandAssignedUnits({ assignedIds, units });
}
