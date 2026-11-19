/**
 * A KARBANTARTÁSI LAP FELELŐSEI A MUNKALAP FELVITELÉN ELŐ VANNAK TÖLTVE (kártya d91005e9, Luca 2026-11-19: "ami a
 * karbantartási lapon be van állítva, az automatikusan kerüljön rá a munkalapokra; ha változik, a munkalapon még mindig
 * felül lehet bírálni"). A hibajegyből nyitott lap a jegy helyszínét és eszközeit már így kapja; a felelősök is.
 *
 * CSAK A KARBANTARTÁSI LAPRÓL: a hibajegy delegáltja nem feltétlenül az, aki a munkalapot végzi (Luca a karbantartási
 * lapról beszélt), tehát hibajegynél a lista üres marad, és a felvivő jelöl, mint eddig.
 *
 * A SZERVER AZT A LISTÁT FOGADJA EL, AMI KIOSZTHATÓ (`worksheetsApi.assignableUsers`): a lap felelősei közül, akik a
 * munkalapra nem oszthatók ki (a szerepkörük nem engedi), kimaradnak, és a felvivő látja, KIK maradtak ki. Egy csendben
 * eldobott név hiányzó szerelő lenne a lapról.
 */
export interface PrefillJobAssignee {
  userId: string;
  name: string;
}

export interface PrefillCandidate {
  id: string;
}

export function maintenanceAssigneePrefill(input: {
  kind: string;
  jobAssignees: readonly PrefillJobAssignee[];
  candidates: readonly PrefillCandidate[];
}): { selected: string[]; dropped: PrefillJobAssignee[] } {
  if (input.kind !== "MAINTENANCE") return { selected: [], dropped: [] };
  const assignable = new Set(input.candidates.map((candidate) => candidate.id));
  const selected: string[] = [];
  const dropped: PrefillJobAssignee[] = [];
  for (const assignee of input.jobAssignees) {
    if (selected.includes(assignee.userId)) continue;
    if (assignable.has(assignee.userId)) selected.push(assignee.userId);
    else dropped.push(assignee);
  }
  return { selected, dropped };
}
