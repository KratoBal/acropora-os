/**
 * A RÖGZÍTÉS RÉSZTVEVŐI, AMIK VÁLASZTHATÓK (kártya f6694b49; Balázs, 2026-11-15, TestFlight 22: „Te automatikusan szerepelsz" mellett a saját
 * neve is választható volt).
 *
 * A BEJELENTKEZETT FELHASZNÁLÓ KIMARAD A LISTÁBÓL, A TELEFONON IS: a szerver a kollégák listájából már kiveszi a hívót, de a készüléken
 * MENTETT lista (offline másolat) az előző kiadás válaszából is származhat, és ott a hívó még benne van. A szűrés a megjelenítés
 * pillanatában tehát nem felesleges ismétlés, hanem a mentett lista védelme. A gépi (flotta) fiókokat a szerver jelöli (`isServiceAccount`),
 * és a szerver szűri; a telefon nem ismeri őket, ezért a mentett régi lista egy frissítésig még hordozhatja.
 */
export function selectableColleagues<T extends { id: string }>(
  colleagues: readonly T[],
  currentUserId: string | undefined,
): T[] {
  if (!currentUserId) return [...colleagues];
  return colleagues.filter((colleague) => colleague.id !== currentUserId);
}
