import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "@/components/home/BottomNav";
import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import {
  listServiceJobs,
  type ServiceJobListItem,
} from "@/lib/api/service-jobs";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { useIsOnline } from "@/lib/offline/connectivity";
import { describeOfflineNotice } from "@/lib/offline/offline-notice";
import {
  readCachedServiceJobs,
  rememberServiceJobs,
} from "@/lib/offline/service-job-cache";
import { serviceJobCardMeta } from "@/lib/service-jobs/list-card";
import { MAINTENANCE_LIST_COPY } from "@/lib/service-jobs/maintenance-list-copy";
import {
  cachedMaintenanceForTab,
  DEFAULT_MAINTENANCE_TAB,
  MAINTENANCE_TABS,
  maintenanceItemsForTab,
  maintenanceRowsOf,
  type MaintenanceTab,
} from "@/lib/service-jobs/maintenance-tabs";
import { shortPath } from "@/lib/service-jobs/service-job-status";
import { sessionKey } from "@/lib/session/session-memory";
import { useSessionState } from "@/lib/session/useSessionState";
import { statusBadgeStyle } from "@/lib/theme/label-styles";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { useAppTheme } from "@/lib/theme/useAppTheme";

const CACHE_KEY = ["offline-service-jobs"] as const;

/**
 * A KARBANTARTÁS LISTÁJA A TELEFONON (acrobot 56224; Balázs 2026-11-18 11:31: a karbantartási lap nem hibajegy).
 *
 * A FÜLEK A WEBES LISTA LOGIKÁJÁVAL (#2710): Folyamatban (alap), Kész, Összes, a `maintenanceDone` mezőre. Egyetlen szerver-hívás van, `kind=MAINTENANCE` és `scope=all`: a fülek a kliensen szűrnek, ezért egy fül
 * átkapcsolása nem hív újra, és a hívás csak karbantartási lapokat hoz, tehát a szerver kétszáz soros vágása nem osztozik hibajegyekkel. (A szerveroldali `maintenanceState` szűrő a #2711-gyel jön; a mobil azt a
 * beolvadás után sem kéri, amíg erre szükség nincs.)
 *
 * A MENTETT MÁSOLAT A HIBAJEGYEK MÁSOLATA IS, EGY TÁBLA (`cached_service_jobs`): ezt a képernyő CSAK a szerver válaszából frissíti, soronként felülírva, és semmit nem töröl belőle, tehát a másolat nem zsugorodik, és a
 * Hibajegyek lista teljes másolata sem. Térerő nélkül a másolatból a karbantartási sorok látszanak (`cachedMaintenanceForTab`), az ismeretlen készségűek csak az Összes fülön, és ezt a szám kimondja.
 *
 * A SOR NEM MUTAT HIBAJEGY-ÁLLAPOTOT: a karbantartásnak nincs állapotgépe, a jelvény a készség (Kész / Folyamatban). A sor megnyitja a közös adatlapot, ami a fajta szerint nevezi meg magát.
 */
export default function MaintenanceListScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const capabilities = user ? getServiceCapabilities(user) : null;
  const online = useIsOnline();
  const [tab, setTab] = useSessionState<MaintenanceTab>(
    sessionKey(user?.id, "maintenance", "tab"),
    DEFAULT_MAINTENANCE_TAB,
  );

  const query = useQuery({
    queryKey: ["service-jobs", "all", "MAINTENANCE"],
    queryFn: () => listServiceJobs("all", "MAINTENANCE"),
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

  useEffect(() => {
    if (!query.data) return;
    void rememberServiceJobs(query.data.items);
  }, [query.data]);

  if (status === "unauthenticated") return <Redirect href="/login" />;
  if (status === "authenticated" && !capabilities?.serviceJobsView)
    return (
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.empty}>{MAINTENANCE_LIST_COPY.noAccess}</Text>
      </SafeAreaView>
    );

  const cachedItems = cached.data?.items ?? [];
  const fromCache = cachedMaintenanceForTab(cachedItems, tab);
  const items: ServiceJobListItem[] = query.data
    ? maintenanceItemsForTab(query.data.items, tab)
    : fromCache.items;
  const unknown = query.data ? 0 : fromCache.unknown;
  const now = new Date();
  const notice = describeOfflineNotice({
    online: online && !query.isError,
    syncedAt: cached.data?.syncedAt ?? null,
    itemCount: maintenanceRowsOf(cachedItems).length,
    now,
    subject: { listName: MAINTENANCE_LIST_COPY.noticeListName },
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {notice ? <OfflineNoticeCard notice={notice} /> : null}
            <View style={styles.tabs}>
              {MAINTENANCE_TABS.map((option) => {
                const selected = option.id === tab;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    onPress={() => setTab(option.id)}
                    style={[styles.tab, selected && styles.tabSelected]}
                  >
                    <Text
                      style={[
                        styles.tabLabel,
                        selected && styles.tabLabelSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {unknown > 0 ? (
              <Text style={styles.hint}>
                {MAINTENANCE_LIST_COPY.unknownNotice(unknown)}
              </Text>
            ) : null}
            <Text style={styles.hint}>
              {MAINTENANCE_LIST_COPY.capabilities}
            </Text>
          </View>
        }
        ListEmptyComponent={
          query.isPending && items.length === 0 ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <Text style={styles.empty}>
              {online && !query.isError
                ? MAINTENANCE_LIST_COPY.empty[tab]
                : MAINTENANCE_LIST_COPY.emptyOffline}
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
            <View style={styles.cardTop}>
              <View style={styles.cardTitleBlock}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.number}>{item.jobNumber}</Text>
              </View>
              {item.maintenanceDone === undefined ? null : (
                <Text style={styles.badge}>
                  {item.maintenanceDone ? "Kész" : "Folyamatban"}
                </Text>
              )}
            </View>
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
      <BottomNav active={null} />
    </SafeAreaView>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { backgroundColor: t.background, flex: 1 },
    list: { gap: 12, padding: 16 },
    header: { gap: 12 },
    tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tab: {
      backgroundColor: t.surface,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    tabSelected: { backgroundColor: t.accent },
    tabLabel: { color: t.textSecondary, fontSize: 13 },
    tabLabelSelected: { color: t.textOnAccent, fontWeight: "600" },
    hint: { color: t.textSecondary, fontSize: 13, lineHeight: 18 },
    pressed: { opacity: 0.7 },
    loading: { marginTop: 32 },
    empty: { color: t.textSecondary, marginTop: 32, textAlign: "center" },
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
    badge: { ...statusBadgeStyle(t), alignSelf: "flex-start" },
    title: { color: t.textPrimary, fontSize: 17, fontWeight: "700" },
    partner: { color: t.textPrimary, fontSize: 14, marginTop: 6 },
    meta: { color: t.textSecondary, fontSize: 13 },
  });
}
