import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AssetCard } from "@/components/assets/AssetCard";
import { OfflineNoticeCard } from "@/components/offline/OfflineNoticeCard";
import { listAssets, type AssetListStatusFilter } from "@/lib/api/assets";
import { filterAssets } from "@/lib/assets/asset-search";
import { ASSET_STATUS_LABELS } from "@/lib/assets/asset-status";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { readCachedAssets, rememberAssets } from "@/lib/offline/asset-cache";
import { pendingQueueRows } from "@/lib/offline/queue-store";
import {
  eszkozokVarakozokkal,
  varakozoEszkozok,
} from "@/lib/offline/varakozo-eszkozok";
import {
  syncAssetsForOffline,
  type OfflineSyncResult,
} from "@/lib/offline/asset-sync";
import { useIsOnline } from "@/lib/offline/connectivity";
import {
  ASSET_NOTICE_SUBJECT,
  describeOfflineNotice,
} from "@/lib/offline/offline-notice";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

const PAGE_SIZE = 50;
const OFFLINE_CACHE_KEY = ["offline-assets"] as const;

/**
 * AZ ÁLLAPOT-FÜLSOR -- Figma 7. kör (`Eszköznyilvántartás`), telefon.
 *
 * A SORREND ÉS A KÉSZLET A WEBES `asset-list-page.tsx` SAJÁT `TABS`
 * KONSTANSÁT KÖVETI, NEM A FIGMA-LEÍRÁS SZÖVEGÉT ÉS NEM A MOBIL MAKE-MOCK
 * TÖMBJÉT -- mindhárom más sorrendet/készletet ad, és ez NEM elírás,
 * hanem tudatos döntés: a webes sorrend egy KIMONDOTT Balázs-kérésre megy
 * vissza ("Összes" az elején, nem a végén -- lásd a webes fájl saját
 * kommentjét), a mobil Make-mock pedig KIHAGY két valódi állapotot
 * (`COLD_STANDBY` és `IN_REPAIR`) -- ha ezt követném, az a két állapot a
 * telefonon fülsorral EGYÁLTALÁN nem lenne elérhető. A web és a telefon között
 * ELTÉRŐ sorrendet bevezetni pedig két helyen tanítaná meg ugyanazt a
 * listát máshogy.
 */
const STATUS_TABS: { key: AssetListStatusFilter; label: string }[] = [
  { key: "ALL", label: "Összes" },
  { key: "IN_PLACE", label: "Beépített" },
  { key: "ACTIVE", label: ASSET_STATUS_LABELS.ACTIVE },
  { key: "IN_REPAIR", label: ASSET_STATUS_LABELS.IN_REPAIR },
  { key: "WARM_STANDBY", label: ASSET_STATUS_LABELS.WARM_STANDBY },
  { key: "COLD_STANDBY", label: ASSET_STATUS_LABELS.COLD_STANDBY },
  { key: "RETIRED", label: ASSET_STATUS_LABELS.RETIRED },
];

