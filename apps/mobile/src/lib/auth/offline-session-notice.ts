import { OFFLINE_GRACE_MS } from "./offline-grace";

/**
 * AMIT A KOLLEGA LAT, HA AZ APP A TAROLT MUNKAMENETTEL INDULT.
 *
 * === MIERT KELL EGYALTALAN KIIRNI ===
 *
 * Az app elindul, a kepernyok mukodnek, a nev es a jogkorok ott vannak -- es
 * epp ezert nem latszik semmi. A kulonbseg viszont nem elhanyagolhato: a
 * jogkorok a LEGUTOBBI szerver-ellenorzes szerintiek, es egy azota visszavont
 * jogosultsag legfeljebb 24 oraig nem latszik.
 *
 * Ez Balazs dontesenek az ara (2026-09-02, "24 ora"), es a kollega csak akkor
 * tud vele szamolni, ha TUDJA, hogy offline all. Egy allapot, amit a felulet
 * nem mond ki, ugyanaz, mintha nem is letezne.
 *
 * === MIERT TISZTA MODUL ===
 *
 * A telefonon nincs komponens-teszt: ami a kepernyo torzseben marad, azt csak
 * kezzel, eszkozon lehet kiprobalni. A szoveg dontese ezert itt all, es a
 * komponens csak megjeleniti.
 */

export interface OfflineSessionNotice {
  title: string;
  body: string;
}

/**
 * `null`, ha az app ONLINE indult -- akkor nincs mit kiirni, es a kezdolap
 * valtozatlan marad.
 */
export function describeOfflineSession(input: {
  offline: boolean;
  /** Az utolso sikeres szerver-ellenorzes, ISO alakban. */
  lastVerifiedAt: string | null;
  now: Date;
}): OfflineSessionNotice | null {
  if (!input.offline) return null;

  const hatralevo = hatralevoOrak(input.lastVerifiedAt, input.now);

  return {
    title: "Offline mód",
    body:
      hatralevo === null
        ? "Nincs kapcsolat a szerverrel. A jogosultságok a legutóbbi ellenőrzés " +
          "szerintiek, és csak akkor frissülnek, ha a telefon újra hálózatra kerül."
        : `Nincs kapcsolat a szerverrel. A jogosultságok a legutóbbi ellenőrzés ` +
          `szerintiek: még ${hatralevo} óráig indul így az alkalmazás, utána ` +
          `hálózat kell hozzá.`,
  };
}

/**
 * HANY ORA VAN MEG A 24-BOL. Lefele kerekit, es SOHA nem ad nullat: amig az app
 * elindult, legalabb egy megkezdett ora van hatra, es a "0 ora" azt sugallna,
 * hogy epp most jart le -- holott akkor el sem indult volna.
 */
function hatralevoOrak(
  lastVerifiedAt: string | null,
  now: Date,
): number | null {
  if (!lastVerifiedAt) return null;
  const verified = new Date(lastVerifiedAt).getTime();
  if (Number.isNaN(verified)) return null;
  const hatra = OFFLINE_GRACE_MS - (now.getTime() - verified);
  if (hatra <= 0) return null;
  return Math.max(1, Math.floor(hatra / 3_600_000));
}
