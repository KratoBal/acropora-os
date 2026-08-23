import { Injectable, Logger } from "@nestjs/common";

import { ApnsSender } from "./apns.sender.js";
import { DeviceTokenRepository } from "./device-token.repository.js";
import {
  NotificationLogRepository,
  type NotificationAttempt,
} from "./notification-log.repository.js";

/** What one send did, per colleague, so the caller can record it. */
export interface NotificationDelivery {
  sent: number;
  retired: number;
  failed: number;
  attempts: NotificationAttempt[];
}

export interface WorksheetAssignmentNotice {
  worksheetId: string;
  /** What the sheet is about, as the technician will read it on the lock screen. */
  subject: string;
  /** The colleagues now responsible for the sheet. */
  userIds: readonly string[];
}

/**
 * Sends the notifications the worksheet assignment triggers.
 *
 * Two rules hold this together, and both come from the system as it is today.
 *
 * There is no queue in this API - no BullMQ, no scheduler, nothing that picks
 * work up later. So the send happens inline, AFTER the assignment is stored,
 * and a failure never reaches the caller: an office colleague pressing "save"
 * must not be left waiting on Apple, and must never see the assignment fail
 * because a phone could not be reached. What is lost in that trade is a retry,
 * and that is the honest cost of having no queue.
 *
 * Missing configuration is not a failure either. A development machine has no
 * signing key; the sender says so once and stays quiet.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly deviceTokens: DeviceTokenRepository,
    private readonly sender: ApnsSender,
    private readonly log: NotificationLogRepository,
  ) {}

  /**
   * Fire and forget, on purpose: the caller has already stored the assignment
   * and its answer must not depend on this.
   */
  notifyWorksheetAssignment(notice: WorksheetAssignmentNotice): void {
    void this.deliverWorksheetAssignment(notice).catch((cause: unknown) => {
      this.logger.warn(
        `A munkalap-értesítés küldése nem sikerült (${notice.worksheetId}): ${
          cause instanceof Error ? cause.message : "ismeretlen hiba"
        }`,
      );
    });
  }

  /**
   * Send one message to a set of colleagues, on every device each of them has.
   *
   * This is the general path, and the worksheet assignment is merely its first
   * caller. Balázs asked for the CAPABILITY of sending a notification, not
   * only for the moment when somebody is put on a sheet: a manual send later
   * is then a new caller here, not a rewrite of the assignment. Nothing manual
   * is built yet - only the door is left where it belongs.
   *
   * Reports what happened per colleague, so the caller can record it against
   * whatever the notification was about.
   */
  async sendToUsers(input: {
    userIds: readonly string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<NotificationDelivery> {
    const nothing: NotificationDelivery = {
      sent: 0,
      retired: 0,
      failed: 0,
      attempts: [],
    };
    if (input.userIds.length === 0) return nothing;
    if (!this.sender.configured()) return nothing;

    const recipients = await this.deviceTokens.recipients(input.userIds);
    if (recipients.length === 0) return nothing;

    const results = await Promise.all(
      recipients.map(async (recipient) => {
        const result = await this.sender.send({
          deviceToken: recipient.token,
          bundleId: recipient.bundleId,
          title: input.title,
          body: input.body,
          data: input.data,
        });
        if (!result.ok && result.retired)
          await this.deviceTokens.retire(recipient.token);
        return { recipient, result };
      }),
    );

    return results.reduce<NotificationDelivery>(
      (totals, { recipient, result }) => ({
        sent: totals.sent + (result.ok ? 1 : 0),
        retired: totals.retired + (!result.ok && result.retired ? 1 : 0),
        failed: totals.failed + (!result.ok && !result.retired ? 1 : 0),
        attempts: [
          ...totals.attempts,
          {
            userId: recipient.userId,
            delivered: result.ok,
            ...(result.ok
              ? {}
              : { reason: result.reason, retired: result.retired }),
          },
        ],
      }),
      nothing,
    );
  }

  /**
   * The worksheet's own wording, and the only thing this layer adds to the
   * general send. The same work as `notifyWorksheetAssignment`, awaited, so
   * the tests can observe the outcome.
   */
  async deliverWorksheetAssignment(
    notice: WorksheetAssignmentNotice,
  ): Promise<{ sent: number; retired: number; failed: number }> {
    const delivery = await this.sendToUsers({
      userIds: notice.userIds,
      title: "Új munkalap került hozzád",
      body: notice.subject,
      data: { worksheetId: notice.worksheetId },
    });

    // Written down whether it went well or not. A log line answers the
    // question while somebody is watching; this answers it tomorrow, when
    // somebody asks whether the technician was told at all.
    await this.log.recordWorksheetAssignment({
      worksheetId: notice.worksheetId,
      attempts: delivery.attempts,
    });

    if (delivery.failed > 0)
      this.logger.warn(
        `Munkalap-értesítés: ${delivery.sent} kiment, ${delivery.failed} nem sikerült, ${delivery.retired} eszköz-token elévült (${notice.worksheetId}).`,
      );

    return {
      sent: delivery.sent,
      retired: delivery.retired,
      failed: delivery.failed,
    };
  }
}