export default function AssetListScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const online = useIsOnline();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [sync, setSync] = useState<OfflineSyncResult | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  /**
   * A "BEÉPÍTETT" AZ ALAPÉRTELMEZETT, UGYANÚGY, MINT A WEBEN (Balázs kérése,
   * 2026-09-18: "ha betoltom az eszkozok listat akkor a beepitett legyen
   * alapbol kivalasztva") -- lásd `asset-list-page.tsx` ugyanezt a
   * kommentet.
   */
  const [statusTab, setStatusTab] = useState<AssetListStatusFilter>("IN_PLACE");
  // Egy teljes lehúzás képernyő-megnyitásonként. A lista frissítése (lehúzás)
  // az ELSŐ oldalt hozza; a másolatot nem kell minden mozdulatra újraépíteni.
  const pulled = useRef(false);

  const query = useQuery({
    queryKey: [
      "service-assets",
      { page, pageSize: PAGE_SIZE, search, statusTab },
    ],
    // A hívás akkor is elindul, ha a készülék offline-nak mondja magát: a
    // jelzése tévedhet, és egy működő lekérdezést nem tarthat vissza.
    queryFn: () => listAssets(page, PAGE_SIZE, search, "", statusTab),
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
      /*
       * ELŐBB A MÁSOLAT OLVASÁSA FRISSÜL, UTÁNA ÍRJUK KI A SZÁMOT. A két sor
       * ugyanarról a másolatról beszél, de két különböző forrásból: a szám
       * innen jön, a fölötte lévő sáv kora a mentett sorokból. Fordított
       * sorrendben van egy pillanat, amikor a szám már azt mondja, hogy „40
       * eszköz mentve", a sáv pedig még azt, hogy soha nem frissült -- és ezt
       * Balázs le is fotózta 2026-09-16-án a telefonján.
       *
       * A sáv szövege külön javítva (`describeOfflineNotice`); ez a sorrend
       * viszont attól függetlenül kell, mert két igaz állítás is mondhat
       * egymásnak ellent, ha nem ugyanabban a pillanatban mérik őket.
       */
      await queryClient.invalidateQueries({ queryKey: OFFLINE_CACHE_KEY });
      setSync(result);
    })();
  }, [query.data, queryClient]);

  /*
    A KET HOOK A KORAI VISSZATERESEK FOLOTT ALL, ES EZ NEM IZLES: a React
    megkoveteli, hogy minden renderben UGYANANNYI hook fusson le. Egy
    `Redirect` utan elhelyezve az elso atiranyitasnal eltunnenek, es a
    kovetkezo render mar mas sorrendben talalna oket.
  */
  /**
   * A MEG FEL NEM MENT FELVITELEK, A LISTA ELEJEN.
   *
   * Balazs jelentese (2026-09-18) es dontese (2026-09-21, "elfogadom"): offline
   * mentes utan a kepernyo lepjen vissza a listara, es a felvitt eszkoz
   * JELENJEN MEG rajta, megjelolve, hogy meg feltoltesre var.
   *
   * A SOR A FORRAS, NEM EGY MASODIK NYILVANTARTAS: ugyanaz a tabla, amibol a
   * kiurites dolgozik. Egy kulon lista ket helyen allo igazsagot csinalna, es a
   * ketto elcsuszasa nema lenne -- a szerelo egy mar felment eszkozt latna
   * varakozokent, vagy forditva.
   */
  const sorbanAllok = useQuery({
    queryKey: ["varakozo-eszkozok"],
    queryFn: pendingQueueRows,
    enabled: status === "authenticated" && Boolean(capabilities?.assetsView),
  });
  /*
    AZ ELLENORZO MONDAT A FELVITELROL, ATADVA. A felviteli kepernyo eddig egy
    borostyan dobozban irta ki (hany eszkoz ellen ellenoriztunk, es mikori az
    adat); a doboz a visszalepessel eltunt volna. A mondat ITT jelenik meg,
    egyszer, a lista tetejen.
  */
  const params = useLocalSearchParams<{
    varakozoUzenet?: string | string[];
    valasztKodhoz?: string | string[];
  }>();
  /**
   * VALASZTO-MOD: EGY BEOLVASOTT SZABAD MATRICAHOZ KERESUNK ESZKOZT.
   *
   * A FEL 2 masodik aga kuldi ide a szerelot: beolvasott egy szabad kodot, es
   * a „hozzaadas meglevo eszkozhoz" gombot valasztotta. Ilyenkor a sor
   * koppintasa NEM az adatlapra visz, hanem a SZERKESZTORE, a koddal egyutt.
   *
   * A LISTA TOBBI RESZE VALTOZATLAN: ugyanaz a kereso, ugyanaz a lapozas.
   * Egy kulon „valaszto kepernyo" ugyanezt a listat masolna le, es a masodik
   * peldanyt semmi nem merne -- ugyanaz az indok, ami a helyszin-valaszto
   * kiemelese folott all.
   */
  const valasztKodhoz = Array.isArray(params.valasztKodhoz)
    ? params.valasztKodhoz[0]
    : params.valasztKodhoz;
  const varakozoUzenet = Array.isArray(params.varakozoUzenet)
    ? params.varakozoUzenet[0]
    : params.varakozoUzenet;

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

  const varakozok = varakozoEszkozok(sorbanAllok.data ?? []);
  /*
    KERESES KOZBEN A VARAKOZOK IS KIESNEK. A talalati lista mast allitana, mint
    a felirata: a szerelo egy szukitett listaban latna egy oda nem tartozo sort.
  */
  const sorok = eszkozokVarakozokkal({
    szerverElemek: items,
    varakozok: search.trim() ? [] : varakozok,
  });
  const totalPages = query.data?.pagination.totalPages ?? 1;

  const notice = describeOfflineNotice({
    online: online && !query.isError,
    syncedAt: cached.data?.syncedAt ?? null,
    itemCount: cachedItems.length,
    now: new Date(),
    subject: ASSET_NOTICE_SUBJECT,
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <FlatList
        data={sorok}
        keyExtractor={(sor) =>
          sor.fajta === "varakozo" ? sor.tetel.operationId : sor.tetel.id
        }
        contentContainerStyle={styles.container}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.header}>
            {varakozoUzenet ? (
              <View style={styles.varakozoUzenet}>
                <Text style={styles.varakozoCimke}>MENTVE A TELEFONRA</Text>
                <Text style={styles.varakozoMeta}>{varakozoUzenet}</Text>
              </View>
            ) : null}
            {/*
              A VALASZTO-MOD KIMONDVA, A LISTA TETEJEN.
              Enelkul a kepernyo UGYANUGY nez ki, mint a sima lista, es a
              koppintas MASHOVA visz -- a szerelo az adatlapot varna, es a
              szerkeszto nyilna meg. Egy nema mod-valtas rosszabb, mint egy
              kulon kepernyo.
            */}
            {valasztKodhoz ? (
              <View style={styles.valasztoSav}>
                <Text style={styles.valasztoCimke}>
                  SZABAD MATRICA: {valasztKodhoz}
                </Text>
                <Text style={styles.valasztoMeta}>
                  Válaszd ki az eszközt, amire felragasztottad. A kód a
                  szerkesztőben jelenik meg, mentés előtt ellenőrizheted.
                </Text>
              </View>
            ) : null}
            <Text style={styles.eyebrow}>ASSET MANAGEMENT</Text>
            <Text style={styles.title}>Partnereszközök</Text>
            <Text style={styles.subtitle}>
              Húzd le a listát a frissítéshez, vagy olvasd le a matricán lévő
              QR-kódot a telefon kamerájával.
            </Text>
            {/*
              KERESÉS. A szerelő egy matricát olvas le, és nem tudja, melyik
              mező az: lehet a mi eszközszámunk, a gyártó sorozatszáma vagy a
              partner belső kódja. Ezért egy mező van, és az mind a hatot
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
              placeholderTextColor={tokens.textMuted}
              style={styles.search}
              autoCorrect={false}
              autoCapitalize="characters"
            />
            {/*
              ÁLLAPOT-FÜLSOR. A szerver a `status` paramétert kéri
              (`asset-status-filter.ts`), tehát a szűrés a SZERVEREN
              történik, nem a már lapozott halmazon -- ugyanaz a szabály,
              ami a keresésre is áll.
            */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tabRow}
              contentContainerStyle={styles.tabRowContent}
            >
              {STATUS_TABS.map((tab) => {
                const active = tab.key === statusTab;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => {
                      setStatusTab(tab.key);
                      setPage(1);
                    }}
                    style={[styles.tab, active && styles.tabActive]}
                  >
                    <Text
                      style={[styles.tabLabel, active && styles.tabLabelActive]}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
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
                  <Text style={styles.buttonTextMuted}>Új eszköz</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          query.isPending && cachedItems.length === 0 ? (
            <ActivityIndicator color={tokens.accent} />
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
                  ? "Próbáld a partner belső kódjával, a sorozatszámmal vagy a nevének egy darabjával."
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
                <Text style={styles.buttonTextMuted}>Előző</Text>
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
                <Text style={styles.buttonTextMuted}>Következő</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item: sor }) =>
          sor.fajta === "varakozo" ? (
            /*
              A VARAKOZO SOR NEM UGY NEZ KI, MINT A TOBBI, ES EZ A KIKOTES.
              Balazs epp azt panaszolta, hogy nem tudja, sikerult-e. Egy sor,
              ami ugyanugy nez ki, mint a kesz eszkozok, MASIK hazugsag
              ugyanarrol -- ezert kap sajat hatteret, keretet es feliratot,
              nem csak egy halvany arnyalatot.

              ES NEM KATTINTHATO: adatlapja meg nincs, mert azonositot a
              szerver ad a felmenetelkor. Egy kattintas ures kepernyore
              vinne, es az ugy nezne ki, mintha elveszett volna.
            */
            <View style={styles.varakozoSor}>
              <Text style={styles.varakozoCimke}>FELTÖLTÉSRE VÁR</Text>
              <Text style={styles.varakozoNev}>{sor.tetel.name}</Text>
              <Text style={styles.varakozoMeta}>
                {sor.tetel.labelCode
                  ? `Matricakód: ${sor.tetel.labelCode}`
                  : "Eszközszámot a feltöltéskor kap."}
              </Text>
            </View>
          ) : (
            <AssetCard
              asset={sor.tetel}
              onPress={() =>
                valasztKodhoz
                  ? router.replace({
                      pathname: "/assets/edit/[id]",
                      params: { id: sor.tetel.id, labelCode: valasztKodhoz },
                    })
                  : router.push({
                      pathname: "/assets/[id]",
                      params: { id: sor.tetel.id },
                    })
              }
            />
          )
        }
      />
    </SafeAreaView>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- ez a
 * képernyő eddig saját, fix sötét hexekkel élt (`#071827` stb.), ugyanúgy,
 * ahogy az `AssetCard` is állt a saját migrálása előtt (lásd ott a
 * fejlécet). Az "Eszköznyilvántartás" Figma 7. kör része, ami világos ÉS
 * sötét módot kér -- enélkül a világos mód nem is létezne ezen a
 * képernyőn.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    valasztoSav: {
      marginBottom: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.accentBorder,
      backgroundColor: t.accentSoft,
    },
    valasztoCimke: { color: t.accentSoftText, fontWeight: "800", fontSize: 12 },
    valasztoMeta: {
      color: t.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 4,
    },
    safeArea: { flex: 1, backgroundColor: t.background },
    varakozoSor: {
      backgroundColor: t.warningSoft,
      borderColor: t.warning,
      borderRadius: 12,
      borderWidth: 2,
      padding: 14,
    },
    varakozoCimke: {
      color: t.warning,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.2,
    },
    varakozoNev: {
      color: t.textPrimary,
      fontSize: 16,
      fontWeight: "800",
      marginTop: 6,
    },
    varakozoMeta: { color: t.textSecondary, fontSize: 13, marginTop: 4 },
    varakozoUzenet: {
      backgroundColor: t.warningSoft,
      borderColor: t.warning,
      borderRadius: 12,
      borderWidth: 2,
      marginBottom: 16,
      padding: 14,
    },
    container: { padding: 18, paddingBottom: 36 },
    header: { marginBottom: 20 },
    eyebrow: {
      color: t.accent,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.5,
    },
    title: {
      color: t.textPrimary,
      fontSize: 28,
      fontWeight: "900",
      marginTop: 6,
    },
    subtitle: {
      color: t.textSecondary,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 6,
    },
    cacheLine: { color: t.textMuted, fontSize: 12, marginTop: 10 },
    search: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      color: t.textPrimary,
      marginTop: 14,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    tabRow: { marginTop: 12 },
    tabRowContent: { gap: 8, paddingRight: 4 },
    tab: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
    },
    tabActive: { backgroundColor: t.accent, borderColor: t.accent },
    tabLabel: { color: t.textSecondary, fontSize: 12, fontWeight: "700" },
    tabLabelActive: { color: t.textOnAccent },
    pager: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      justifyContent: "center",
      paddingTop: 18,
    },
    pagerButton: {
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 9,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    pagerDisabled: { opacity: 0.5 },
    pagerLabel: { color: t.textSecondary, fontSize: 12 },
    separator: { height: 12 },
    headerActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 16,
    },
    primaryButton: {
      borderRadius: 10,
      backgroundColor: t.accent,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    secondaryButton: {
      borderRadius: 10,
      backgroundColor: t.surfaceRaised,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: t.border,
    },
    messageCard: {
      borderRadius: 18,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      padding: 18,
      gap: 8,
    },
    errorTitle: { color: t.textPrimary, fontSize: 17, fontWeight: "800" },
    messageText: { color: t.textSecondary, lineHeight: 20 },
    button: {
      alignSelf: "flex-start",
      borderRadius: 10,
      backgroundColor: t.accent,
      paddingHorizontal: 14,
      paddingVertical: 9,
      marginTop: 5,
    },
    buttonText: { color: t.textOnAccent, fontWeight: "800" },
    buttonTextMuted: { color: t.textPrimary, fontWeight: "800" },
  });
}
