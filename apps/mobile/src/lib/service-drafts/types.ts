/**
 * A PISZKOZAT-LISTA TÍPUSAI, KÜLÖN FÁJLBAN: a teszt-fordítás nem ismeri az
 * `@/` aliast, és egy `../api/...` típus-import a klienst is behúzná vele.
 * Saját, szűkített másolat: csak az a része a szerver válaszának, amit a
 * képernyő megjelenít (`docs/MOBILE-DEVELOPMENT.md`).
 */
export type ServiceDraftFilterState =
  "UNFILTERED" | "PASSED" | "UNCERTAIN" | "FILTERED" | "PROMOTED";

export interface ServiceDraftListItem {
  id: string;
  title: string;
  originalProblem: string;
  /** ÉÉÉÉ-HH-NN */
  reportDate: string;
  reporterPersonName: string | null;
  filterState: ServiceDraftFilterState;
  /** hányadszor jelenik meg ugyanez a hiba (1 = először) */
  occurrence: number;
  attachments: { id: string }[];
}

export interface ServiceDraftListResponse {
  items: ServiceDraftListItem[];
  nextCursor: string | null;
  filterEnabled: boolean;
}
