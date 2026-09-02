/**
 * MIKOR MONDJUK KI, HOGY NINCS KAPCSOLAT -- ES MIERT NEM AZONNAL.
 *
 * A MERT ESET (Balazs, 2026-09-02, a 13:33-as TestFlight build): a "Nincs
 * kapcsolat" sav MUKODO HALOZAT MELLETT jelent meg. A `connectivity.ts` fejlece
 * mar 2026-08-26 ota megnevezi ezt a jelenseget ("egy pillanatra kiirt nincs
 * kapcsolat sav olyankor, amikor minden mukodik"), es a `null` bizonytalansagot
 * helyesen ONLINE-nak veszi -- de egy hataroott `false` jelentest AZONNAL
 * elhisz.
 *
 * ES A NETINFO `isInternetReachable` MEZOJE ATMENETILEG HAMIS TUD LENNI: a
 * konyvtar egy sajat HTTP-probaval meri, es az elbukhat egy halozatvaltasnal,
 * az app elotérbe hozasakor vagy egy DNS-akadasnal -- majd egy masodpercen
 * belul visszabillen. Egyetlen `false` tehat nem allapot, hanem esemeny.
 *
 * A KET TEVEDES ARA NEM EGYFORMA, es ez donti el az alakot:
 *   tul KORAN mondjuk, hogy nincs kapcsolat  -> a sav elveszti a hitelet, es a
 *     szerelo legkozelebb akkor sem hisz neki, amikor IGAZ. Ezt a fejlec maga
 *     nevezi meg a rosszabb hibanak.
 *   tul KESON mondjuk  -> par masodpercig friss adatot lat valaki, aki amugy is
 *     epp elvesztette a halozatot. A kepernyo tovabbra is a szerverrol probal
 *     frissiteni, tehat ettol semmi nem romlik el.
 *
 * EZERT ASZIMMETRIKUS: az OFFLINE allitas var, a VISSZATERES azonnali.
 */

/** A NetInfo jelentesenek az a ket mezoje, amibol dontunk. */
export interface ConnectivityReport {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export interface ConnectivityState {
  /** Amit a felhasznalonak mutatunk. */
  online: boolean;
  /**
   * Mikor kezdodott a jelenlegi, meg meg nem erositett offline jelentes-sorozat
   * (ezredmasodperc). `null`, ha eppen nincs ilyen.
   */
  offlineSince: number | null;
}

/**
 * MENNYI IDEIG KELL KITARTANIA. VALASZTOTT ertek, nem meres: a NetInfo atmeneti
 * hamis jelentesei tipikusan egy masodpercen belul rendezodnek, ez pedig
 * harom. Ha valaha merunk hozza adatot, EZ a szam valtozik, es semmi mas -- a
 * dontes alakja fuggetlen tole.
 */
export const OFFLINE_CONFIRM_MS = 3000;

export const initialConnectivity: ConnectivityState = {
  online: true,
  offlineSince: null,
};

/**
 * A KESZULEK SZERINT ELERHETO-E A HALOZAT.
 *
 * A `null` BIZONYTALANSAG, es online-nak szamit -- ez a `connectivity.ts`
 * eredeti dontese, valtozatlanul. Csak a hataroott `false` szamit offline
 * jelentesnek.
 */
export function reportSaysOffline(report: ConnectivityReport): boolean {
  return report.isConnected === false || report.isInternetReachable === false;
}

/**
 * A KOVETKEZO ALLAPOT egy jelentes vagy egy ido-mulas utan.
 *
 * `report` nelkul hivva (idozito) csak azt nezi, letelt-e a varakozas.
 */
export function nextConnectivity(
  previous: ConnectivityState,
  now: number,
  report?: ConnectivityReport,
): ConnectivityState {
  if (report && !reportSaysOffline(report))
    // VISSZATERES AZONNAL: itt nincs varakozas, mert a tul keson kiirt "megint
    // van kapcsolat" ugyanugy hazudik, csak a masik iranyba.
    return { online: true, offlineSince: null };

  const since = previous.offlineSince ?? now;
  if (now - since >= OFFLINE_CONFIRM_MS)
    return { online: false, offlineSince: since };

  // MEG NEM ERESITETT: a korabbi allapot marad. Ha eddig online volt, online is
  // marad -- ez az egesz javitas lenyege.
  return { online: previous.online, offlineSince: since };
}
