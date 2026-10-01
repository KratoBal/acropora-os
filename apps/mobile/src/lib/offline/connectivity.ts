import NetInfo from "@react-native-community/netinfo";
import { useSyncExternalStore } from "react";

import {
  initialConnectivity,
  nextConnectivity,
  nextWakeAt,
  stalledConnectivity,
  type ConnectivityReport,
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
  return useSyncExternalStore(subscribe, isOnlineNow, isOnlineNow);
}

/**
 * EGY ALLAPOT AZ EGESZ APPNAK, NEM KEPERNYONKENT EGY (2026-10-01).
 *
 * Eddig minden `useIsOnline` hivas sajat allapotot tartott. A mentes viszont
 * nem komponens: a `saveOrQueue` a kattintas pillanataban kerdezi meg, offline
 * vagyunk-e, es egy elakadt mentes ugyanebbe az allapotba ir vissza
 * (`reportUnreachable`). Ha ez kepernyonkent kulon allna, a szerkeszto
 * elakadasa nem jutna el a fooldal sorurito horgajahoz, es a sor nem urulne ki
 * a visszatereskor.
 */
let allapot: ConnectivityState = initialConnectivity;
const figyelok = new Set<() => void>();
let leiratkozas: (() => void) | null = null;
let idozito: ReturnType<typeof setTimeout> | null = null;

function beallit(kovetkezo: ConnectivityState): void {
  const valtozott = kovetkezo.online !== allapot.online;
  allapot = kovetkezo;
  idozitoUjra();
  if (valtozott) figyelok.forEach((figyelo) => figyelo());
}

function jelentes(report?: ConnectivityReport): void {
  beallit(nextConnectivity(allapot, Date.now(), report));
}

/**
 * AZ IDOZITO, ES AZERT KELL: a NetInfo nem kuld ujabb esemenyt attol, hogy
 * telik az ido. Egy kitarto offline jelentes utan, vagy egy elakadt mentes
 * tartasanak vegen NEKUNK kell ujra megkerdezni magunktol -- kulonben a sav
 * sosem jelenne meg, illetve sosem tunne el.
 */
function idozitoUjra(): void {
  if (idozito !== null) clearTimeout(idozito);
  idozito = null;
  const mikor = nextWakeAt(allapot);
  if (mikor === null) return;
  idozito = setTimeout(() => jelentes(), Math.max(0, mikor - Date.now()));
}

function figyelesIndul(): void {
  if (leiratkozas !== null) return;
  leiratkozas = NetInfo.addEventListener((netinfo) =>
    jelentes({
      isConnected: netinfo.isConnected,
      isInternetReachable: netinfo.isInternetReachable,
    }),
  );
}

function subscribe(figyelo: () => void): () => void {
  figyelesIndul();
  figyelok.add(figyelo);
  return () => {
    figyelok.delete(figyelo);
  };
}

function isOnlineNow(): boolean {
  return allapot.online;
}

/**
 * A MENTESEK KERDESE: offline vagyunk-e MOST, a megerositett allapot szerint.
 *
 * A megerositett allapotot kerdezi, nem a NetInfo nyers jelenteset: egy
 * atmeneti hamis jelentesre sorba tett mentes addig varna, amig a keszulek
 * legkozelebb offline-bol online-ba valt -- mert a sor csak akkor urul.
 */
export function isDeviceOffline(): boolean {
  figyelesIndul();
  return !allapot.online;
}

/**
 * EGY MENTES VALASZ NELKUL HASALT EL. Lasd `stalledConnectivity`.
 */
export function reportUnreachable(): void {
  figyelesIndul();
  beallit(stalledConnectivity(allapot, Date.now()));
}

/**
 * A MENTESEK EZT AZ EGY OBJEKTUMOT KAPJAK. Egy helyen all, hogy egy uj hivo ne
 * tudja csak az egyik felet atvenni.
 */
export const deviceConnectivity = {
  offline: isDeviceOffline,
  unreachable: reportUnreachable,
};
