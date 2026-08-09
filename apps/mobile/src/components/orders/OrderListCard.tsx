import { Pressable, StyleSheet, Text, View } from "react-native";

import type { UnasOrderListItem } from "@/lib/api/orders";
import {
  formatMoney,
  formatOrderDate,
  orderStatusPresentation,
} from "@/lib/orders/presentation";

import { OrderStatusBadge } from "./OrderStatusBadge";

export function OrderListCard({
  order,
  onPress,
}: {
  order: UnasOrderListItem;
  onPress(): void;
}) {
  const status = orderStatusPresentation(order);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${order.orderNumber} rendelés megnyitása`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.orderNumber}>{order.orderNumber}</Text>
          <Text style={styles.date}>{formatOrderDate(order)}</Text>
        </View>
        <OrderStatusBadge label={status.label} tone={status.tone} />
      </View>

      <Text numberOfLines={1} style={styles.buyer}>
        {order.buyerName ?? "Ismeretlen vevő"}
      </Text>

      <View style={styles.footer}>
        <Text style={styles.meta}>
          {order.lineCount} tétel
          {order.paymentName ? ` · ${order.paymentName}` : ""}
        </Text>
        <Text style={styles.total}>
          {formatMoney(order.totalGross, order.currency)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0b263d",
    borderColor: "#164668",
    borderRadius: 18,
    borderWidth: 1,
    gap: 13,
    padding: 16,
  },
  pressed: { opacity: 0.72 },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  headerText: { flex: 1, gap: 3 },
  orderNumber: { color: "#f4fbff", fontSize: 17, fontWeight: "800" },
  date: { color: "#7ea3b9", fontSize: 12 },
  buyer: { color: "#d9edf7", fontSize: 15, fontWeight: "600" },
  footer: {
    alignItems: "flex-end",
    borderTopColor: "#143a55",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingTop: 12,
  },
  meta: { color: "#7ea3b9", flex: 1, fontSize: 12 },
  total: { color: "#52d6c7", fontSize: 15, fontWeight: "800" },
});
