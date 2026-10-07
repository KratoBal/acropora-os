import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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

import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import { statusBadgeStyle } from "@/lib/theme/label-styles";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { listAssets } from "@/lib/api/assets";
import {
  listServiceJobs,
  type ServiceJobListItem,
} from "@/lib/api/service-jobs";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { useIsOnline } from "@/lib/offline/connectivity";
import {
  describeOfflineNotice,
  SERVICE_JOB_NOTICE_SUBJECT,
} from "@/lib/offline/offline-notice";
import {
  readCachedServiceJobs,
  rememberServiceJobs,
} from "@/lib/offline/service-job-cache";
import {
  cachedItemsForScope,
  DEFAULT_SERVICE_JOB_SCOPE,
  itemsForScope,
  OFFLINE_COPY_SCOPE,
  SERVICE_JOB_SCOPES,
  serverScopeOf,
  type ServiceJobScope,
} from "@/lib/service-jobs/list-scope";
import {
  serviceJobCardMeta,
  serviceJobStatTiles,
} from "@/lib/service-jobs/list-card";
import { BottomNav } from "@/components/home/BottomNav";
import {
  serviceJobStatusLabel,
  shortPath,
} from "@/lib/service-jobs/service-job-status";
import {
  ujJegyEszkozzel,
  valaszthatoEszkozok,
} from "@/lib/service-jobs/uj-jegy-eszkoz";
import { readCachedAssets } from "@/lib/offline/asset-cache";
import { sessionKey } from "@/lib/session/session-memory";
import { useSessionState } from "@/lib/session/useSessionState";

const CACHE_KEY = ["offline-service-jobs"] as const;

/**
 * A HIBAJEGYEK LISTÁJA A TELEFONON.
 *
 * NÉGY SZŰRŐ (Balázs kérése, 2026-09-17), és 2026-10-04 óta a NYITOTT az
 * alapértelmezés (`DEFAULT_SERVICE_JOB_SCOPE`). A választott szűrés a
 * munkamenet idejére megmarad: egy jegy megnyitása és a visszalépés nem
 * nullázza (`useSessionState`).
 *
 * 2026-09-17-ig ez a képernyő FIXEN a nyitott jegyeket kérte. Az a szűkítés
 * szándékos volt és ki is volt mondva a fejlécben -- de a helyszínen úgy
 * jelent meg, hogy egy elkészültre léptetett jegy ELTŰNIK a listából, és nincs
 * hova visszanézni rá. A választó ezt oldja fel, és a KIVÁLASZTOTT állapot is
 * látszik: a lista soha ne legyen csendben szűkebb, mint a felirata.
 *
 * A SZŰRÉS A SZERVEREN TÖRTÉNIK, nem itt: a lista kétszáz sornál vágódik,
 * tehát egy kliens-oldali szűrő kevesebbet mutatna, mint amit ígér. Az
 * EGYETLEN kivétel a mentett másolat, ahol nincs kitől kérni -- azt a
 * `cachedItemsForScope` intézi, és ki is mondja, ha egy szűrőhöz kapcsolat
 * kell.
 *
 * A LÁTHATÓSÁGOT A SZERVER SZABJA, nem ez a képernyő: a szervizes a saját
 * helyszíneit látja. Egy kliens-oldali szűrő itt azt ígérné, hogy tudja, ki mit
 * láthat -- és a következő szabály-változásnál csendben hazudna.
 */
