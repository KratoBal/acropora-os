import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AssetCard } from "@/components/assets/AssetCard";
import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import { listAssets } from "@/lib/api/assets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { readCachedAssets, rememberAssets } from "@/lib/offline/asset-cache";
import {
  syncAssetsForOffline,
  type OfflineSyncResult,
} from "@/lib/offline/asset-sync";
import { useIsOnline } from "@/lib/offline/connectivity";
import { describeOfflineNotice } from "@/lib/offline/offline-notice";

const PAGE_SIZE = 50;
const OFFLINE_CACHE_KEY = ["offline-assets"] as const;

export default function AssetListScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();
  const queryClient = useQueryClient();
  const [sync, setSync] = useState<OfflineSyncResult | null>(null);
  // Egy teljes lehúzás képernyő-megnyitásonként. A lista frissítése (lehúzás)
  // az ELSŐ oldalt hozza; a másolatot nem kell minden mozdulatra újraépíteni.
  const pulled = useRef(false);

  const query = useQuery({
    queryKey: ["service-assets", { page: 1, pageSize: PAGE_SIZE }],
    // A hívás akkor is elindul, ha a készülék offline-nak mondja magát: a
    // jelzése tévedhet, és egy működő lekérdezést nem tarthat vissza.
    queryFn: () => listAssets(1, PAGE_SIZE),
    enabled: status === "authenticated" && Boolean(capabilities?.assetsView),
  });

  const cached = useQuery({
    queryKey: OFFLINE_CACHE_KEY,
    queryFn: readCachedAssets,
    enabled: status === "authenticated" && Boolean(capabilities?.assetsView),
  });

  useEffect(() => {
    if (!query.data || pulled.current) return;
    pulled.current = true;
    void (async () => {
      const result = await syncAssetsForOffline({
        fetchPage: (page) => listAssets(page, PAGE_SIZE),
        remember: rememberAssets,
      });
      setSync(result);
      await queryClient.invalidateQueries({ queryKey: OFFLINE_CACHE_KEY });
    })();
  }, [query.data, queryClient]);

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.assetsView) return <Redirect href="/" />;

  /*
   * A MENTETT MÁSOLAT CSAK AKKOR KERÜL ELŐ, HA A SZERVER NEM VÁLASZOLT. Nem a
   * készülék offline jelzése dönt: az tévedhet, és egy fölöslegesen mentett
   * másolatból dolgozó képernyő a tegnapi állapotot mutatná úgy, hogy közben
   * elérhető a mai.
   */
  const serverItems = query.data?.items;
  const cachedItems = cached.data?.items ?? [];
  const showingCache = !serverItems && cachedItems.length > 0;
  const items = serverItems ?? cachedItems;

  const notice = describeOfflineNotice({
    online: online && !query.isError,
    syncedAt: cached.data?.syncedAt ?? null,
    itemCount: cachedItems.length,
    now: new Date(),
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.container}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>ASSET MANAGEMENT</Text>
            <Text style={styles.title}>Partnereszközök</Text>
            <Text style={styles.subtitle}>
              Húzd le a listát a frissítéshez, vagy olvasd le a matricán lévő
              QR-kódot a telefon kamerájával.
            </Text>
            {notice ? <OfflineNoticeCard notice={notice} /> : null}
            {/*
              MI VAN A KÉSZÜLÉKEN. Egy szám, a helyszínre indulás előtt: ebből
              látszik, hogy a másolat készen áll-e, és az is, ha a felső korlát
              elvágta. Egy csendben levágott másolat ugyanúgy néz ki, mint a
              teljes.
            */}
            {sync ? (
              <Text style={styles.cacheLine}>
                {sync.truncated
                  ? `Helyszíni másolat: ${sync.itemsSaved} eszköz mentve a ${sync.totalItems} közül. A többi csak térerővel érhető el.`
                  : sync.failed
                    ? `Helyszíni másolat: ${sync.itemsSaved} eszköz mentve, a letöltés megszakadt. Térerőnél nyisd meg újra a listát.`
                    : `Helyszíni másolat: ${sync.itemsSaved} eszköz mentve.`}
              </Text>
            ) : null}
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => router.push("/assets/scanner")}
                style={styles.primaryButton}
              >
                <Text style={styles.buttonText}>QR-kód beolvasása</Text>
              </Pressable>
              {capabilities.assetsManage ? (
                <Pressable
                  onPress={() => router.push("/assets/new")}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.buttonText}>Új eszköz</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          query.isPending && cachedItems.length === 0 ? (
            <ActivityIndicator color="#52d6c7" />
          ) : query.isError && !showingCache ? (
            <View style={styles.messageCard}>
              <Text style={styles.errorTitle}>
                Az eszközök nem tölthetők be
              </Text>
              <Text style={styles.messageText}>
                {query.error instanceof Error
                  ? query.error.message
                  : "Ismeretlen hiba történt."}
              </Text>
              <Pressable
                onPress={() => void query.refetch()}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Újrapróbálás</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.messageCard}>
              <Text style={styles.errorTitle}>Még nincs aktív eszköz</Text>
              <Text style={styles.messageText}>
                Az adminfelületen rögzített partnereszközök itt jelennek meg.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <AssetCard
            asset={item}
            onPress={() =>
              router.push({ pathname: "/assets/[id]", params: { id: item.id } })
            }
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 36 },
  header: { marginBottom: 20 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900", marginTop: 6 },
  subtitle: { color: "#91afbe", fontSize: 14, lineHeight: 21, marginTop: 6 },
  cacheLine: { color: "#789cad", fontSize: 12, marginTop: 10 },
  separator: { height: 12 },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },
  primaryButton: {
    borderRadius: 10,
    backgroundColor: "#177b74",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  secondaryButton: {
    borderRadius: 10,
    backgroundColor: "#16495e",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "#2b657d",
  },
  messageCard: {
    borderRadius: 18,
    backgroundColor: "#0d2b40",
    borderWidth: 1,
    borderColor: "#1c4963",
    padding: 18,
    gap: 8,
  },
  errorTitle: { color: "#f4fbff", fontSize: 17, fontWeight: "800" },
  messageText: { color: "#a9c4d1", lineHeight: 20 },
  button: {
    alignSelf: "flex-start",
    borderRadius: 10,
    backgroundColor: "#177b74",
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 5,
  },
  buttonText: { color: "white", fontWeight: "800" },
});
