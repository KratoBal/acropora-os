import type { ReactNode } from "react";

/**
 * A MEZO MELLE KIIRT EGYSEG (Kelecsenyi Ferenc kerese, 2026-10-21, kanban
 * 541e2716): az Aramfelvetel (A) es a Fogyasztas (kW) beviteli mezoje mellett
 * LATSZIK, hogy mibe vezetik. A beviteli mezot nem erinti: a ketto egy sorban
 * all, az egyseg a mezon KIVUL. Kozos, hogy a szerkeszto es a pilot felvitel
 * ugyanazt mutassa.
 */
export function AssetUnitAdornment({
  unit,
  children,
  className = "text-sm text-dusk-500",
}: {
  unit: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      <span className={className}>{unit}</span>
    </div>
  );
}
