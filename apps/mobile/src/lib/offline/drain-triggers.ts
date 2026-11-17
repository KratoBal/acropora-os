/**
 * MIKOR INDUL UJRA A SOR KIURITESE -- NEM CSAK A HALOZAT VISSZATERESEKOR.
 *
 * Balazs, 2026-11-17 (Uzemeltetesi naplo szal, msg 1572164706699972668, acrobot 54534/54537): offline rogzitett,
 * online lett, a sor megsem ment fel, a kezdolap azt mondta, "Egyetlen felvitel sem ment fel a 1 várakozóból";
 * az app bezarasa es ujranyitasa utan felment. A kiurites eddig CSAK az `isOnline` valtozasakor indult: ha a
 * visszakapcsolas pillanataban az egyetlen kiserlet elbukott (a halozat meg nem volt hasznalhato), a sor az app
 * ujrainditasaig allt, mert semmi nem inditotta ujra.
 *
 * Mostantol, amig online vagyunk: egy kor minden ELOTERBE KERULESKOR, es egy kor `DRAIN_TICK_MS`-enkent. A sor
 * sajat varakoztatasa (`isDueForRetry`, 30 s-tol duplazva) ettol nem valtozik: egy kor csak az esedekes sorokat
 * kuldi, tehat a gyakori kor nem jelent gyakori kerest.
 *
 * React es React Native nelkul, hogy merheto legyen: a hook a valodi `AppState`-et es idozitot adja be.
 */
export const DRAIN_TICK_MS = 30_000;

export interface DrainTriggerDeps {
  /** Az alkalmazas allapotanak valtozasai ("active", "background", ...). A visszatero ertek leiratkozik. */
  subscribeForeground(listener: (state: string) => void): () => void;
  setInterval(run: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Online: elinditja a ket inditot, es visszaadja a leallitasukat. Offline: nincs mit inditani. */
export function startDrainTriggers(
  isOnline: boolean,
  run: () => void,
  deps: DrainTriggerDeps,
): () => void {
  if (!isOnline) return () => undefined;
  const leiratkozas = deps.subscribeForeground((state) => {
    if (state === "active") run();
  });
  const idozito = deps.setInterval(run, DRAIN_TICK_MS);
  return () => {
    leiratkozas();
    deps.clearInterval(idozito);
  };
}
