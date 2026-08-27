import { apiRequest } from "./client";

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
  await apiRequest<{ ok: true }>("/notifications/device-tokens", {
    method: "POST",
    body: JSON.stringify({ ...input, platform: "IOS" }),
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
  await apiRequest<{ ok: true; removed: number }>(
    "/notifications/device-tokens",
    { method: "DELETE", body: JSON.stringify({ token }) },
  );
}
