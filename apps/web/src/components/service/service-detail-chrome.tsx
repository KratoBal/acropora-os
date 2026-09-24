"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { ServiceIcon } from "@acropora/ui";

/**
 * A LEGTOBB DARAB ATKOLTOZOTT A `@acropora/ui`-ba, 2026-09-24 (partner
 * hibajegy-lapok arculati parositasa). Az indok es a legtobb komponens
 * teljes tartalma most ott all (`packages/ui/src/service-detail-chrome.tsx`).
 *
 * A `ServiceBackLink` KIVETEL, ES SZANDEKOSAN MARADT ITT: `next/link`-et
 * hasznal, a `@acropora/ui` viszont keretfuggetlen marad (lasd a csomag
 * `service-detail-chrome.tsx` fajljanak fejleceben a reszletet). A viselkedese
 * es a kimenete VALTOZATLAN -- csak a masik, keretfuggetlen fele koltozott at.
 */
export function ServiceBackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="mb-[18px] inline-flex items-center gap-[7px] text-xs text-muted hover:text-brand-700"
    >
      <ServiceIcon name="arrowLeft" className="size-4" />
      {children}
    </Link>
  );
}

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
