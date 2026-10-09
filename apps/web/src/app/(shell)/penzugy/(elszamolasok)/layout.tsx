import type { ReactNode } from "react";

/**
 * AZ ELSZÁMOLÁSOK HÁROM OLDALA EGY ÚTVONAL-CSOPORTBAN (a zárójeles mappa az
 * URL-t nem változtatja: `/penzugy/foxpost`, `/penzugy/gls`,
 * `/penzugy/simplepay` maradt). A szolgáltatói kártyák (`SettlementTabs`) a
 * terv szerint a lap fejléce ALATT állnak, ezért a lapok rajzolják, nem ez
 * a csoport.
 */
export default function SettlementsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
