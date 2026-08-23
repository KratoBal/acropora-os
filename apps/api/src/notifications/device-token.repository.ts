import { Injectable } from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";

export interface DeviceTokenRegistration {
  userId: string;
  token: string;
  bundleId: string;
  platform: "IOS" | "ANDROID";
}

export interface DeviceTokenRecipient {
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
  register(input: DeviceTokenRegistration) {
    const now = new Date();
    return this.database.deviceToken.upsert({
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
  }

  /** Every device the given colleagues can be reached on. */
  async recipients(
    userIds: readonly string[],
  ): Promise<DeviceTokenRecipient[]> {
    if (userIds.length === 0) return [];
    return this.database.deviceToken.findMany({
      where: { userId: { in: [...userIds] } },
      select: { token: true, bundleId: true },
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
