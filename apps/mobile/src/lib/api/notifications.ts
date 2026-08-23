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
