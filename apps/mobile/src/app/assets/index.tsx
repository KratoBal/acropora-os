import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AssetCard } from "@/components/assets/AssetCard";
import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import { listAssets } from "@/lib/api/assets";
import { filterAssets } from "@/lib/assets/asset-search";
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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // Egy teljes lehúzás képernyő-megnyitásonként. A lista frissítése (lehúzás)
  // az ELSŐ oldalt hozza; a másolatot nem kell minden mozdulatra újraépíteni.
  const pulled = useRef(false);

  const query = useQuery({
    queryKey: ["service-assets", { page, pageSize: PAGE_SIZE, search }],
    // A hívás akkor is elindul, ha a készülék offline-nak mondja magát: a
    // jelzése tévedhet, és egy működő lekérdezést nem tarthat vissza.
    queryFn: () => listAssets(page, PAGE_SIZE, search),
    enabled: status === "authenticated" && Boolean(capabilities?.assetsView),
    placeholderData: keepPreviousData,
  });

  const cached = useQuery({
    queryKey: OFFLINE_CACHE_KEY,
    queryFn: readCachedAssets,
    enabled: status === "authenticated" && Boolean(capabilities?.assetsView),
  });

  useEffect(() => {
    // A TELJES LEHÚZÁS SOHA NEM VISZI A KERESÉST: a mentett másolatnak
    // teljesnek kell maradnia, különben a következő térerő nélküli munkánál
    // pont az hiányozna, amire nem kerestünk rá.
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
  /*
   * A MENTETT MÁSOLATBAN A TELEFON KERES, és ez az egyetlen eset, amiben a
   * kliens oldali szűrés nem hazudik: a másolat a lista MINDEN oldalát
   * tartalmazza, tehát nem egy lapozott részhalmazon dolgozik. Ugyanazt a hat
   * mezőt nézi, mint a szerver.
   */
  const items = serverItems ?? filterAssets(cachedItems, search);
  const totalPages = query.data?.pagination.totalPages ?? 1;

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
            {/*
              KERESÉS. A szerelő egy matricát olvas le, és nem tudja, melyik
              mező az: lehet a mi eszközszámunk, a gyártó sorozatszáma vagy a
              partner leltári száma. Ezért egy mező van, és az mind a hatot
              nézi -- ugyanúgy, mint a weben.
            */}
            <TextInput
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                // Új keresés = első oldal. Enélkül egy szűkebb találati halmaz
                // harmadik oldalán állnánk, ami üresen jönne vissza.
                setPage(1);
              }}
              placeholder="Keresés szám, név vagy sorozatszám szerint"
              placeholderTextColor="#668798"
              style={styles.search}
              autoCorrect={false}
              autoCapitalize="characters"
            />
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
              {/*
                AZ ÜRES LISTA OKA. Keresés közben a „még nincs eszköz" mondat
                hamis: van eszköz, csak nem ilyen -- és a szerelő ilyenkor az
                irodát hívná ahelyett, hogy másik számot próbálna.
              */}
              <Text style={styles.errorTitle}>
                {search.trim()
                  ? "Erre a keresésre nincs eszköz"
                  : "Még nincs aktív eszköz"}
              </Text>
              <Text style={styles.messageText}>
                {search.trim()
                  ? "Próbáld a leltári számmal, a sorozatszámmal vagy a nevének egy darabjával."
                  : "Az adminfelületen rögzített partnereszközök itt jelennek meg."}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          /*
           * LAPOZÁS. A képernyő eddig az első ötven sort kérte, és ott véget is
           * ért: egy nagyobb partnernél a többi eszköz csak QR-kóddal volt
           * elérhető. Egy csendben elvágott lista ugyanúgy néz ki, mint a
           * teljes. A mentett másolatnál nincs lapozó: az egészet mutatjuk.
           */
          serverItems && totalPages > 1 ? (
            <View style={styles.pager}>
              <Pressable
                disabled={page <= 1}
                onPress={() => setPage((value) => Math.max(1, value - 1))}
                style={[styles.pagerButton, page <= 1 && styles.pagerDisabled]}
              >
                <Text style={styles.buttonText}>Előző</Text>
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
                  page >= totalPages && styles.pagerDisabled,
                ]}
              >
                <Text style={styles.buttonText}>Következő</Text>
              </Pressable>
            </View>
          ) : null
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
  search: {
    backgroundColor: "#071f31",
    borderColor: "#28536a",
    borderRadius: 10,
    borderWidth: 1,
    color: "#f4fbff",
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  pager: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    paddingTop: 18,
  },
  pagerButton: {
    backgroundColor: "#164057",
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pagerDisabled: { opacity: 0.5 },
  pagerLabel: { color: "#91afbe", fontSize: 12 },
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
