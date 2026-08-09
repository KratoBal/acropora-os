import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { getUnasOrder } from "@/lib/api/orders";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getWebshopCapabilities } from "@/lib/auth/webshop-authorization";
import {
  formatDateTime,
  formatMoney,
  orderStatusPresentation,
} from "@/lib/orders/presentation";

const INVOICE_STATUS_LABEL = {
  NOT_BILLABLE: "Nem számlázható",
  BILLABLE: "Számlázható",
  BILLED: "Számlázva",
} as const;

export default function OrderDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const orderId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { status, user } = useAuth();
  const capabilities = user ? getWebshopCapabilities(user.role) : null;
  const order = useQuery({
    queryKey: ["unas-order", orderId],
    queryFn: () => getUnasOrder(orderId ?? ""),
    enabled: Boolean(
      capabilities?.ordersView && orderId && status === "authenticated",
    ),
  });

  if (status !== "authenticated" || !user || !capabilities) {
    return <Redirect href="/login" />;
  }

  if (!capabilities.ordersView) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>
            Nincs hozzáférésed ehhez a rendeléshez
          </Text>
          <Text style={styles.errorText}>
            A megnyitáshoz orders.view jogosultság szükséges.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!orderId) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Hiányzó rendelésazonosító</Text>
        </View>
      </SafeAreaView>
    );
  }

  const detail = order.data;
  const orderStatus = detail ? orderStatusPresentation(detail) : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={order.isRefetching && !order.isPending}
            onRefresh={() => void order.refetch()}
            tintColor="#52d6c7"
          />
        }
      >
        {order.isPending ? (
          <ActivityIndicator color="#52d6c7" size="large" />
        ) : null}
        {order.isError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {order.error instanceof Error
                ? order.error.message
                : "A rendelés betöltése nem sikerült."}
            </Text>
            <Pressable
              onPress={() => void order.refetch()}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Újrapróbálás</Text>
            </Pressable>
          </View>
        ) : null}

        {detail && orderStatus ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.eyebrow}>WEBSHOP RENDELÉS</Text>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{detail.orderNumber}</Text>
                <OrderStatusBadge
                  label={orderStatus.label}
                  tone={orderStatus.tone}
                />
              </View>
              <Text style={styles.buyer}>
                {detail.buyerName ?? "Ismeretlen vevő"}
              </Text>
            </View>

            <Section title="Áttekintés">
              <InfoRow label="E-mail" value={detail.buyerEmail ?? "—"} />
              <InfoRow
                label="Fizetés"
                value={`${detail.paymentName ?? "—"}${detail.paymentStatus ? ` · ${detail.paymentStatus}` : ""}`}
              />
              <InfoRow label="Szállítás" value={detail.shippingName ?? "—"} />
              <InfoRow
                label="Rendelés ideje"
                value={formatDateTime(detail.orderedAt)}
              />
              <InfoRow
                label="Rögzítve"
                value={formatDateTime(detail.createdAt)}
              />
              {detail.unasDeletedAt ? (
                <InfoRow
                  label="UNAS-törlés felismerve"
                  value={formatDateTime(detail.unasDeletedAt)}
                  danger
                />
              ) : null}
              <View style={styles.totals}>
                <Total
                  label="Nettó"
                  value={formatMoney(detail.totalNet, detail.currency)}
                />
                <Total
                  label="ÁFA"
                  value={formatMoney(detail.totalTax, detail.currency)}
                />
                <Total
                  label="Bruttó"
                  value={formatMoney(detail.totalGross, detail.currency)}
                  emphasized
                />
              </View>
            </Section>

            <Section title="Számla">
              <InfoRow
                label="UNAS számlaállapot"
                value={
                  detail.unasInvoiceStatus
                    ? INVOICE_STATUS_LABEL[detail.unasInvoiceStatus]
                    : "Nincs adat"
                }
              />
              {detail.invoices.length === 0 ? (
                <Text style={styles.mutedText}>
                  Ehhez a rendeléshez még nincs tükrözött számla.
                </Text>
              ) : (
                detail.invoices.map((invoice) => (
                  <View key={invoice.id} style={styles.invoiceRow}>
                    <View style={styles.invoiceText}>
                      <Text style={styles.invoiceNumber}>
                        {invoice.invoiceNumber}
                      </Text>
                      <Text style={styles.mutedText}>
                        {invoice.syncStatus === "RECEIVED"
                          ? "Fogadva"
                          : invoice.syncStatus === "PENDING"
                            ? "Feldolgozás alatt"
                            : "Hiba"}
                      </Text>
                    </View>
                    {invoice.externalUrl ? (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() =>
                          void Linking.openURL(invoice.externalUrl!)
                        }
                        style={styles.linkButton}
                      >
                        <Text style={styles.linkButtonText}>PDF</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))
              )}
            </Section>

            <Section title={`Tételek (${detail.lines.length})`}>
              {detail.lines.map((line) => (
                <View
                  key={line.id}
                  style={[
                    styles.line,
                    line.unasRemovedAt && styles.removedLine,
                  ]}
                >
                  <View style={styles.lineTop}>
                    <View style={styles.lineText}>
                      <Text style={styles.lineDescription}>
                        {line.description}
                      </Text>
                      <Text style={styles.lineSku}>
                        {line.sku || "Nincs cikkszám"}
                      </Text>
                    </View>
                    <Text style={styles.lineGross}>
                      {formatMoney(line.lineGross, detail.currency)}
                    </Text>
                  </View>
                  <View style={styles.lineBottom}>
                    <Text style={styles.mutedText}>
                      {line.quantity} {line.unit}
                    </Text>
                    <Text style={styles.mutedText}>
                      Nettó egységár:{" "}
                      {formatMoney(line.unitNet, detail.currency)}
                    </Text>
                  </View>
                  {line.unasRemovedAt ? (
                    <Text style={styles.removedText}>
                      A tételt később eltávolították a UNAS-rendelésből.
                    </Text>
                  ) : null}
                  {line.syncStatus === "FAILED" ? (
                    <Text style={styles.removedText}>
                      {line.syncError ?? "Tételszinkronizálási hiba"}
                    </Text>
                  ) : null}
                </View>
              ))}
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={[styles.infoValue, danger && styles.dangerText]}>
        {value}
      </Text>
    </View>
  );
}

