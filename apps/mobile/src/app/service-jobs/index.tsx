import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
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
  serviceJobStatusLabel,
  shortPath,
} from "@/lib/service-jobs/service-job-status";

const CACHE_KEY = ["offline-service-jobs"] as const;

/**
 * A HIBAJEGYEK LISTÁJA A TELEFONON.
 *
 * NYITOTT JEGYEK, NEM MIND. A helyszínen álló szerelőnek az kell, amin dolgozni
 * lehet; a lezárt jegyek a weben nézhetők vissza. Ez a döntés SZŰKÍT, tehát
 * hangos: aki keres valamit és nem találja, szól. A fordítottja (mindent
 * mutatni) néma lenne: a lista hosszabb, és a mai munka elveszne benne.
 *
 * A LÁTHATÓSÁGOT A SZERVER SZABJA, nem ez a képernyő: a szervizes a saját
 * helyszíneit látja. Egy kliens-oldali szűrő itt azt ígérné, hogy tudja, ki mit
 * láthat -- és a következő szabály-változásnál csendben hazudna.
 */
export default function ServiceJobListScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();

  const query = useQuery({
    queryKey: ["service-jobs", "open"],
    // A hívás akkor is elindul, ha a készülék offline-nak mondja magát: a
    // jelzése tévedhet, és egy működő lekérdezést nem tarthat vissza.
    queryFn: () => listServiceJobs("open"),
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
  const items: ServiceJobListItem[] = query.data?.items ?? cachedItems;
  const notice = describeOfflineNotice({
    online: online && !query.isError,
    syncedAt: cached.data?.syncedAt ?? null,
    itemCount: cachedItems.length,
    now: new Date(),
    subject: SERVICE_JOB_NOTICE_SUBJECT,
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {notice ? <OfflineNoticeCard notice={notice} /> : null}
            {/*
              A KIHAGYÁSOK KIMONDVA, NEM ELHALLGATVA. Egy hiányzó gomb ugyanúgy
              néz ki, mint egy elromlott -- és a szerelő a helyszínen nem tudja
              eldönteni, melyikről van szó.
            */}
            <Text style={styles.hint}>
              A nyitott hibajegyek. Telefonon a jegy olvasható, léptethető, és
              fényképet lehet rátenni; új jegyet nyitni, partnert váltani és
              delegálni a webes felületen lehet.
            </Text>
          </View>
        }
        ListEmptyComponent={
          query.isPending && items.length === 0 ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <Text style={styles.empty}>
              {online
                ? "Nincs nyitott hibajegy."
                : "Nincs kapcsolat, és nincs mentett hibajegy ezen a készüléken."}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.jobNumber} ${item.title}`}
            onPress={() => router.push(`/service-jobs/${item.id}`)}
            style={styles.card}
          >
            <View style={styles.cardTop}>
              <Text style={styles.number}>{item.jobNumber}</Text>
              <Text style={styles.status}>
                {serviceJobStatusLabel(item.status)}
              </Text>
            </View>
            <Text style={styles.title}>{item.title}</Text>
            {item.customerName ? (
              <Text style={styles.meta}>{item.customerName}</Text>
            ) : null}
            {shortPath(item.departmentPath) ? (
              <Text style={styles.meta}>{shortPath(item.departmentPath)}</Text>
            ) : null}
            {item.worksheetCount > 0 ? (
              <Text style={styles.meta}>
                {item.worksheetCount} munkalap tartozik hozzá
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#06202e", flex: 1 },
  list: { gap: 12, padding: 16 },
  header: { gap: 12 },
  hint: { color: "#9fc4d8", fontSize: 13, lineHeight: 18 },
  loading: { marginTop: 32 },
  empty: { color: "#9fc4d8", marginTop: 32, textAlign: "center" },
  card: { backgroundColor: "#0d2a3a", borderRadius: 12, gap: 4, padding: 14 },
  cardTop: { flexDirection: "row", justifyContent: "space-between" },
  number: { color: "#eaf4fa", fontWeight: "600" },
  status: { color: "#9fc4d8", fontSize: 13 },
  title: { color: "#eaf4fa", fontSize: 16 },
  meta: { color: "#9fc4d8", fontSize: 13 },
});
