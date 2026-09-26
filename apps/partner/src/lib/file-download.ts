/**
 * SAVING AND OPENING A FETCHED FILE (2026-09-26).
 *
 * The partner portal fetches every document with an authenticated `fetch`,
 * because a plain `<a href>` or `<img src>` would go out without the session
 * header and get a 401. That leaves a `Blob` in memory, and turning it into
 * something the partner can save or read is the part this module owns.
 *
 * The browser surface is INJECTED rather than read from `window`/`document`:
 * the partner test build compiles without the DOM lib and runs under
 * `node --test`, and the behaviour worth pinning (the file name survives, the
 * object URL is released, a blocked tab still yields the file) is all in the
 * sequencing, not in the DOM calls themselves.
 */

/** The slice of the browser the two helpers touch. */
export type FileSurface = {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): { href: string; download: string; click(): void };
  later(run: () => void, ms: number): void;
};

/**
 * A tab opened SYNCHRONOUSLY in the click handler, before the fetch. Opening it
 * after an `await` would lose the user gesture and the popup blocker would eat
 * it; `null` is what `window.open` returns when that happened anyway.
 */
export type PendingTab = { location: { href: string } } | null;

/**
 * The object URL is released LATER, not right after `click()`: the download
 * and the new tab both read the URL asynchronously, and a revoke that wins the
 * race leaves an empty download or a blank tab.
 */
export const REVOKE_DELAY_MS = 60_000;

/** Hands the blob to the browser's download flow under its original name. */
export function saveBlob(
  blob: Blob,
  fileName: string,
  surface: FileSurface,
): void {
  const url = surface.createObjectURL(blob);
  const anchor = surface.createAnchor();
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  surface.later(() => surface.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Shows the blob in the pre-opened tab. The stored content type is stamped on
 * the blob, because the tab renders by type: a PDF served as
 * `application/octet-stream` would be downloaded instead of shown.
 *
 * With no tab (blocked), the file is still delivered as a download, so the
 * click never ends in nothing.
 */
export function showBlob(
  tab: PendingTab,
  blob: Blob,
  contentType: string,
  fileName: string,
  surface: FileSurface,
): "opened" | "saved" {
  if (!tab) {
    saveBlob(blob, fileName, surface);
    return "saved";
  }
  const typed =
    blob.type === contentType ? blob : new Blob([blob], { type: contentType });
  const url = surface.createObjectURL(typed);
  tab.location.href = url;
  surface.later(() => surface.revokeObjectURL(url), REVOKE_DELAY_MS);
  return "opened";
}