function Total({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <View style={styles.totalBlock}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={[styles.totalValue, emphasized && styles.totalEmphasized]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { gap: 14, padding: 20, paddingBottom: 36 },
  centered: { flex: 1, gap: 10, justifyContent: "center", padding: 24 },
  hero: { gap: 8, paddingBottom: 4, paddingTop: 12 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  buyer: { color: "#b7cedd", fontSize: 16, fontWeight: "600" },
  section: {
    backgroundColor: "#0b263d",
    borderColor: "#164668",
    borderRadius: 18,
    borderWidth: 1,
    gap: 13,
    padding: 17,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 18, fontWeight: "800" },
  infoRow: {
    alignItems: "flex-start",
    borderTopColor: "#143a55",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingTop: 11,
  },
  infoLabel: { color: "#7ea3b9", flex: 1, fontSize: 12 },
  infoValue: {
    color: "#d9edf7",
    flex: 1.5,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
  dangerText: { color: "#ffaaa0" },
  totals: {
    borderTopColor: "#1b4b68",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    paddingTop: 14,
  },
  totalBlock: { flex: 1, gap: 4 },
  totalLabel: { color: "#6f93a8", fontSize: 11 },
  totalValue: { color: "#c7dce8", fontSize: 12, fontWeight: "700" },
  totalEmphasized: { color: "#52d6c7", fontSize: 14, fontWeight: "900" },
  invoiceRow: {
    alignItems: "center",
    borderTopColor: "#143a55",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingTop: 12,
  },
  invoiceText: { flex: 1, gap: 3 },
  invoiceNumber: { color: "#d9edf7", fontSize: 14, fontWeight: "800" },
  mutedText: { color: "#7ea3b9", fontSize: 12, lineHeight: 17 },
  linkButton: {
    backgroundColor: "#166a7a",
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  linkButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "800" },
  line: {
    borderTopColor: "#143a55",
    borderTopWidth: 1,
    gap: 9,
    paddingTop: 13,
  },
  removedLine: { opacity: 0.68 },
  lineTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  lineText: { flex: 1, gap: 4 },
  lineDescription: {
    color: "#d9edf7",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
  },
  lineSku: { color: "#6f93a8", fontSize: 11 },
  lineGross: { color: "#52d6c7", fontSize: 13, fontWeight: "800" },
  lineBottom: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  removedText: { color: "#ffaaa0", fontSize: 11, lineHeight: 16 },
  errorCard: {
    alignItems: "flex-start",
    backgroundColor: "#3b2b2d",
    borderRadius: 14,
    gap: 11,
    padding: 15,
  },
  errorTitle: { color: "#ffd0ca", fontSize: 20, fontWeight: "800" },
  errorText: { color: "#ffb4ab", fontSize: 13, lineHeight: 19 },
  retryButton: {
    borderColor: "#8c5552",
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  retryText: { color: "#ffd0ca", fontSize: 12, fontWeight: "800" },
});
