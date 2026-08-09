import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { OrderListCard } from "@/components/orders/OrderListCard";
import { listUnasOrders } from "@/lib/api/orders";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getWebshopCapabilities } from "@/lib/auth/webshop-authorization";

const PAGE_SIZE = 20;

export default function OrdersScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const [page, setPage] = useState(1);
  const capabilities = user ? getWebshopCapabilities(user.role) : null;
  const orders = useQuery({
    queryKey: ["unas-orders", { page, pageSize: PAGE_SIZE }],
    queryFn: () => listUnasOrders(page, PAGE_SIZE),
    enabled: Boolean(capabilities?.ordersView && status === "authenticated"),
    placeholderData: keepPreviousData,
  });

  if (status !== "authenticated" || !user || !capabilities) {
    return <Redirect href="/login" />;
  }

  if (!capabilities.ordersView) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>
            Nincs hozzáférésed a rendelésekhez
          </Text>
          <Text style={styles.errorText}>
            A megnyitáshoz orders.view jogosultság szükséges.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={orders.isRefetching && !orders.isPending}
            onRefresh={() => void orders.refetch()}
            tintColor="#52d6c7"
          />
        }
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>UNAS WEBSHOP</Text>
          <Text style={styles.title}>Rendelések</Text>
          <Text style={styles.subtitle}>
            {orders.data
              ? `${orders.data.pagination.totalItems.toLocaleString("hu-HU")} rendelés · ${page}. oldal`
              : "Szinkronizált rendelések az Acropora OS-ből"}
          </Text>
        </View>

        {orders.isPending ? (
          <ActivityIndicator color="#52d6c7" size="large" />
        ) : null}
        {orders.isError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {orders.error instanceof Error
                ? orders.error.message
                : "A rendelések betöltése nem sikerült."}
            </Text>
            <Pressable
              onPress={() => void orders.refetch()}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Újrapróbálás</Text>
            </Pressable>
          </View>
        ) : null}

        {orders.data?.items.map((order) => (
          <OrderListCard
            key={order.id}
            order={order}
            onPress={() =>
              router.push({
                pathname: "/orders/[id]",
                params: { id: order.id },
              })
            }
          />
        ))}

        {orders.data?.items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Még nincs szinkronizált webshop rendelés.
            </Text>
          </View>
        ) : null}

        {orders.data && orders.data.pagination.totalPages > 1 ? (
          <View style={styles.pagination}>
            <PageButton
              label="‹ Előző"
              disabled={page <= 1 || orders.isFetching}
              onPress={() => setPage((current) => Math.max(1, current - 1))}
            />
            <Text style={styles.pageLabel}>
              {page} / {orders.data.pagination.totalPages}
            </Text>
            <PageButton
              label="Következő ›"
              disabled={
                page >= orders.data.pagination.totalPages || orders.isFetching
              }
              onPress={() => setPage((current) => current + 1)}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PageButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pageButton,
        disabled && styles.pageButtonDisabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.pageButtonText,
          disabled && styles.pageButtonTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { gap: 12, padding: 20, paddingBottom: 36 },
  hero: { gap: 6, paddingBottom: 8, paddingTop: 12 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 30, fontWeight: "900" },
  subtitle: { color: "#86a7ba", fontSize: 13 },
  centered: { flex: 1, gap: 10, justifyContent: "center", padding: 24 },
  errorTitle: { color: "#ffd0ca", fontSize: 20, fontWeight: "800" },
  errorCard: {
    alignItems: "flex-start",
    backgroundColor: "#3b2b2d",
    borderRadius: 14,
    gap: 11,
    padding: 15,
  },
  errorText: { color: "#ffb4ab", fontSize: 13, lineHeight: 19 },
  retryButton: {
    borderColor: "#8c5552",
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  retryText: { color: "#ffd0ca", fontSize: 12, fontWeight: "800" },
  emptyCard: { backgroundColor: "#0b263d", borderRadius: 14, padding: 18 },
  emptyText: { color: "#86a7ba", fontSize: 13 },
  pagination: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
  },
  pageButton: {
    backgroundColor: "#166a7a",
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  pageButtonDisabled: { backgroundColor: "#173247" },
  pageButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "800" },
  pageButtonTextDisabled: { color: "#607f91" },
  pageLabel: { color: "#9ab8ca", fontSize: 12, fontWeight: "700" },
  pressed: { opacity: 0.7 },
});
