"use client";

/**
 * A LEGTOBB DARAB ATKOLTOZOTT A `@acropora/ui`-ba, 2026-09-24 (partner
 * hibajegy-lapok arculati parositasa). Az indok es a legtobb komponens
 * teljes tartalma most ott all (`packages/ui/src/service-detail-chrome.tsx`).
 *
 * A `ServiceBackLink` ITT MEGSZUNT (Picasso R12, 2026-11-26): a visszalepes
 * egy alakja a `PilotBackLink` (`components/pilot/pilot-back-link.tsx`), a
 * szerviz lapok is azt hasznaljak. A partner portal a sajat visszalepeset
 * tartja (`apps/partner`).
 */
export {
  ServiceDetailHeader,
  ServicePanel,
  ServicePanelHeading,
  ServiceContextRow,
  ServiceDataGrid,
  ServiceDataItem,
  ServiceNextAction,
  ServiceDetailSplit,
} from "@acropora/ui";
