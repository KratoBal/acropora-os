import type { ReactNode } from "react";

import { SettlementTabs } from "@/components/finance/settlement-tabs";

/**
 * AZ ELSZÁMOLÁSOK HÁROM OLDALA EGY ÚTVONAL-CSOPORTBAN (a zárójeles mappa az
 * URL-t nem változtatja: `/penzugy/foxpost`, `/penzugy/gls`,
 * `/penzugy/simplepay` maradt). A csoport egyetlen dolga a közös fülsor.
 */
export default function SettlementsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <SettlementTabs />
      {children}
    </>
  );
}
