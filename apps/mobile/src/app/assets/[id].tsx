import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";

import { getAsset } from "@/lib/api/assets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

const STATUS_LABELS = {
  ACTIVE: "Aktív",
  OUT_OF_SERVICE: "Nem üzemel",
  IN_REPAIR: "Javítás alatt",
  RETIRED: "Kivezetett",
} as const;

const KIND_LABELS = {
  SYSTEM: "Rendszer",
  EQUIPMENT: "Berendezés",
  COMPONENT: "Részegység",
  SENSOR: "Szenzor",
  OTHER: "Egyéb",
} as const;

export default function AssetDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const query = useQuery({
    queryKey: ["service-asset", id],
    queryFn: () => getAsset(id!),
    enabled:
      status === "authenticated" && Boolean(id && capabilities?.assetsView),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.assetsView) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        {query.isPending ? <ActivityIndicator color="#52d6c7" /> : null}
        {query.isError ? (
          <MessageCard
            title="Az eszköz nem tölthető be"
            message={
              query.error instanceof Error
                ? query.error.message
                : "Ismeretlen hiba történt."
            }
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.number}>{query.data.assetNumber}</Text>
              <Text style={styles.title}>{query.data.name}</Text>
              <View style={styles.badges}>
                <Text style={styles.badge}>{KIND_LABELS[query.data.kind]}</Text>
                <Text style={styles.badge}>
                  {STATUS_LABELS[query.data.status]}
                </Text>
              </View>
            </View>

            <Section title="Elhelyezés">
              <Info label="Partner" value={query.data.customer.displayName} />
              <Info label="Partnerkód" value={query.data.customer.customerNumber} />
              <Info label="Helyszín" value={query.data.address?.formatted} />
              <Info label="Akvárium" value={query.data.aquarium?.name} />
            </Section>

            <Section title="Műszaki adatok">
              <Info label="Gyártó" value={query.data.manufacturer} />
              <Info label="Modell" value={query.data.model} />
              <Info label="Sorozatszám" value={query.data.serialNumber} />
              <Info label="Leltári szám" value={query.data.inventoryNumber} />
              <Info label="Termék" value={query.data.product?.name} />
              <Info label="Leírás" value={query.data.description} />
            </Section>

            <Section title="Karbantartás">
              <Info
                label="Következő karbantartás"
                value={formatDate(query.data.nextServiceAt)}
              />
              <Info
                label="Utolsó karbantartás"
                value={formatDate(query.data.lastServicedAt)}
              />
              <Info
                label="Intervallum"
                value={
                  query.data.serviceIntervalDays
                    ? `${query.data.serviceIntervalDays} nap`
                    : undefined
                }
              />
              <Info label="Megjegyzés" value={query.data.notes} />
            </Section>

            {query.data.ancestors.length > 0 ? (
              <Section title="Rendszerútvonal">
                {query.data.ancestors.map((ancestor) => (
                  <AssetLink
                    key={ancestor.id}
                    label={ancestor.name}
                    meta={ancestor.assetNumber}
                    onPress={() =>
                      router.push({
                        pathname: "/assets/[id]",
                        params: { id: ancestor.id },
                      })
                    }
                  />
                ))}
              </Section>
            ) : null}

            {query.data.children.length > 0 ? (
              <Section title="Részegységek">
                {query.data.children.map((child) => (
                  <AssetLink
                    key={child.id}
                    label={child.name}
                    meta={child.assetNumber}
                    onPress={() =>
                      router.push({
                        pathname: "/assets/[id]",
                        params: { id: child.id },
                      })
                    }
                  />
                ))}
              </Section>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function AssetLink({
  label,
  meta,
  onPress,
}: {
  label: string;
  meta: string;
  onPress(): void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.assetLink, pressed && styles.pressed]}>
      <View>
        <Text style={styles.assetLinkLabel}>{label}</Text>
        <Text style={styles.assetLinkMeta}>{meta}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function MessageCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry(): void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>Újrapróbálás</Text>
      </Pressable>
    </View>
  );
}

function formatDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : undefined;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 40, gap: 14 },
  hero: {
    borderRadius: 22,
    padding: 20,
    backgroundColor: "#0d3146",
    borderWidth: 1,
    borderColor: "#1d536b",
  },
  number: { color: "#52d6c7", fontSize: 11, fontWeight: "900" },
  title: { color: "#f4fbff", fontSize: 27, fontWeight: "900", marginTop: 7 },
  badges: { flexDirection: "row", gap: 8, marginTop: 12 },
  badge: {
    color: "#d3eef4",
    backgroundColor: "#16495e",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "800",
  },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1c4963",
    backgroundColor: "#0d2b40",
    padding: 17,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 16, fontWeight: "900" },
  sectionBody: { marginTop: 8 },
  infoRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#153c52" },
  infoLabel: { color: "#789cad", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  infoValue: { color: "#e4f3f8", fontSize: 14, lineHeight: 20, marginTop: 3 },
  assetLink: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  assetLinkLabel: { color: "#e4f3f8", fontSize: 15, fontWeight: "700" },
  assetLinkMeta: { color: "#75a0b2", fontSize: 11, marginTop: 2 },
  chevron: { color: "#52d6c7", fontSize: 26 },
  pressed: { opacity: 0.68 },
  message: { color: "#a9c4d1", lineHeight: 20, marginTop: 8 },
  retryButton: { alignSelf: "flex-start", backgroundColor: "#177b74", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginTop: 14 },
  retryText: { color: "#fff", fontWeight: "800" },
});
