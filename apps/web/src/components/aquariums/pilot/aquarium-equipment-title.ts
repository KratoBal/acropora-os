/**
 * A BERENDEZÉS SORÁNAK CÍME (acrobot 63508, a #2950 elve): a gyártó és a típus, ami ki van töltve, ` · ` jellel elválasztva. Ami hiányzik
 * (nincs megadva, üres vagy csak szóköz), az KIMARAD, nem áll helyette kötőjel: egy gyártó nélküli „T5” nem „— · T5”. Ha egyik sincs, a cím üres.
 */
export function equipmentTitle(row: {
  manufacturer?: string | null;
  model?: string | null;
}): string {
  return [row.manufacturer, row.model]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" · ");
}
