import { Injectable } from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";

export interface DeviceTokenRegistration {
  userId: string;
  token: string;
  bundleId: string;
  platform: "IOS" | "ANDROID";
}

export interface DeviceTokenRecipient {
  /** Whose phone this is. The notification log names people, never tokens. */
  userId: string;
  token: string;
  bundleId: string;
}

@Injectable()
export class DeviceTokenRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /**
   * One row per device, and the row follows the phone rather than the person.
   *
   * A shared phone is the case that decides the shape: when a second colleague
   * signs in on it, Apple hands back the same token, and the notification must
   * follow the person now holding it. Keying on the token and moving the owner
   * does that; keying on the pair would leave the previous colleague still
   * subscribed to a phone in somebody else's pocket.
   */
  async register(
    input: DeviceTokenRegistration,
  ): Promise<{ firstTime: boolean }> {
    const now = new Date();
    // Looked up first so the caller can say whether this phone is new. The
    // log line is what a TestFlight round is read from, and "a device
    // registered" and "the same device registered again" answer different
    // questions about the round.
    const existing = await this.database.deviceToken.findUnique({
      where: { token: input.token },
      select: { id: true },
    });

    await this.database.deviceToken.upsert({
      where: { token: input.token },
      create: {
        userId: input.userId,
        token: input.token,
        bundleId: input.bundleId,
        platform: input.platform,
        lastSeenAt: now,
      },
      update: {
        userId: input.userId,
        bundleId: input.bundleId,
        platform: input.platform,
        lastSeenAt: now,
      },
      select: { id: true },
    });

    return { firstTime: existing === null };
  }

  /** Every device the given colleagues can be reached on. */
  async recipients(
    userIds: readonly string[],
  ): Promise<DeviceTokenRecipient[]> {
    if (userIds.length === 0) return [];
    return this.database.deviceToken.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, token: true, bundleId: true },
    });
  }

  /**
   * Apple said this device is gone. Keeping it would mean sending into
   * nothing on every assignment from here on, and the failure would look like
   * a delivery problem rather than a device that no longer exists.
   */
  retire(token: string) {
    return this.database.deviceToken.deleteMany({ where: { token } });
  }
}
