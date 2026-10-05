/**
 * THE NUMBERS NEXT TO THREE MENU ITEMS (Balázs, 2026-10-05 22:10 UTC; card
 * 4a6813db; survey: agents/nautilus/megosztas/menu-szamlalok-felmeres-2026-10-05.md).
 *
 * Each counts what is waiting on ME, not what is new:
 *   service-jobs               repair tickets assigned to me, not finished
 *   worksheets                 worksheets assigned to me, still to sign
 *                              (the latest version is a draft or rejected)
 *   material-requests-pending  for a purchaser (the "anyag beérkezett"
 *                              capability): requests waiting to be taken
 *                              over; for anyone else: my own open requests
 *
 * The keys are the navigation registry's ids (`navigation.ts`), so the web
 * menu and the mobile tiles name the same entry. `null`: not counted for this
 * user (no permission, or a partner on an internal-only list); the menu then
 * shows no number, as for zero.
 */
export const NAVIGATION_COUNTER_IDS = [
  "service-jobs",
  "worksheets",
  "material-requests-pending",
] as const;

export type NavigationCounterId = (typeof NAVIGATION_COUNTER_IDS)[number];

export type NavigationCounters = Readonly<
  Record<NavigationCounterId, number | null>
>;

export function isNavigationCounterId(id: string): id is NavigationCounterId {
  return (NAVIGATION_COUNTER_IDS as readonly string[]).includes(id);
}

/** The badge text: nothing for none, "99+" above 99, as the messages badge. */
export function navigationCounterLabel(
  count: number | null | undefined,
): string | null {
  if (!count || count < 1) return null;
  return count > 99 ? "99+" : String(count);
}
