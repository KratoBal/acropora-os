/**
 * THE APPROVAL REMINDER (T5.1; Balázs, 2026-11-10 17:43 UTC: "emlékeztető 2 nap", notification only in the OS).
 *
 * An item that waits for an approver for at least this long is an overdue one: the home page and the Figyelmet igényel list
 * say how many. The two days are 48 HOURS since the item entered `AWAITING_APPROVAL`, not two calendar days: an item that
 * arrived in the evening is due the evening two days later, not at midnight. The boundary counts as overdue (at exactly 48
 * hours it is due).
 */
export const APPROVAL_REMINDER_HOURS = 48;

export function isApprovalOverdue(enteredAt: Date, now: Date): boolean {
  const waited = now.getTime() - enteredAt.getTime();
  return !Number.isNaN(waited) && waited >= APPROVAL_REMINDER_HOURS * 3_600_000;
}
