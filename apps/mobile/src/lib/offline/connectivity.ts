import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

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
 */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable;
      setOnline(state.isConnected !== false && reachable !== false);
    });
    return unsubscribe;
  }, []);

  return online;
}
