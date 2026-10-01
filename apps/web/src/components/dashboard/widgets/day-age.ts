/** Whole days between an ISO instant and now, never negative. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function daysAgoLabel(days: number): string {
  return days === 0 ? "ma" : `${days} napja`;
}
