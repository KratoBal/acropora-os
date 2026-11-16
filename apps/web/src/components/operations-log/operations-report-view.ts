import type { WorksheetDepartmentSummary } from "@acropora/types";

import { OPERATIONS_REPORT_PATH } from "./operations-format";

/**
 * A HAVI KIMUTATÁS OLDALÁNAK TISZTA LOGIKÁJA (task os-uzemeltetesi-naplo, S4b): a helyszín-lista fa-címkéi, az alapértelmezett hónap és
 * a kérés összeállítása. Külön fájl, hogy a képernyő nélkül mérhető legyen.
 */
export { OPERATIONS_REPORT_PATH };

export interface DepartmentOption {
  id: string;
  /** A teljes ág a gyökértől: „Biodóm / Nagy főmedence" (a név csak a testvérek között egyedi). */
  label: string;
}

/**
 * A HELYSZÍN-LISTA LAPOSAN JÖN, A FÁT A HÍVÓ ÉPÍTI a `parentId`-ból. A címke a teljes ág, a sorrend a címke szerint magyarul (a szülő
 * mindig a gyerek előtt áll). Egy körré záródott szülő-lánc (adathiba) nem fagyasztja le a felületet: a bejárás megáll.
 */
export function departmentOptions(
  items: readonly WorksheetDepartmentSummary[],
): DepartmentOption[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const label = (item: WorksheetDepartmentSummary): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let current: WorksheetDepartmentSummary | undefined = item;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      parts.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return parts.join(" / ");
  };
  return items
    .map((item) => ({ id: item.id, label: label(item) }))
    .sort((a, b) => a.label.localeCompare(b.label, "hu"));
}

/** A hónap-választó alapértéke: az aktuális hónap (`ÉÉÉÉ-HH`), a megadott „ma" szerint. */
export function defaultMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Érvényes hónap-kulcs-e (a böngésző `month` mezője és az URL is ilyet ad; egy kézzel átírt link ismeretlen értéke az alapérték). */
export function monthOrDefault(value: string | null, now?: Date): string {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
    ? value
    : defaultMonth(now);
}
