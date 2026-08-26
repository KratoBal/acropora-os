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
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { listServicePartners } from "@/lib/api/partners";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getWebshopCapabilities } from "@/lib/auth/webshop-authorization";
import { partnerListSubtitle } from "@/lib/partners/partner-presentation";

const PAGE_SIZE = 25;

/**
 * SZERVIZ PARTNEREK, telefonon.
 *
 * A lista CSAK a szerviz-jelölt partnereké, és a szűrés a szerveren történik
 * (`kind=SERVICE`): egy már lapozott halmazt itt szűrni annyi lenne, mint
 * huszonöt sor helyett ötöt mutatni egy oldalon, miközben a darabszám a
 * kihagyottakat is számolja.
 *
 * A képernyő nem ír. A szerver a `SERVICE` szerepkörnek `partners.view` jogot
 * ad, `partners.manage` jogot nem -- egy szerkesztő gomb itt nem hiányzik,
 * hanem nem is lenne szabad működnie.
 */
export default function PartnersScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getWebshopCapabilities(user.role) : null;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const partners = useQuery({
    queryKey: ["service-partners", { page, search }],
    queryFn: () => listServicePartners(page, PAGE_SIZE, search),
    enabled: Boolean(capabilities?.partnersView && status === "authenticated"),
    placeholderData: keepPreviousData,
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;

  if (!capabilities.partnersView)
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>
            Nincs hozzáférésed a partnerekhez
          </Text>
          <Text style={styles.errorText}>
            A megnyitáshoz partners.view jogosultság szükséges.
          </Text>
        </View>
      </SafeAreaView>
    );

  const items = partners.data?.items ?? [];
  const total = partners.data?.pagination.totalItems ?? 0;
  const totalPages = partners.data?.pagination.totalPages ?? 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={partners.isRefetching && !partners.isPending}
            onRefresh={() => void partners.refetch()}
            tintColor="#52d6c7"
          />
        }
      >
        <Text style={styles.eyebrow}>SZERVIZ</Text>
        <Text style={styles.title}>Partnerek</Text>
        <Text style={styles.subtitle}>
          {partners.data
            ? `${total.toLocaleString("hu-HU")} szerviz partner`
            : "Szerviz jelölővel rendelkező partnerek"}
        </Text>

        <TextInput
          value={search}
          onChangeText={(value) => {
            setSearch(value);
            // Új keresés = első oldal. Enélkül egy szűkebb találati halmaz
            // harmadik oldalán állnánk, ami üresen jönne vissza.
            setPage(1);
          }}
          placeholder="Keresés név vagy kód szerint"
          placeholderTextColor="#668798"
          style={styles.input}
        />

        {partners.isPending ? <ActivityIndicator color="#52d6c7" /> : null}

        {partners.isError ? (
          <Text style={styles.error}>
            {partners.error instanceof Error
              ? partners.error.message
              : "A partnerlista nem tölthető be."}
          </Text>
        ) : null}

        {!partners.isPending && !partners.isError && items.length === 0 ? (
          <Text style={styles.empty}>
            {search.trim()
              ? "Erre a keresésre nincs szerviz partner."
              : "Még nincs szerviz jelölővel ellátott partner."}
          </Text>
        ) : null}

        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() =>
              router.push({
                pathname: "/partners/[id]",
                params: { id: item.id },
              })
            }
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowMeta}>{partnerListSubtitle(item)}</Text>
          </Pressable>
        ))}

        {totalPages > 1 ? (
          <View style={styles.pager}>
            <Pressable
              disabled={page <= 1}
              onPress={() => setPage((value) => Math.max(1, value - 1))}
              style={[styles.pagerButton, page <= 1 && styles.disabled]}
            >
              <Text style={styles.pagerText}>Előző</Text>
            </Pressable>
            <Text style={styles.pagerLabel}>
              {page} / {totalPages}
            </Text>
            <Pressable
              disabled={page >= totalPages}
              onPress={() =>
                setPage((value) => Math.min(totalPages, value + 1))
              }
              style={[
                styles.pagerButton,
                page >= totalPages && styles.disabled,
              ]}
            >
              <Text style={styles.pagerText}>Következő</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 48, gap: 12 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  subtitle: { color: "#91afbe" },
  input: {
    color: "#f4fbff",
    backgroundColor: "#071f31",
    borderColor: "#28536a",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  row: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  pressed: { opacity: 0.75 },
  rowTitle: { color: "#f4fbff", fontSize: 16, fontWeight: "800" },
  rowMeta: { color: "#789cad", fontSize: 12, marginTop: 3 },
  empty: { color: "#91afbe" },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
  errorTitle: { color: "#f4fbff", fontSize: 18, fontWeight: "900" },
  errorText: { color: "#91afbe", marginTop: 6, textAlign: "center" },
  pager: { flexDirection: "row", alignItems: "center", gap: 12 },
  pagerButton: {
    backgroundColor: "#164057",
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pagerText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  pagerLabel: { color: "#91afbe", fontSize: 12 },
  disabled: { opacity: 0.5 },
});
