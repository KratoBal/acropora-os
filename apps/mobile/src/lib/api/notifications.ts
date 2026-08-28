import { Platform } from "react-native";

import { devicePlatform } from "../notifications/push-platform";
import { apiRequest } from "./client";

/**
 * A végpont előtagja EGY HELYEN. Ez a fájl korábban 2-szer írta le ugyanezt, és
 * 2026-08-27-én a munkalap-kliens pontosan ezért tudott HÁROM helyen egyszerre
 * rossz előtaggal hívni: a szerkezet megengedte, hogy egy helyen javuljon és a
 * másik kettőben ne. Egy konstansnál ez a hiba nem tud részlegesen megtörténni.
 */
const BASE = "/notifications/device-tokens";

export interface DeviceTokenRegistration {
  token: string;
  bundleId: string;
}

/**
 * Tells the server where to reach this phone.
 *
 * The owner is never sent: the server takes it from the session. A client
 * that could name the user could subscribe a colleague's phone to its own
 * notifications.
 */
export async function registerDeviceToken(
  input: DeviceTokenRegistration,
): Promise<void> {
  await apiRequest<{ ok: true }>(BASE, {
    method: "POST",
    // A PLATFORM A FUTÓKÖRNYEZETBŐL, nem beégetve. A leképezés a
    // `notifications/push-platform.ts` fájlban áll, mert ez a modul a
    // `client.ts` fájlon át Expo futásidejű kódot húz be, tehát ide teszt nem
    // ér el -- a döntés viszont mérhető kell legyen.
    body: JSON.stringify({
      ...input,
      platform: devicePlatform(Platform.OS),
    }),
  });
}

/**
 * A KESZULEK LEKAPCSOLASA AZ ERTESITESEKROL.
 *
 * A token a TORZSBEN megy, nem az utvonalban: hitelesito adat egy telefonhoz,
 * az utvonal viszont bekerul a hozzaferesi naplokba. A gazdat a szerver a
 * munkamenetbol veszi, es a torles arra is szur -- egy ismert token birtokaban
 * sem lehet MAS keszuleket lekapcsolni.
 */
export async function forgetDeviceToken(token: string): Promise<void> {
  await apiRequest<{ ok: true; removed: number }>(BASE, {
    method: "DELETE",
    body: JSON.stringify({ token }),
  });
}
