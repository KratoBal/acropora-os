import { TILE_ENTRY, type TileCode } from "../auth/tile-visibility";

/**
 * THE MENU NUMBERS ON THE PHONE (card 4a6813db, Balázs 2026-10-05 22:10 UTC):
 * the Hibajegyek, Munkalapok and Anyagigények tiles show what waits on ME.
 *
 * A copy of `NavigationCounters` (`packages/types/src/navigation-counters.ts`):
 * the app is outside the pnpm workspace. `mobile-response-mirror.spec.ts`
 * holds the two texts equal.
 */
export type NavigationCounterId =
  "service-jobs" | "worksheets" | "material-requests-pending";

export type NavigationCounters = Readonly<
  Record<NavigationCounterId, number | null>
>;

const COUNTED: readonly string[] = [
  "service-jobs",
  "worksheets",
  "material-requests-pending",
];

/** A tile's number, by its navigation entry; `null` for a tile not counted. */
export function tileCount(
  code: TileCode,
  counters: NavigationCounters | undefined,
): number | null {
  const entry: string = TILE_ENTRY[code];
  if (!counters || !COUNTED.includes(entry)) return null;
  return counters[entry as NavigationCounterId];
}

/** The badge text: nothing for none, "99+" above 99, as the messages badge. */
export function tileCountLabel(
  count: number | null | undefined,
): string | null {
  if (!count || count < 1) return null;
  return count > 99 ? "99+" : String(count);
}

/** What the number counts, for the screen reader. */
export function tileCountAccessibility(
  code: TileCode,
  count: number,
): string | null {
  switch (TILE_ENTRY[code]) {
    case "service-jobs":
      return `${count} nekem kiosztott, nyitott hibajegy`;
    case "worksheets":
      return `${count} nekem kiosztott, aláíratlan munkalap`;
    case "material-requests-pending":
      return `${count} teendő anyagigény`;
    default:
      return null;
  }
}

/** The tile's badge, or `null` for no number. */
export function tileBadge(
  code: TileCode,
  counters: NavigationCounters | undefined,
): { label: string; accessibilityLabel: string } | null {
  const count = tileCount(code, counters);
  const label = tileCountLabel(count);
  const accessibilityLabel = count ? tileCountAccessibility(code, count) : null;
  return label && accessibilityLabel ? { label, accessibilityLabel } : null;
}
