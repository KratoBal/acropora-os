import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

import {
  initialConnectivity,
  nextConnectivity,
  OFFLINE_CONFIRM_MS,
  type ConnectivityState,
} from "./connectivity-state";

/**
 * VAN-E KAPCSOLAT, a készülék szerint.
 *
 * Nem ugyanaz, mint hogy a szerver elérhető: egy térerővel rendelkező telefon
 * is kaphat hálózati hibát. Ezért ez a jelzés SOHA nem dönt egyedül arról,
 * hogy mit mutatunk -- a lekérdezés akkor is elindul, ha a készülék offline-nak
 * mondja magát, és a mentett másolat csak akkor kerül elő, ha a hívás tényleg
 * elhasalt. Egy rosszul jelentő `isConnected` így legfeljebb egy sávot ír ki
 * fölöslegesen, nem tart vissza egy működő lekérdezést.
 *
 * `isInternetReachable` háromértékű: `null`, amíg a készülék még méri. A
 * bizonytalanságot ONLINE-nak vesszük, mert a fordítottja a rosszabb hiba: egy
 * pillanatra kiírt "nincs kapcsolat" sáv olyankor, amikor minden működik,
 * elveszi a sáv hitelét, és a szerelő legközelebb nem hisz neki.
 *
 * ES EZ 2026-09-02-IG NEM VOLT ELEG. A fenti bekezdes a `null` esetet fedte le,
 * a hataroott `false`-t viszont AZONNAL elhitte -- Balazs pedig pontosan azt a
 * savot latta mukodo halozat mellett. A NetInfo `isInternetReachable` mezoje
 * atmenetileg hamis tud lenni (sajat HTTP-proba, ami elbukhat halozatvaltasnal
 * vagy az app elotérbe hozasakor), tehat egyetlen `false` nem allapot, hanem
 * esemeny.
 *
 * A DONTES MOSTANTOL A `connectivity-state` MODULBAN AL, tiszta fuggvenykent,
 * es ott van rá allitas is. Itt csak a React-oldali kotes marad: a jelentesek
 * beerkezese es egy idozito, ami a varakozas leteltekor ujra kerdez.
 */
export function useIsOnline(): boolean {
  const [state, setState] = useState<ConnectivityState>(initialConnectivity);

  // A JELENTESEK. A `setState` fuggveny-alakja adja a legfrissebb allapotot --
  // ref nelkul, mert egy renderelés kozben olvasott ref pont az a hiba, amit a
  // React szabalya tilt.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netinfo) =>
      setState((elozo) =>
        nextConnectivity(elozo, Date.now(), {
          isConnected: netinfo.isConnected,
          isInternetReachable: netinfo.isInternetReachable,
        }),
      ),
    );
    return unsubscribe;
  }, []);

  // AZ IDOZITO, ES AZERT KULON: a NetInfo nem kuld ujabb esemenyt attol, hogy
  // telik az ido. Egy kitarto offline jelentes utan tehat NEKUNK kell ujra
  // megkerdezni magunktol a varakozas vegen -- kulonben a sav SOSEM jelenne
  // meg, es a javitas a masik iranyba tevedne.
  useEffect(() => {
    if (!state.online || state.offlineSince === null) return;
    const hatra = Math.max(
      0,
      state.offlineSince + OFFLINE_CONFIRM_MS - Date.now(),
    );
    const idozito = setTimeout(
      () => setState((elozo) => nextConnectivity(elozo, Date.now())),
      hatra,
    );
    return () => clearTimeout(idozito);
  }, [state]);

  return state.online;
}
