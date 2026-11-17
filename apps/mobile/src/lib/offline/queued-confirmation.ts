/**
 * OFFLINE "KESZ" UTAN: VISSZAIGAZOLAS, ES VISSZA ODA, AHONNAN A ROGZITES INDULT.
 *
 * Balazs, 2026-11-17 (Uzemeltetesi naplo szal, msg 1572164706699972668): offline a "Kész" utan a kepernyo helyben
 * maradt, kiuritette az urlapot, es egy mondatot tett ki, ami az ures urlap mellett nem latszott -- "zavaro, hogy egy
 * ures urlapot nyit". Most egy parbeszedablak mondja meg, hogy a rogzites a feltoltesre varok koze kerult, es a
 * "Rendben" visszavisz. Nem zarhato be mellette koppintva: anelkul az ures urlap maradna ott, ugyanugy, mint eddig.
 */
export const QUEUED_TITLE = "Feltöltésre vár";

export type AlertFn = (
  title: string,
  message: string,
  buttons: { text: string; onPress: () => void }[],
  options: { cancelable: boolean },
) => void;

export function confirmQueuedAndLeave(
  message: string,
  leave: () => void,
  alert: AlertFn,
): void {
  alert(QUEUED_TITLE, message, [{ text: "Rendben", onPress: leave }], {
    cancelable: false,
  });
}
