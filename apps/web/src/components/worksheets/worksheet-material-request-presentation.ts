/**
 * ANYAGIGENY-SOR MEGJELENITESE -- KULON, TISZTA MODUL.
 *
 * Ugyanaz az ok, mint a `worksheet-entry-presentation.ts`-nel: komponens-
 * render nelkul is merheto, es ha valaha a mobil is idehozza a sajat
 * (nem importalt) tukret, ez a szoveg-alak nem szamit -- csak a MEZOK.
 */

import type { MaterialRequestStatusValue } from "@acropora/types";

export interface MaterialRequestLike {
  status: MaterialRequestStatusValue;
  requestedByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
}

function magyarDatum(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * V2's statuses are named here already (docs/material-requests/v2-discovery.md):
 * the V2 screens come in their own phase, but the worksheet section and the
 * pending page must name a claimed or ordered request, not show an empty
 * badge, from the moment the API can return one.
 */
export const MATERIAL_REQUEST_STATUS_LABEL = {
  DRAFT: "Piszkozat",
  OPEN: "Beszerzésre vár",
  IN_PROGRESS: "Intézés alatt",
  ORDERED: "Megrendelve",
  PARTIALLY_RECEIVED: "Részben beérkezett",
  RECEIVED: "Beérkezett",
  CANCELLED: "Visszavont",
} as const satisfies Record<MaterialRequestStatusValue, string>;

export const MATERIAL_REQUEST_STATUS_BADGE_VARIANT = {
  DRAFT: "neutral",
  OPEN: "warning",
  IN_PROGRESS: "info",
  ORDERED: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "neutral",
} as const satisfies Record<MaterialRequestStatusValue, string>;

/**
 * KI KERTE, MIKOR -- ES HA ELKULDVE VAGY BEERKEZETT, AZ IS.
 *
 * A DRAFT sor a `createdAt`-tal all: meg nem kuldtek el, tehat nincs
 * kuldesi idopont. A tobbi allapotnal a kuldes (es a beerkezes) ideje a
 * lenyeges esemeny, nem a piszkozat keletkezese.
 */
export function materialRequestByline(request: MaterialRequestLike): string {
  const ki = request.requestedByName ?? "Ismeretlen kolléga";
  if (request.status === "DRAFT")
    return `${ki} · piszkozat, ${magyarDatum(request.createdAt)}`;
  const kuldve = request.submittedAt
    ? magyarDatum(request.submittedAt)
    : magyarDatum(request.createdAt);
  if (request.status === "OPEN") return `${ki} · elküldve ${kuldve}`;
  const beerkezettSor = request.receivedAt
    ? ` · beérkezett ${magyarDatum(request.receivedAt)}${
        request.receivedByName ? ` (${request.receivedByName})` : ""
      }`
    : "";
  return `${ki} · elküldve ${kuldve}${beerkezettSor}`;
}
