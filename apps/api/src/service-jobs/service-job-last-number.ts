import type { Prisma } from "@acropora/database";

import { latestServiceJobNumber } from "./service-job-number.js";

/**
 * AZ UTOLSÓ KIOSZTOTT SZÁM EGY ELŐTAGRA: AZ ÉLŐ JEGYEK ÉS A TÖRÖLT SZÁMOK KÖZÖS MAXIMUMA (Balázs, 2026-11-18; acrobot 55768). A hibajegy törlése után
 * (és a karbantartások HJ-számának KT-re cserélésekor) a felszabadult szám a `ServiceJobDeletion` táblába kerül, és a következő szám
 * onnan is számol: a törölt szám soha nem hasznosul újra. Mindkét forrás ugyanarra az előtagra szűrt (a KT sorozat nem a HJ törölt számaiból
 * számol). Három helyen osztunk számot (a jegy létrehozása és a piszkozat két elfogadási útja): egy közös függvény, hogy a három ne válhasson szét.
 */
export async function lastServiceJobNumber(
  db: Pick<Prisma.TransactionClient, "serviceJob" | "serviceJobDeletion">,
  prefix: string,
): Promise<string | null> {
  const where = { jobNumber: { startsWith: prefix } };
  // MINDEN szám, nem a betűrendi első: a "…-1000" betűrendben a "…-999" előtt áll (barracuda, #2691), tehát a maximumot számszerűen kell venni.
  // Egy előtag egy év (néhány száz rövid sor), tehát egy kiválasztott oszlop ára elhanyagolható.
  const [live, deleted] = await Promise.all([
    db.serviceJob.findMany({ where, select: { jobNumber: true } }),
    db.serviceJobDeletion.findMany({ where, select: { jobNumber: true } }),
  ]);
  return latestServiceJobNumber(
    ...live.map((row) => row.jobNumber),
    ...deleted.map((row) => row.jobNumber),
  );
}
