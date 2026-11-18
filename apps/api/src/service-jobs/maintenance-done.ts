/**
 * MIKOR KÉSZ EGY KARBANTARTÁSI LAP (Balázs, 2026-11-18 11:31 UTC): ha van munkalapja, és MINDEGYIK munkalap legutolsó verziója aláírt.
 * A karbantartásnak nincs hibajegy-állapota; a lista jelvénye ("Kész" / "Folyamatban") és a lista fülei (acrobot 56182, f4590db6) ebből
 * az egy szabályból jönnek.
 *
 * TISZTA FÜGGVÉNY, hogy a szabály adatbázis nélkül mérhető legyen. A tároló két kötegelt lekérdezéssel hozza a bemenetét (a lapok és a
 * munkalapjaik legutolsó verziója).
 */
export function doneMaintenanceJobIds(
  jobIds: readonly string[],
  sheets: readonly {
    serviceJobId: string | null;
    latestStatus: string | null | undefined;
  }[],
): Set<string> {
  const withSheet = new Set<string>();
  const notSigned = new Set<string>();
  for (const sheet of sheets) {
    if (!sheet.serviceJobId) continue;
    withSheet.add(sheet.serviceJobId);
    if (sheet.latestStatus !== "SIGNED") notSigned.add(sheet.serviceJobId);
  }
  return new Set(
    jobIds.filter((id) => withSheet.has(id) && !notSigned.has(id)),
  );
}

/** A karbantartási lista fülének szűrője: a még nem kész (`progress`) vagy a kész (`done`) lapok. */
export type MaintenanceListState = "progress" | "done";
