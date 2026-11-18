import type { Prisma } from "@acropora/database";

/**
 * A MUNKALAP-LISTA SZŰRŐJE A KAPCSOLT MUNKA FAJTÁJA SZERINT (Balázs 2026-11-18 19:18 UTC, kártya 8219e7d6; acrobot 56321): Mind / Hibajegyes / Karbantartási.
 *
 * A SZERVEREN szűrünk, nem a kliensen: a lista lapozott (az oldal 10-100 sor), tehát egy kliensoldali szűrő csak a betöltött oldalt látná, és kevesebbet mutatna, mint amit a felirata ígér (ugyanaz az indok,
 * mint a Karbantartás lista fülei, #2711).
 *
 * A HIBAJEGYES az a lap, amelyik hibajegyhez (`ServiceJob.kind = REPAIR`) kötött, a KARBANTARTÁSI az, amelyik karbantartási laphoz kötött. A hibajegy nélküli (önálló) lapnak nincs fajtája: csak a szűretlen
 * listában van ott, és egyik fajtára szűrve sem. A feltétel a `userWhereWithoutStatus` része (a repositoryban), tehát a csempe-számlálók is a szűrt halmazt számolják.
 */
export type WorksheetJobKind = "REPAIR" | "MAINTENANCE";

export function worksheetJobKindWhere(
  jobKind: WorksheetJobKind | undefined,
): Prisma.WorksheetWhereInput {
  return jobKind ? { serviceJob: { is: { kind: jobKind } } } : {};
}
