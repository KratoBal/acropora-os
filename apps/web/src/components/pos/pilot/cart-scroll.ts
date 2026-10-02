/**
 * Where a scroll container's `scrollTop` has to go so that `row` is fully
 * visible inside it, with `scrollIntoView({ block: "nearest" })` semantics:
 * no move if the row is already visible, otherwise the smallest move that
 * shows it (a row taller than the container is aligned to its top edge).
 *
 * Why not `row.scrollIntoView(...)`: that scrolls EVERY scrollable ancestor,
 * the page included. Below `lg` the cart list is not its own scroll
 * container, and a page jump down to the cart on every add would take the
 * search box out of view - the thing the cashier is typing into. This
 * helper only ever moves the one container it is given.
 *
 * Inputs are `getBoundingClientRect()` boxes (viewport coordinates) plus the
 * container's current `scrollTop`.
 */
export function nearestScrollTop(
  container: { top: number; height: number },
  scrollTop: number,
  row: { top: number; height: number },
): number {
  const rowTop = row.top - container.top + scrollTop;
  const rowBottom = rowTop + row.height;
  const viewBottom = scrollTop + container.height;

  if (rowTop < scrollTop || row.height > container.height) return rowTop;
  if (rowBottom > viewBottom) return rowBottom - container.height;
  return scrollTop;
}

/** Scrolls `row` into view inside `container` only, never the page. */
export function scrollRowIntoContainer(
  container: HTMLElement,
  row: HTMLElement,
): void {
  const next = nearestScrollTop(
    container.getBoundingClientRect(),
    container.scrollTop,
    row.getBoundingClientRect(),
  );
  if (next !== container.scrollTop) container.scrollTop = next;
}
