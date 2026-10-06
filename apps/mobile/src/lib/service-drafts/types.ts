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
  /** a kivonatoló javasolt helyszíne; az elfogadáskor ez az előválasztás */
  proposedDepartmentId: string | null;
  filterState: ServiceDraftFilterState;
  /** hányadszor jelenik meg ugyanez a hiba (1 = először) */
  occurrence: number;
  attachments: { id: string }[];
}

/** A Cápasuli helyszínei: az elfogadáskor ezek közül kell egyet választani. */
export interface ServiceDraftLocation {
  id: string;
  name: string;
}

export interface ServiceDraftListResponse {
  items: ServiceDraftListItem[];
  nextCursor: string | null;
  filterEnabled: boolean;
  locations: ServiceDraftLocation[];
  /**
   * A hibajegy nyitója (a Cápasuli partnerfelhasználója). `null`, ha nincs
   * beállítva: ilyenkor elfogadni nem lehet, elvetni igen (mint a weben).
   */
  openedBy: { id: string; name: string } | null;
}

/**
 * Az ELFOGADÁS törzse: a szerver `AcceptDraftDto`-ja
 * (`apps/api/src/service-drafts/service-drafts.controller.ts`).
 */
export interface AcceptServiceDraftInput {
  departmentId: string;
  reporterPersonName?: string | null;
}
