import type { ServiceJobKind } from "./service-job-management.js";

/**
 * A HIBAJEGY (KARBANTARTÁSI LAP) VÉGLEGES TÖRLÉSÉNEK ELŐNÉZETE (Balázs, 2026-11-18; acrobot 55766, 55770). A megerősítő ablak ebből mondja ki, MIT
 * töröl a gomb (jegyszám, munkalapok, csatolmányok, anyagigények), és ebből látszik, hogy a törlés egyáltalán megengedett-e. A szerver a törléskor
 * ugyanazt a szabályt futtatja újra: az előnézet tájékoztat, a törlés dönt.
 */
export interface ServiceJobDeletePreview {
  jobNumber: string;
  kind: ServiceJobKind;
  title: string;
  /** Törölhető-e most. Ha nem, a `refusal` megmondja, miért. */
  deletable: boolean;
  /** A tiltás egy mondatban (a 409 szövege), vagy `null`. */
  refusal: string | null;
  /** Mi törlődik vele együtt. */
  counts: {
    worksheets: number;
    documents: number;
    materialRequests: number;
  };
  /** Amit a törlés előtt tudni kell, de nem akadály (például aláírásra váró munkalap). */
  warnings: string[];
}

export interface ServiceJobDeleteResult {
  deleted: true;
  jobNumber: string;
}
