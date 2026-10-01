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
 *
 * ===================================================================
 * ES AMI EZ A VARAKOZAS NEM KESLELTET: A VALODI SZAKADAST
 * ===================================================================
 *
 * A kerdes acrobote (2026-09-02), es jogos: ha lassitjuk a "nincs kapcsolat"
 * allitast, nem kesik-e el a VALODI kapcsolat-vesztes jelzese? A dragabb hiba
 * ugyanis a masik iranyu: egy elhasalt lekerdezes, ami ures listara esik, nem
 * hibat mutat, hanem NYUGALMAT.
 *
 * MERVE, MINDKET KEPERNYON (`assets/index.tsx` 102. sor, `assets/[id].tsx`
 * 184. sor): a sav bemenete nem ez a jelzes egyedul, hanem
 *
 *     online: online && !query.isError
 *
 * Vagyis a VALODI szakadast az elhasalt KERES jelzi, nem a keszulek. Az a jel
 * fuggetlen ettol a modultol, es AZONNAL hat. Ez a varakozas kizarolag a
 * keszulek sajat allitasat halasztja -- azt, amelyik hamis tud lenni.
 *
 * AMIT EBBOL NEM SZABAD ELRONTANI: ha valaha valaki "kovetkezetessegbol" ezt a
 * varakozast ratenne a `query.isError` agra is, azzal epp a dragabb hibat
 * hozna vissza. A ket jel kulon marad.
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
  /**
   * EGY MENTES MAR NEM ERTE EL A SZERVERT, es eddig az idopontig (ezred-
   * masodperc) hiszunk neki jobban, mint a keszuleknek. `null`, ha nincs ilyen.
   * Lasd `stalledConnectivity`.
   */
  stalledUntil: number | null;
}

/**
 * MENNYI IDEIG KELL KITARTANIA. VALASZTOTT ertek, nem meres: a NetInfo atmeneti
 * hamis jelentesei tipikusan egy masodpercen belul rendezodnek, ez pedig
 * harom. Ha valaha merunk hozza adatot, EZ a szam valtozik, es semmi mas -- a
 * dontes alakja fuggetlen tole.
 */
export const OFFLINE_CONFIRM_MS = 3000;

/**
 * MEDDIG HISZUNK EGY ELAKADT MENTESNEK. VALASZTOTT ertek, nem meres: az iOS
 * sajat probaja (lasd `stalledConnectivity`) eleresi hibanal 5 masodpercenkent
 * ujrakerdez, tehat ennyi ido alatt tobbszor is megszolalhat. Ha valaha merunk
 * hozza adatot, EZ a szam valtozik, es semmi mas.
 */
export const STALL_HOLD_MS = 30_000;

export const initialConnectivity: ConnectivityState = {
  online: true,
  offlineSince: null,
  stalledUntil: null,
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
    // van kapcsolat" ugyanugy hazudik, csak a masik iranyba. Egy elakadt mentes
    // tartasat is feloldja: a NetInfo csak VALTOZASKOR szol, tehat egy online
    // jelentes a tartas alatt valodi visszaterest jelent, nem egy regi allapotot.
    return { online: true, offlineSince: null, stalledUntil: null };

  // Egy jelentes nelkuli hivas (idozito) NEM kezd uj offline sorozatot: csak a
  // mar elindultat meri, es a tartas lejartat.
  const since = report ? (previous.offlineSince ?? now) : previous.offlineSince;
  const stalledUntil =
    previous.stalledUntil !== null && now < previous.stalledUntil
      ? previous.stalledUntil
      : null;

  if (since !== null && now - since >= OFFLINE_CONFIRM_MS)
    return { online: false, offlineSince: since, stalledUntil };

  if (stalledUntil !== null)
    return { online: false, offlineSince: since, stalledUntil };

  // MEG NEM ERESITETT: a korabbi allapot marad. Ha eddig online volt, online is
  // marad -- ez az egesz javitas lenyege. Ha csak egy lejart tartas tartotta
  // offline-ban, az a tartassal egyutt megszunik.
  return {
    online: previous.stalledUntil !== null ? true : previous.online,
    offlineSince: since,
    stalledUntil: null,
  };
}

/**
 * EGY MENTES NEM ERTE EL A SZERVERT: MOSTANTOL A TOBBI EGYENESEN A SORBA MEGY.
 *
 * === A MERT KULONBSEG A KET RENDSZER KOZOTT (2026-10-01, forrasbol) ===
 *
 * A NetInfo 12.0.1 ANDROIDON a rendszertol kapja az `isInternetReachable`
 * mezot (`ConnectivityReceiver.java`), tehat a halozat elvesztesekor azonnal
 * hamis. IOS-EN a nativ modul CSAK `isConnected`-et ad (`RNCNetInfo.mm` 139.
 * sor), es az elerhetoseget a konyvtar egy SAJAT HTTP-probaval meri
 * (`internetReachability.ts`): elerheto allapotban 60 masodpercenkent, 15
 * masodperces korlattal. Egy pinceben, ahol a telefon terero-jelet mutat, de
 * adat nem megy at, az iOS tehat akar 75 masodpercig ONLINE-nak mondja magat.
 *
 * Ezalatt minden mentes eloszor a szervert probalja, es a hivas idokorlatjaig
 * var (20 masodperc, fenykepnel 120). A szerelo ezt vegtelen porgesnek latja.
 *
 * === EZERT A SAJAT KUDARCUNK IS JEL ===
 *
 * Egy mentes, ami valasz nelkul hasalt el, erosebb bizonyitek, mint egy regi
 * proba: a mi szerverunket nem erte el, most. A kovetkezo `STALL_HOLD_MS`
 * idore offline-nak vesszuk magunkat, a tovabbi mentesek azonnal a sorba
 * kerulnek, es a sav is kimondja. A tartas vegen (vagy egy online jelentesre)
 * visszaterunk -- es mivel ez offline-bol online-ba valtas, a sor kiurul.
 *
 * Egy mar futo offline sorozat merese megmarad: ha a keszulek kozben is
 * offline-t mond, a tartas utan sem terunk vissza addig.
 */
export function stalledConnectivity(
  previous: ConnectivityState,
  now: number,
): ConnectivityState {
  return {
    online: false,
    offlineSince: previous.offlineSince,
    stalledUntil: now + STALL_HOLD_MS,
  };
}

/**
 * MIKOR KELL LEGKOZELEBB UJRA RANEZNI AZ ALLAPOTRA. `null`, ha soha (nincs
 * futo sorozat es nincs tartas). Az idozito ezt az egy szamot varja.
 */
export function nextWakeAt(state: ConnectivityState): number | null {
  const confirm =
    state.online && state.offlineSince !== null
      ? state.offlineSince + OFFLINE_CONFIRM_MS
      : null;
  if (confirm === null) return state.stalledUntil;
  if (state.stalledUntil === null) return confirm;
  return Math.min(confirm, state.stalledUntil);
}
