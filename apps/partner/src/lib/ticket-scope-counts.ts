import {
  isFinishedServiceJob,
  type ServiceJobStatusCounts,
} from "@acropora/types";

/**
 * A HÁROM FÜLHÖZ TARTOZÓ TALÁLATSZÁM, A SZERVER SAJÁT OSZTÁLYOZÁSÁBÓL.
 *
 * A `ServiceJobListResponse.counts` a BELSŐ, nyolc állapotos modell szerint
 * van bontva (lásd a mező saját doksiját `@acropora/types`-ban) -- ezt a
 * partner nem láthatja közvetlenül. A nyitott/lezárt fül viszont NEM a
 * partner négyértékű állapotán múlik, hanem pontosan azon a szűrőn, amit a
 * szerver saját maga használ a `scope` paraméterhez
 * (`apps/api/src/service-jobs/service-job-list-scope.ts`,
 * `serviceJobScopeWhere`): `closed` = `isFinishedServiceJob(status)`,
 * `open` = ennek a tagadása. EZÉRT `isFinishedServiceJob`-ot hívjuk, NEM a
 * partner-státusz leképezést -- ez a MÉRT, a szerver forrásából igazolt
 * particionálás, nem egy második, kitalált csoportosítás.
 */
export function ticketScopeTotal(
  counts: ServiceJobStatusCounts,
  scope: "open" | "closed" | "all",
): number {
  const entries = Object.entries(counts) as [
    keyof ServiceJobStatusCounts,
    number,
  ][];
  if (scope === "all") {
    return entries.reduce((sum, [, count]) => sum + count, 0);
  }
  const wantFinished = scope === "closed";
  return entries.reduce(
    (sum, [status, count]) =>
      isFinishedServiceJob(status) === wantFinished ? sum + count : sum,
    0,
  );
}
