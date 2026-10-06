import { View } from "react-native";

import { QR_QUIET_ZONE, type QrRun } from "@/lib/assets/qr-runs";

/**
 * THE ASSET QR FROM PLAIN VIEWS (kanban 5622fe61): one view per row, one per
 * run of equal cells. No native SVG module, so it ships without a new build.
 *
 * BLACK ON WHITE IN BOTH THEMES, and that is not an oversight: a scanner
 * reads dark modules on a light ground, and an inverted code does not scan
 * on every reader. The white quiet zone is part of the code, not a margin.
 *
 * The cell is a whole number of points, so no row blurs between pixels; the
 * symbol is therefore at most `size`, not exactly.
 */
export function QrMatrix({
  runs,
  size,
  label,
}: {
  runs: QrRun[][];
  size: number;
  label: string;
}) {
  const cells = runs.length + QR_QUIET_ZONE * 2;
  const cell = Math.max(1, Math.floor(size / cells));
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        alignSelf: "center",
        backgroundColor: "#ffffff",
        padding: QR_QUIET_ZONE * cell,
      }}
    >
      {runs.map((row, y) => (
        <View key={y} style={{ flexDirection: "row", height: cell }}>
          {row.map((run, x) => (
            <View
              key={x}
              style={{
                width: run.length * cell,
                height: cell,
                backgroundColor: run.dark ? "#000000" : "#ffffff",
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
