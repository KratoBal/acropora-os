/**
 * THE ASSET QR AS RUNS, FOR DRAWING FROM PLAIN VIEWS (kanban 5622fe61).
 *
 * The card was planned with `react-native-svg`, which is a native module: it
 * would have needed a new native build. The server sends the same symbol as
 * rows of "1" (dark) and "0" (light) next to the SVG (`AssetQrCode.modules`),
 * and a row drawn as runs of equal cells is a handful of views, not 37.
 *
 * `null` means "do not draw": a missing field (an API released before it), or
 * rows that are not a square of 0/1. A wrong picture of a QR is worse than
 * none: it scans as nothing, or as something else.
 */
export interface QrRun {
  dark: boolean;
  length: number;
}

/** The light border every QR needs around it, in cells (the label's 45 = 37 + 2 * 4). */
export const QR_QUIET_ZONE = 4;

export function qrRuns(
  modules: readonly string[] | undefined,
): QrRun[][] | null {
  if (!modules || modules.length < 21) return null;
  const size = modules.length;
  if (!modules.every((row) => row.length === size && /^[01]+$/.test(row)))
    return null;
  return modules.map((row) => {
    const runs: QrRun[] = [];
    for (const cell of row) {
      const dark = cell === "1";
      const last = runs[runs.length - 1];
      if (last && last.dark === dark) last.length += 1;
      else runs.push({ dark, length: 1 });
    }
    return runs;
  });
}
