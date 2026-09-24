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

import { AquariumBadge } from "@/components/aquariums/AquariumBadge";
import { ConnectivityBanner } from "@/components/offline/ConnectivityBanner";
import { listAquariums } from "@/lib/api/aquariums";
import { aquariumListSubtitle } from "@/lib/aquariums/aquarium-list";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { useIsOnline } from "@/lib/offline/connectivity";

const PAGE_SIZE = 25;

/**
 * AKVÁRIUMOK LISTÁJA.
 *
 * Acrobot döntése (2026-09-24 14:13): felvitel lista nélkül nem adható ki a
 * telefonra -- ez a képernyő a `new.tsx` (felvitel, 2026-09-24, murena) mellé
 * kerül, ugyanazokra a típusokra és címkékre építve.
 *
 * OFFLINE MÁSOLAT NINCS, SZÁNDÉKOSAN. Az akvárium-felvitel a partner
 * HELYSZÍNÉN történik, de nem a szerelő napi listája, amit térerő nélkül is
 * látnia kell -- ritka esemény, és az `assets` képernyő offline-rétegének
 * átvétele itt korai absztrakció lenne. A FELVITEL maga már sorba áll térerő
 * nélkül (`saveOrQueue`, lásd `new.tsx`); ez a lista csak a MEGTEKINTÉST
 * fedi, ahhoz pedig kapcsolat kell.
 *
 * A KÁRTYA-SZERKEZET (2026-09-24, acrobot kérése) a Figma-terv
 * (`exchange/figma-akvariumok-make-2`) mobil szekciójából jön: a sorrend és a
 * jelvény onnan, a SZÍNEK viszont a mai sötét témából -- Balázs döntése, hogy
 * a telefon egésze egyelőre sötét marad, ne csak ez a három képernyő.
 */
export default function AquariumsScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const aquariums = useQuery({
    queryKey: ["aquariums", { page, search }],
    queryFn: () => listAquariums(page, PAGE_SIZE, search),
    enabled: Boolean(capabilities?.aquariumsView && status === "authenticated"),
    placeholderData: keepPreviousData,
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;

  if (!capabilities.aquariumsView)
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>
            Nincs hozzáférésed az akváriumokhoz
          </Text>
          <Text style={styles.errorText}>
            A megnyitáshoz aquariums.view jogosultság szükséges.
          </Text>
        </View>
      </SafeAreaView>
    );

  const items = aquariums.data?.items ?? [];
  const total = aquariums.data?.pagination.totalItems ?? 0;
  const totalPages = aquariums.data?.pagination.totalPages ?? 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={aquariums.isRefetching && !aquariums.isPending}
            onRefresh={() => void aquariums.refetch()}
            tintColor="#52d6c7"
          />
        }
      >
        {!online ? <ConnectivityBanner /> : null}

        <Text style={styles.eyebrow}>SZERVIZ</Text>
        <Text style={styles.title}>Akváriumok</Text>
        <Text style={styles.subtitle}>
          {aquariums.data
            ? `${total.toLocaleString("hu-HU")} akvárium és tó`
            : "Saját és ügyfél akváriumai, tavai"}
        </Text>

        {capabilities.aquariumsManage ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/aquariums/new")}
            style={({ pressed }) => [
              styles.newButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.newButtonText}>Új akvárium</Text>
          </Pressable>
        ) : null}

        <TextInput
          value={search}
          onChangeText={(value) => {
            setSearch(value);
            // Új keresés = első oldal. Enélkül egy szűkebb találati halmaz
            // harmadik oldalán állnánk, ami üresen jönne vissza.
            setPage(1);
          }}
          placeholder="Keresés név vagy azonosító szerint"
          placeholderTextColor="#668798"
          style={styles.input}
        />

        {aquariums.isPending ? <ActivityIndicator color="#52d6c7" /> : null}

        {aquariums.isError ? (
          <Text style={styles.error}>
            {aquariums.error instanceof Error
              ? aquariums.error.message
              : "Az akváriumlista nem tölthető be."}
          </Text>
        ) : null}

        {!aquariums.isPending && !aquariums.isError && items.length === 0 ? (
          <Text style={styles.empty}>
            {search.trim()
              ? "Erre a keresésre nincs akvárium."
              : "Még nincs felvéve akvárium."}
          </Text>
        ) : null}

        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() =>
              router.push({
                pathname: "/aquariums/[id]",
                params: { id: item.id },
              })
            }
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <AquariumBadge
                tone={item.ownershipType === "OWN" ? "teal" : "grey"}
              >
                {item.ownershipType === "OWN" ? "Saját" : "Ügyfél"}
              </AquariumBadge>
            </View>
            <Text style={styles.rowMeta}>{aquariumListSubtitle(item)}</Text>
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
  newButton: {
    alignSelf: "flex-start",
    borderRadius: 10,
    backgroundColor: "#177b74",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  newButtonText: { color: "white", fontWeight: "800" },
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
  rowHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  rowTitle: {
    color: "#f4fbff",
    fontSize: 16,
    fontWeight: "800",
    flexShrink: 1,
  },
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
