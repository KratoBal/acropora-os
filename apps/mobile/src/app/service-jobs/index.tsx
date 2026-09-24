import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
  SERVICE_JOB_SCOPES,
  type ServiceJobScope,
} from "@/lib/service-jobs/list-scope";
import {
  serviceJobStatusLabel,
  shortPath,
} from "@/lib/service-jobs/service-job-status";
import {
  ujJegyEszkozzel,
  valaszthatoEszkozok,
} from "@/lib/service-jobs/uj-jegy-eszkoz";
import { readCachedAssets } from "@/lib/offline/asset-cache";

const CACHE_KEY = ["offline-service-jobs"] as const;

/**
 * A HIBAJEGYEK LISTÁJA A TELEFONON.
 *
 * NÉGY SZŰRŐ, ÉS AZ ÖSSZES AZ ALAPÉRTELMEZÉS (Balázs kérése, 2026-09-17).
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
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();
  const [scope, setScope] = useState<ServiceJobScope>(
    DEFAULT_SERVICE_JOB_SCOPE,
  );

  const query = useQuery({
    // A HATOKOR RESZE A KULCSNAK. Enelkul a valaszto atkapcsolasa a REGI
    // halmazt mutatna a masik felirat alatt, amig az uj lekerdezes befut.
    queryKey: ["service-jobs", scope, "ALL"],
    // A hívás akkor is elindul, ha a készülék offline-nak mondja magát: a
    // jelzése tévedhet, és egy működő lekérdezést nem tarthat vissza.
    queryFn: () => listServiceJobs(scope, "ALL"),
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

  useEffect(() => {
    if (!query.data || scope !== DEFAULT_SERVICE_JOB_SCOPE) return;
    void rememberServiceJobs(query.data.items);
  }, [query.data, scope]);

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
  const fromCache = cachedItemsForScope(cachedItems, scope);
  const cachedForScope = fromCache.kind === "items" ? fromCache.items : [];
  const items: ServiceJobListItem[] = query.data?.items ?? cachedForScope;
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
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {notice ? <OfflineNoticeCard notice={notice} /> : null}
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
                Ehhez a szűréshez kapcsolat kell: a mentett másolat nem tudja,
                kire van kiosztva egy jegy. A többi szűrő offline is működik.
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
                      placeholderTextColor="#7b8a97"
                      style={styles.search}
                      autoCorrect={false}
                      testID="uj-jegy-kereso"
                    />
                    {eszkozok.isPending && ujJegyNyitva ? (
                      <ActivityIndicator color="#52d6c7" />
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
            style={styles.card}
          >
            <View style={styles.cardTop}>
              <Text style={styles.number}>{item.jobNumber}</Text>
              <Text style={styles.status}>
                {serviceJobStatusLabel(item.status)}
              </Text>
            </View>
            <Text style={styles.title}>{item.title}</Text>
            {item.kind === "MAINTENANCE" ? (
              <Text style={styles.maintenance}>Karbantartás</Text>
            ) : null}
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
  scopes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scope: {
    backgroundColor: "#0d2a3a",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  scopeSelected: { backgroundColor: "#1f6f97" },
  scopeLabel: { color: "#9fc4d8", fontSize: 13 },
  scopeLabelSelected: { color: "#eaf4fa", fontWeight: "600" },
  hint: { color: "#9fc4d8", fontSize: 13, lineHeight: 18 },
  /* Az "Új hibajegy" gomb es a hozza tartozo gep-valaszto. A szinek a
     munkalap-lista partner-valasztojabol jonnek: ugyanaz a mozdulat, ugyanaz
     a kinezet. */
  newJob: {
    alignItems: "center",
    backgroundColor: "#1f6f97",
    borderRadius: 12,
    paddingVertical: 12,
  },
  newJobText: { color: "#eaf4fa", fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  assetPicker: {
    backgroundColor: "#0d2a3a",
    borderRadius: 12,
    gap: 8,
    padding: 12,
  },
  search: {
    backgroundColor: "#06202e",
    borderRadius: 10,
    color: "#eaf4fa",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  assetRow: {
    borderBottomColor: "#123b50",
    borderBottomWidth: 1,
    gap: 2,
    paddingVertical: 10,
  },
  assetName: { color: "#eaf4fa", fontSize: 15 },
  assetMeta: { color: "#9fc4d8", fontSize: 13 },
  loading: { marginTop: 32 },
  empty: { color: "#9fc4d8", marginTop: 32, textAlign: "center" },
  card: { backgroundColor: "#0d2a3a", borderRadius: 12, gap: 4, padding: 14 },
  cardTop: { flexDirection: "row", justifyContent: "space-between" },
  number: { color: "#eaf4fa", fontWeight: "600" },
  status: { color: "#9fc4d8", fontSize: 13 },
  title: { color: "#eaf4fa", fontSize: 16 },
  maintenance: {
    alignSelf: "flex-start",
    backgroundColor: "#17465b",
    borderRadius: 999,
    color: "#bce5ef",
    fontSize: 12,
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  meta: { color: "#9fc4d8", fontSize: 13 },
});
