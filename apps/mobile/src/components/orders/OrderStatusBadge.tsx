import { StyleSheet, Text, View } from "react-native";

import type { OrderStatusTone } from "@/lib/orders/presentation";

export function OrderStatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: OrderStatusTone;
}) {
  return (
    <View
      style={[
        styles.badge,
        tone === "success" && styles.success,
        tone === "danger" && styles.danger,
      ]}
    >
      <Text
        style={[
          styles.text,
          tone === "success" && styles.successText,
          tone === "danger" && styles.dangerText,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#173b55",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  success: { backgroundColor: "#123f3b" },
  danger: { backgroundColor: "#4a282c" },
  text: { color: "#b7cedd", fontSize: 11, fontWeight: "800" },
  successText: { color: "#6de0ce" },
  dangerText: { color: "#ffaaa0" },
});
