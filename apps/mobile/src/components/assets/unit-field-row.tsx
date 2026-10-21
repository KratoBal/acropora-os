import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * A MEZO MELLE KIIRT EGYSEG (Kelecsenyi Ferenc kerese, 2026-10-21, kanban
 * 541e2716): az Aramfelvetel (A) es a Fogyasztas (kW) beviteli mezoje mellett
 * LATSZIK, hogy mibe vezetik. A mezot nem erinti: a ketto egy sorban all, az
 * egyseg a mezon KIVUL. A felvitel es a szerkeszto kozos komponense, hogy a
 * ket kepernyo ugyanazt mutassa.
 */
export function UnitFieldRow({
  unit,
  children,
}: {
  unit: string;
  children: ReactNode;
}) {
  const { tokens } = useAppTheme();
  return (
    <View style={styles.row}>
      <View style={styles.field}>{children}</View>
      <Text
        accessibilityLabel={`Egység: ${unit}`}
        style={[styles.unit, { color: tokens.textSecondary }]}
      >
        {unit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  field: { flex: 1 },
  unit: { fontSize: 15, fontWeight: "600" },
});