export default function ServiceJobListScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const capabilities = user ? getServiceCapabilities(user) : null;
  const online = useIsOnline();
  const [scope, setScope] = useSessionState<ServiceJobScope>(
    sessionKey(user?.id, "service-jobs", "scope"),
    DEFAULT_SERVICE_JOB_SCOPE,
  );

  const serverScope = serverScopeOf(scope);
  const query = useQuery({
    // A HATOKOR RESZE A KULCSNAK. Enelkul a valaszto atkapcsolasa a REGI
    // halmazt mutatna a masik felirat alatt, amig az uj lekerdezes befut.
    // "Várakozik" asks for the open list and narrows it, so the two share
    // one answer (`serverScopeOf`).
    queryKey: ["service-jobs", serverScope, "ALL"],
    // A hívás akkor is elindul, ha a készülék offline-nak mondja magát: a
    // jelzése tévedhet, és egy működő lekérdezést nem tarthat vissza.
    queryFn: () => listServiceJobs(serverScope, "ALL"),
    enabled:
      status === "authenticated" && Boolean(capabilities?.serviceJobsView),
    placeholderData: keepPreviousData,
  });

  const cached = useQuery({
    queryKey: CACHE_KEY,
    queryFn: readCachedServiceJobs,
    enabled:
      status === "authenticated" && Boolean(capabilities?.serviceJobsView),
  });

  /**
   * A MENTETT MASOLATOT CSAK A LEGTAGABB HALMAZ IRJA FELUL.
   *
   * Ha barmelyik szuro irna, a masolat ANNAK a szuronek a maradeka lenne, es a
   * kovetkezo terero nelkuli inditasnal `Osszes` feliratot kapna egy szukebb
   * lista. Igy viszont a masolat mindig ugyanazt jelenti: a legutobb latott
   * TELJES lista.
   */
  /**
   * AZ ESZKOZ-VALASZTO CSAK KINYITVA TOLT BE LISTAT.
   *
   * Ugyanaz az indok, mint a munkalap-lista partner-valasztojanal: a
   * szerelonek a JEGYEI kellenek, nem az eszkoz-torzs, es a megnyitasok
   * tulnyomo reszeben hozza sem nyul. Egy alapbol futo lekerdezes minden
   * lista-megnyitasnal egy folosleges kort vinne, tereró nelkul pedig egy
   * folosleges hibat.
   */
  const [ujJegyNyitva, setUjJegyNyitva] = useState(false);
  const [eszkozKereses, setEszkozKereses] = useState("");
  const eszkozok = useQuery({
    queryKey: ["uj-jegy-eszkozok", eszkozKereses],
    queryFn: () => listAssets(1, 50, eszkozKereses),
    enabled:
      ujJegyNyitva &&
      status === "authenticated" &&
      Boolean(capabilities?.serviceJobsManage),
    placeholderData: keepPreviousData,
  });
  const mentettEszkozok = useQuery({
    queryKey: ["offline-assets"],
    queryFn: readCachedAssets,
    enabled: ujJegyNyitva && status === "authenticated",
  });
  const valaszthato = valaszthatoEszkozok({
    szerverElemek: eszkozok.data?.items,
    mentettElemek: mentettEszkozok.data?.items,
    kereses: eszkozKereses,
  });

  /*
    A TELJES LISTA A MASOLATNAK, HA A FUL NEM AZ (2026-10-04): a nyitott
    alapertelmezessel az Osszes valasza mar nem jon magatol, a masolat pedig
    csak abbol irhato (`OFFLINE_COPY_SCOPE`). Ugyanaz a kulcs, mint az Osszes
    fule, tehat arra valtva nincs uj kor; a `staleTime` miatt egy lap
    megnyitasa es a visszalepes sem ker ujra.
  */
  const fullList = useQuery({
    queryKey: ["service-jobs", OFFLINE_COPY_SCOPE, "ALL"],
    queryFn: () => listServiceJobs(OFFLINE_COPY_SCOPE, "ALL"),
    enabled:
      serverScope !== OFFLINE_COPY_SCOPE &&
      status === "authenticated" &&
      Boolean(capabilities?.serviceJobsView),
    staleTime: 60_000,
  });
  const copySource =
    serverScope === OFFLINE_COPY_SCOPE ? query.data : fullList.data;
  useEffect(() => {
    if (!copySource) return;
    void rememberServiceJobs(copySource.items);
  }, [copySource]);

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (status === "authenticated" && !capabilities?.serviceJobsView)
    return (
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.empty}>
          Nincs hozzáférésed a hibajegyekhez. Ha ez tévedés, szólj az irodának.
        </Text>
      </SafeAreaView>
    );

  /**
   * AMIT MUTATUNK: a szerver válasza, ha van; a mentett másolat, ha nincs.
   *
   * A MÁSOLAT AKKOR IS JÓ, HA A KÉSZÜLÉK ONLINE-NAK HISZI MAGÁT, de a hívás
   * elhasalt -- a `query.isError` ág ezért számít bele. Enélkül egy hálózati
   * hiba ÜRES listát adna, ami ugyanúgy néz ki, mint egy valóban üres nap.
   */
  const cachedItems = cached.data?.items ?? [];
  /**
   * A MASOLAT A VALASZTOTT SZUROVEL, VAGY EGY KIMONDOTT NEMMEL.
   *
   * A mentett sorok allapota rajtuk van, a KIOSZTAS nincs -- a `ram kiosztva`
   * tehat kapcsolat nelkul nem szamolhato ki. Ilyenkor a kepernyo NEM a teljes
   * listat adja helyette: az tagabb lenne, mint a felirata, ami ugyanolyan
   * hazugsag, mint a szukebb.
   */
  const fromCache = cachedItemsForScope(cachedItems, scope, user?.id);
  const cachedForScope = fromCache.kind === "items" ? fromCache.items : [];
  const items: ServiceJobListItem[] = query.data
    ? itemsForScope(query.data.items, scope)
    : cachedForScope;
  const tiles = serviceJobStatTiles(query.data?.counts);
  const now = new Date();
  const scopeNeedsConnection =
    !query.data && fromCache.kind === "needs-connection";
  const notice = describeOfflineNotice({
    online: online && !query.isError,
    syncedAt: cached.data?.syncedAt ?? null,
    itemCount: cachedItems.length,
    now: new Date(),
    subject: SERVICE_JOB_NOTICE_SUBJECT,
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.subtitle}>
              A mai helyszíni ügyek és a következő lépések.
            </Text>
            {notice ? <OfflineNoticeCard notice={notice} /> : null}
            {/*
              THE THREE TILES (Figma 423:876) from the server's counts. A
              saved list has no counts, so offline there are no tiles rather
              than zeros that would look like an empty day.
            */}
            {tiles ? (
              <View style={styles.tiles} accessibilityLabel="Összesítés">
                {tiles.map((tile) => (
                  <View key={tile.key} style={styles.tile}>
                    <Text
                      style={[
                        styles.tileValue,
                        tile.key === "waiting" && styles.tileValueWaiting,
                        tile.key === "closed" && styles.tileValueClosed,
                      ]}
                    >
                      {tile.value}
                    </Text>
                    <Text style={styles.tileLabel}>{tile.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {/*
              A SZŰRŐ-SÁV. A KIVÁLASZTOTT ÁLLAPOT IS LÁTSZIK, nem csak a négy
              felirat: egy szűrt lista, ami nem mondja meg, hogy szűrt, épp az
              a hiba, amiért ez a sáv megszületett.
            */}
            <View style={styles.scopes}>
              {SERVICE_JOB_SCOPES.map((option) => {
                const selected = option.id === scope;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    onPress={() => setScope(option.id)}
                    style={[styles.scope, selected && styles.scopeSelected]}
                  >
                    <Text
                      style={[
                        styles.scopeLabel,
                        selected && styles.scopeLabelSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {scopeNeedsConnection ? (
              <Text style={styles.hint}>
                Ehhez a szűréshez kapcsolat kell: a mentett másolat egy része
                még nem tudja, kire van kiosztva egy jegy. A többi szűrő offline
                is működik.
              </Text>
            ) : null}
            {/*
              ÚJ JEGY INNEN IS, NEM CSAK A GÉP ADATLAPJÁRÓL (Balázs kérése).
              A gomb CSAK annak jelenik meg, aki jegyet is nyithat: a felvitel
              képernyője `serviceJobsManage` nélkül visszairányít, tehát egy
              mindenkinek mutatott gomb némán visszadobná a szerelőt a
              kezdőlapra.
            */}
            {capabilities?.serviceJobsManage ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Új hibajegy nyitása: gép választása"
                  onPress={() => setUjJegyNyitva((open) => !open)}
                  style={({ pressed }) => [
                    styles.newJob,
                    pressed && styles.pressed,
                  ]}
                  testID="uj-jegy-gomb"
                >
                  <Text style={styles.newJobText}>
                    {ujJegyNyitva ? "Mégsem" : "Új hibajegy"}
                  </Text>
                </Pressable>

                {ujJegyNyitva ? (
                  <View style={styles.assetPicker}>
                    {/*
                      A GÉP KIVÁLASZTÁSA NEM KÉNYELMI LÉPÉS: a jegy partnerét és
                      helyszínét a SZERVER vezeti le a gépből, tehát gép nélkül
                      nem tudná, hova tartozik a bejelentés.
                    */}
                    <Text style={styles.hint}>
                      Válaszd ki a gépet: a partner és a helyszín abból
                      következik.
                    </Text>
                    <TextInput
                      value={eszkozKereses}
                      onChangeText={setEszkozKereses}
                      placeholder="Keresés: azonosító, név, gyártó"
                      placeholderTextColor={tokens.textMuted}
                      style={styles.search}
                      autoCorrect={false}
                      testID="uj-jegy-kereso"
                    />
                    {eszkozok.isPending && ujJegyNyitva ? (
                      <ActivityIndicator color={tokens.accent} />
                    ) : null}
                    {valaszthato.length === 0 && !eszkozok.isPending ? (
                      <Text style={styles.hint}>
                        {online
                          ? "Ebben a keresésben nincs gép."
                          : "Nincs kapcsolat, és a mentett másolatban nincs ilyen gép."}
                      </Text>
                    ) : null}
                    {valaszthato.map((asset) => (
                      <Pressable
                        key={asset.id}
                        accessibilityRole="button"
                        onPress={() => {
                          setUjJegyNyitva(false);
                          setEszkozKereses("");
                          router.push(ujJegyEszkozzel(asset.id));
                        }}
                        style={({ pressed }) => [
                          styles.assetRow,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.assetName}>{asset.name}</Text>
                        <Text style={styles.assetMeta}>
                          {asset.assetNumber}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}

            {/*
              A KIHAGYÁSOK KIMONDVA, NEM ELHALLGATVA. Egy hiányzó gomb ugyanúgy
              néz ki, mint egy elromlott -- és a szerelő a helyszínen nem tudja
              eldönteni, melyikről van szó.
            */}
            <Text style={styles.hint}>
              Telefonon a jegy olvasható, léptethető, fényképet lehet rátenni,
              és új jegy is nyitható: a fenti gombbal vagy a gép adatlapjáról
              (Eszközök, majd Hibajegy nyitása). Mindkét úton a gépből
              következik a partner és a helyszín. Partnert váltani és delegálni
              a webes felületen lehet.
            </Text>
          </View>
        }
        ListEmptyComponent={
          query.isPending && items.length === 0 ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <Text style={styles.empty}>
              {scopeNeedsConnection
                ? "Ehhez a szűréshez kapcsolat kell."
                : online
                  ? "Ebben a szűrésben nincs hibajegy."
                  : "Nincs kapcsolat, és nincs mentett hibajegy ezen a készüléken."}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.jobNumber} ${item.title}`}
            onPress={() => router.push(`/service-jobs/${item.id}`)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            {/*
              THE CARD OF THE SERVICE REDESIGN (Figma 423:876): title and
              number, the status at the right, partner and place, and one
              line with who it is assigned to, its sheets and when it came.
            */}
            <View style={styles.cardTop}>
              <View style={styles.cardTitleBlock}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.number}>{item.jobNumber}</Text>
              </View>
              <Text style={styles.status}>
                {serviceJobStatusLabel(item.status)}
              </Text>
            </View>
            {item.reporterPersonName && item.reporterName ? (
              <Text style={styles.meta}>Bejelentő: {item.reporterName}</Text>
            ) : null}
            {item.kind === "MAINTENANCE" ? (
              <Text style={styles.maintenance}>Karbantartás</Text>
            ) : null}
            {item.customerName ? (
              <Text style={styles.partner}>{item.customerName}</Text>
            ) : null}
            {shortPath(item.departmentPath) ? (
              <Text style={styles.meta}>{shortPath(item.departmentPath)}</Text>
            ) : null}
            <Text style={styles.meta}>{serviceJobCardMeta(item, now)}</Text>
          </Pressable>
        )}
      />
      {/* the shared bar, with no item lit until "Feladatok" exists (E9) */}
      <BottomNav active={null} />
    </SafeAreaView>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- Figma 12.
 * kör, ugyanaz a minta, mint a `login.tsx`-en (lásd ott a teljes indokot).
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { backgroundColor: t.background, flex: 1 },
    list: { gap: 12, padding: 16 },
    header: { gap: 12 },
    scopes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    scope: {
      backgroundColor: t.surface,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    scopeSelected: { backgroundColor: t.accent },
    scopeLabel: { color: t.textSecondary, fontSize: 13 },
    scopeLabelSelected: { color: t.textOnAccent, fontWeight: "600" },
    hint: { color: t.textSecondary, fontSize: 13, lineHeight: 18 },
    /* Az "Új hibajegy" gomb es a hozza tartozo gep-valaszto. A szinek a
       munkalap-lista partner-valasztojabol jonnek: ugyanaz a mozdulat, ugyanaz
       a kinezet. */
    newJob: {
      alignItems: "center",
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingVertical: 12,
    },
    newJobText: { color: t.textOnAccent, fontSize: 15, fontWeight: "600" },
    pressed: { opacity: 0.7 },
    assetPicker: {
      backgroundColor: t.surface,
      borderRadius: 12,
      gap: 8,
      padding: 12,
    },
    search: {
      backgroundColor: t.background,
      borderRadius: 10,
      color: t.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    assetRow: {
      borderBottomColor: t.border,
      borderBottomWidth: 1,
      gap: 2,
      paddingVertical: 10,
    },
    assetName: { color: t.textPrimary, fontSize: 15 },
    assetMeta: { color: t.textSecondary, fontSize: 13 },
    loading: { marginTop: 32 },
    empty: { color: t.textSecondary, marginTop: 32, textAlign: "center" },
    subtitle: { color: t.textSecondary, fontSize: 14 },
    tiles: { flexDirection: "row", gap: 8 },
    tile: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 14,
      borderWidth: 1,
      flex: 1,
      gap: 4,
      padding: 12,
    },
    tileValue: { color: t.textPrimary, fontSize: 24, fontWeight: "700" },
    tileValueWaiting: { color: t.warning },
    tileValueClosed: { color: t.accent },
    tileLabel: { color: t.textSecondary, fontSize: 13 },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 14,
      borderWidth: 1,
      gap: 4,
      padding: 16,
    },
    cardTop: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: 12,
      justifyContent: "space-between",
    },
    cardTitleBlock: { flex: 1, gap: 2 },
    number: { color: t.textSecondary, fontSize: 13 },
    status: { ...statusBadgeStyle(t), alignSelf: "flex-start" },
    title: { color: t.textPrimary, fontSize: 17, fontWeight: "700" },
    maintenance: { ...statusBadgeStyle(t), alignSelf: "flex-start" },
    partner: { color: t.textPrimary, fontSize: 14, marginTop: 6 },
    meta: { color: t.textSecondary, fontSize: 13 },
  });
}
