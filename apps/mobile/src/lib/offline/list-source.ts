/**
 * MELYIK LISTAT MUTASSUK: A HALOZATIT VAGY A MENTETT MASOLATOT.
 *
 * === A HIBA, AMI EZT KIVALTOTTA (merve 2026-09-14) ===
 *
 * Balazs a 15 szamu buildrol ezt jelentette: "A partnerek bejonnek de a
 * helyszin szerintem nem." Mind a ketto ugyanabbol a masolatbol dolgozik, es a
 * partner-lista helyesen is esett vissza ra. A helyszin-valaszto viszont
 * KOZVETLENUL a halozati valaszt olvasta, tehat terero nelkul ures tombot
 * kapott.
 *
 * === ES AMIERT NEM LATSZOTT HIBANAK ===
 *
 * Az ures allapot magyarazata ("Ehhez a partnerhez meg nincs felveve helyszin")
 * egy MASIK valtozot nezett, amelyik MAR a masolatbol jott, tehat tele volt.
 * A valaszto ures maradt, es melle meg csak indok sem kerult. Egy nema ures
 * lista ugy nez ki, mint egy ures adatbazis.
 *
 * === MIERT SAJAT FUGGVENY EGY HAROMSZOROS FELTETEL HELYETT ===
 *
 * Nem a logika bonyolult, hanem az, hogy TOBB HELYEN kell ugyanannak allnia.
 * Az uj eszkoz urlapon ket szamitas epult ugyanarra a listara, es csak az egyik
 * ismerte a masolatot. Amig a szabaly kifejezesben lakik, minden uj hasznalo
 * ujra eldonti -- es a masodik mar el is ronthatja, csendben.
 *
 * AMIT SZANDEKOSAN NEM CSINAL: nem nezi, hogy a keszulek offline-nak mondja-e
 * magat. A masolat akkor kerul elo, ha a hivas TENYLEG elhasalt (`isError`),
 * ugyanaz a szabaly, mint a `connectivity.ts` fejleceben.
 */
export interface ListSourceInput<T> {
  /** Igaz, ha a halozati lekeres hibara futott. */
  failed: boolean;
  /** Amit a halozat adott. `undefined`, amig nincs valasz. */
  fetched: readonly T[] | undefined;
  /** Amit a telefonon tarolunk. Ures tomb, ha meg soha nem mentettunk. */
  cached: readonly T[];
}

export function listFromCacheOrNetwork<T>(input: ListSourceInput<T>): T[] {
  return [...(input.failed ? input.cached : (input.fetched ?? []))];
}
