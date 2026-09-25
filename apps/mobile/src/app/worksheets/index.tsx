import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
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

import {
  listSelectableWorksheetPartners,
  listWorksheets,
  type WorksheetSelectablePartner,
  type WorksheetVersionStatus,
} from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { belsosIrasEngedett } from "@/lib/auth/hatokor";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";
import {
  worksheetAssigneeLine,
  worksheetFilterSummary,
  worksheetLabelOrDraft,
  worksheetListStartsMineOnly,
  worksheetListSubtitle,
  worksheetStatusLabel,
  worksheetVersionNote,
  WORKSHEET_STATUS_FILTERS,
} from "@/lib/worksheets/worksheet-presentation";

const PAGE_SIZE = 25;

/**
 * MUNKALAPOK, telefonon.
 *
 * A képernyő nem ír. A lap megírása, lezárása és aláíratása a webes felületen
 * történik; itt az a kérdés, hogy MIT KELL CSINÁLNI, HOL, és KIRE VAN KIOSZTVA.
 *
 * A „Csak az enyém" szűrő a SZERVEREN fut (`assigneeId`), nem a telefonon: egy
 * már lapozott halmazból itt kiszedni az idegen sorokat annyi lenne, mint
 * huszonöt sor helyett hármat mutatni egy oldalon, miközben a darabszám a
 * többit is beleszámolja.
 *
 * A LISTA MINDEN SZEREPKÖRBEN A TELJES HALMAZZAL NYÍLIK (Balázs kérése,
 * 2026-09-17: „a szűrésnél a minden munkalap legyen az alapértelmezett").
 * Korábban itt az állt, hogy a szerelőnek alapból a saját lapjai kellenek, és a
 * képernyő `SERVICE` szerepkörben szűkítve indult -- a telefont használó
 * szerelő épp ezt kérte meg fordítani. A kiindulási állapot a
 * `worksheetListStartsMineOnly` függvényben áll, mert a képernyő törzsére
 * nincs komponens-teszt: ott egy visszaírt szűkítést semmi nem mérne.
 *
 * A SZŰRŐ ÁLLAPOTA LÁTSZIK, és ez nem díszítés: nem szabad, hogy a lista
 * CSENDBEN legyen szűkebb, mint amit a felirata ígér. Ezért a kapcsoló mindig
 * kiírja, épp melyik halmazt mutatja.
 *
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- Figma 8. kör,
 * telefonos átültetés (`exchange/figma-munkalapok-make-8/src/MunkalapokScreen.tsx`
 * `MobileMunkalapokList`), az Eszköznyilvántartás mobil átültetésének
 * (#1087) mintáját követve: ez a képernyő eddig saját, fix sötét hexekkel élt
 * (`#071827` stb.), tehát világos mód eddig nem is létezett rajta.
 *
 * A KÁRTYA ELRENDEZÉSE A FIGMA-TERVET KÖVETI (cím + állapot-jelvény egy
 * sorban, alatta a szám monospace-ban, alul a helyszín/partner és a felelős
 * egy sorban) -- A TARTALOM ÉS A TÍZ SZÖVEG-DÖNTÉS VÁLTOZATLAN (acrobot
 * döntése, 2026-09-25, Figma 8. kör szöveges köre): a cím a tárgy, a szám
 * másodlagos, "Minden partner"/"Nincs munkalap"/"Nincs találat a keresési
 * feltételekre" stb. mind marad.
 *
 * AZ ÁLLAPOT-JELVÉNY EGYETLEN, EGYSÉGES SZÍNT VISEL, NEM ÁLLAPOTONKÉNT
 * KÜLÖNBÖZŐT -- ugyanígy volt a migráció ELŐTT is (`statusChip`/`statusText`
 * mindig ugyanaz a fix teal volt), és az Eszköznyilvántartás mobil
 * átültetése (`AssetCard`) sem vezetett be státusz-szerinti színezést a
 * Figma terve ellenére. A per-státusz szín (ahogy a Figma `AllapotBadge`-e
 * mutatja) egy ÚJ funkció lenne, nem re-skin -- ha ez másodszor is felmerül
 * (pl. a munkalap-adatlap verzió-táblájánál), akkor éri meg megosztott
 * függvénnyé tenni, nem előre.
 */
export default function WorksheetsScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [mineOnly, setMineOnly] = useState(
    worksheetListStartsMineOnly(user?.role),
  );
  const [partner, setPartner] = useState<WorksheetSelectablePartner | null>(
    null,
  );
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [statusFilter, setStatusFilter] =
    useState<WorksheetVersionStatus | null>(null);

  /*
   * A PARTNEREK CSAK AKKOR TÖLTŐDNEK BE, AMIKOR A VÁLASZTÓ KINYÍLIK. A lista a
   * lapokra írható partnereké (szerviz jelölés és rövidítés kell hozzá), és
   * ugyanarról a végpontról jön, mint a webes felvitel választója.
   */
  const partners = useQuery({
    queryKey: ["worksheet-selectable-partners"],
    queryFn: listSelectableWorksheetPartners,
    enabled: partnerPickerOpen && status === "authenticated",
  });

  const assigneeId = mineOnly ? user?.id : undefined;
  const worksheets = useQuery({
    queryKey: [
      "worksheets",
      {
        page,
        search,
        assigneeId,
        customerId: partner?.customerId,
        statusFilter,
      },
    ],
    queryFn: () =>
      listWorksheets({
        page,
        pageSize: PAGE_SIZE,
        search,
        assigneeId,
        customerId: partner?.customerId,
        status: statusFilter ?? undefined,
      }),
    enabled: Boolean(
      capabilities?.worksheetsView && status === "authenticated",
    ),
    placeholderData: keepPreviousData,
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;

  if (!capabilities.worksheetsView)
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>
            Nincs hozzáférésed a munkalapokhoz
          </Text>
          <Text style={styles.errorText}>
            A megnyitáshoz service.view jogosultság szükséges.
          </Text>
        </View>
      </SafeAreaView>
    );

  const items = worksheets.data?.items ?? [];
  const total = worksheets.data?.pagination.totalItems ?? 0;
  const totalPages = worksheets.data?.pagination.totalPages ?? 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={worksheets.isRefetching && !worksheets.isPending}
            onRefresh={() => void worksheets.refetch()}
            tintColor={tokens.accent}
          />
        }
      >
        {/*
          A SAJÁT TERVKÖR SZERINT (2026-09-25, acrobot döntése az
          app-szintű minták ügyében): a Munkalapok lista saját terve
          (`MunkalapokScreen.tsx` 1108. sor, `MobileMunkalapokList`)
          "Szerviz" feliratot ad, 10px, alap (nem félkövér) súllyal,
          betűköz és nagybetűsítés nélkül, szürkével -- eddig ez a
          képernyő is az app többi listáján élt, mindenhol egyforma
          nagybetűs/félkövér mintát követte (11px/900, végig nagybetűs
          "SZERVIZ").
        */}
        <Text style={styles.eyebrow}>Szerviz</Text>
        <Text style={styles.title}>Munkalapok</Text>
        <Text style={styles.subtitle}>
          {worksheets.data
            ? `${total.toLocaleString("hu-HU")} munkalap${mineOnly ? ", rád kiosztva" : ""}`
            : "Munkalapok a helyszíni munkához"}
        </Text>

        {/*
          ÚJ LAP A HELYSZÍNRŐL. Két kapu, és a MÁSODIK 2026-09-22-én került ide.

          A `worksheetsManage` jog ÖNMAGÁBAN nem elég: a `PARTNER_SERVICE`
          szerep VISELI ezt a jogot (a szerver tényleg megadja), a munkalap
          LÉTREHOZÁSÁT viszont a szerver a HATÓKÖRHÖZ köti
          (`requireInternalWriter`), és partnernek `Forbidden`-t ad. Egy gomb,
          ami 403-mal tér vissza, rosszabb, mint egy gomb, ami nincs ott -- és
          a mondat alatta megmondja, MIÉRT nincs.
        */}
        {capabilities?.worksheetsManage && user && belsosIrasEngedett(user) ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/worksheets/new")}
            style={({ pressed }) => [
              styles.newButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.newButtonText}>Új munkalap</Text>
          </Pressable>
        ) : capabilities?.worksheetsManage ? (
          /*
            A REJTES NEM ELEG: a szerver uzenete („belsos lepes") egy VALODI
            szabalyt mond ki, es a partnernek meg kell tudnia, miert nincs ott
            a gomb. Enelkul a hianyzo gomb ugyanugy nez ki, mint egy elromlott
            kepernyo.
          */
          <Text style={styles.partnerMegjegyzes}>
            A munkalapot a szerviz készíti. Itt a saját hibajegyeihez tartozó
            lapok olvashatók.
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: mineOnly }}
          accessibilityLabel={
            mineOnly
              ? "Csak a rád kiosztott lapok. Koppints az összes megjelenítéséhez."
              : "Minden munkalap. Koppints a rád kiosztott lapokhoz."
          }
          onPress={() => {
            setMineOnly((value) => !value);
            // Új szűrő = első oldal. Enélkül egy szűkebb halmaz harmadik
            // oldalán állnánk, ami üresen jönne vissza.
            setPage(1);
          }}
          style={({ pressed }) => [
            styles.filterToggle,
            mineOnly && styles.filterToggleOn,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.filterText, mineOnly && styles.filterTextOn]}>
            {mineOnly ? "Csak az enyém" : "Minden munkalap"}
          </Text>
        </Pressable>

        {/*
          PARTNER SZERINT. A választó csak akkor tölt be listát, amikor kinyílik:
          a szerelőnek a lapjai kellenek, nem a partnertörzs, és a legtöbb
          megnyitásnál hozzá sem nyúl.
        */}
        {/*
          "MINDEN PARTNER", NEM "PARTNER: MIND" (acrobot döntése, 2026-09-25,
          Figma 8. kör): a leírás és a terv is ezt a szót használja a
          szűretlen állapotra. Kiválasztott partnernél a "Partner: {név}" alak
          marad -- azt a döntés nem érintette.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            partner
              ? `Partner szűrő: ${partner.name}. Koppints a módosításhoz.`
              : "Minden partner. Koppints a választáshoz."
          }
          onPress={() => setPartnerPickerOpen((open) => !open)}
          style={({ pressed }) => [
            styles.filterToggle,
            partner && styles.filterToggleOn,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.filterText, partner && styles.filterTextOn]}>
            {partner ? `Partner: ${partner.name}` : "Minden partner"}
          </Text>
        </Pressable>

        {partnerPickerOpen ? (
          <View style={styles.partnerList}>
            {partners.isPending ? (
              <ActivityIndicator color={tokens.accent} />
            ) : null}
            {partners.isError ? (
              <Text style={styles.error}>
                A partnerek listája nem tölthető be.
              </Text>
            ) : null}
            <Pressable
              onPress={() => {
                setPartner(null);
                setPartnerPickerOpen(false);
                setPage(1);
              }}
              style={({ pressed }) => [
                styles.partnerRow,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.partnerName}>Minden partner</Text>
            </Pressable>
            {(partners.data?.items ?? []).map((item) => (
              <Pressable
                key={item.customerId}
                onPress={() => {
                  setPartner(item);
                  setPartnerPickerOpen(false);
                  // Új szűrő = első oldal, különben egy szűkebb halmaz
                  // harmadik oldalán állnánk, ami üresen jönne vissza.
                  setPage(1);
                }}
                style={({ pressed }) => [
                  styles.partnerRow,
                  partner?.customerId === item.customerId &&
                    styles.partnerRowOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.partnerName}>{item.name}</Text>
                <Text style={styles.partnerMeta}>{item.partnerCode}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/*
          ÁLLAPOT SZERINT. A szerver a LEGUTOLSÓ verzió állapotára szűr, tehát
          egy háromszor átírt, ma már aláírt lap nem jön fel „piszkozat"
          szűrőre.
        */}
        <View style={styles.statusFilters}>
          {WORKSHEET_STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter.value;
            return (
              <Pressable
                key={filter.label}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setStatusFilter(filter.value);
                  setPage(1);
                }}
                style={({ pressed }) => [
                  styles.statusFilter,
                  active && styles.statusFilterOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.statusFilterText,
                    active && styles.statusFilterTextOn,
                  ]}
                >
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={search}
          onChangeText={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Keresés szám, partner vagy tárgy szerint"
          placeholderTextColor={tokens.textMuted}
          style={styles.input}
        />

        {/*
          MIT MUTAT ÉPPEN A LISTA. Három szűrő mind szűkít, és egy üres lista
          előtt a szerelőnek tudnia kell, hogy nincs ilyen lap, vagy csak túl
          szűkre állította magának. A mondat a `worksheet-presentation.ts`
          modulban áll, mert ott mérhető.
        */}
        <Text style={styles.filterSummary}>
          {worksheetFilterSummary({
            mineOnly,
            partnerName: partner?.name,
            status: statusFilter,
            search,
          })}
        </Text>

        {worksheets.isPending ? (
          <ActivityIndicator color={tokens.accent} />
        ) : null}

        {worksheets.isError ? (
          <Text style={styles.error}>
            {worksheets.error instanceof Error
              ? worksheets.error.message
              : "A munkalapok listája nem tölthető be."}
          </Text>
        ) : null}

        {!worksheets.isPending && !worksheets.isError && items.length === 0 ? (
          /*
           * AZ ÜRES LISTA OKA. Négy szűrő közül bármelyik szűkíthet (saját
           * lapok, partner, állapot, keresés), és a „Még nincs munkalap"
           * mondat mindegyik mellett HAMIS lenne: van lap, csak nem ilyen. A
           * fölötte álló összefoglaló megmondja, mire szűkítettünk.
           */
          <Text style={styles.empty}>
            {/*
              A LEÍRÁS ÉS A TERV SZAVAI (acrobot döntése, 2026-09-25, Figma 8.
              kör), a mai mobil két mondata helyett.
            */}
            {mineOnly || partner || statusFilter || search.trim()
              ? "Nincs találat a keresési feltételekre."
              : "Nincs munkalap."}
          </Text>
        ) : null}

        {items.map((item) => {
          const versionNote = worksheetVersionNote(item);
          return (
            <Pressable
              key={item.id}
              onPress={() =>
                router.push({
                  pathname: "/worksheets/[id]",
                  params: { id: item.id },
                })
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              {/*
                A CÍM A TÁRGY, A SZÁM ALATTA (acrobot döntése, 2026-09-25,
                Figma 8. kör): a web és a Figma-terv is így csoportosít, a
                mai mobil (szám a cím) ELLENTÉTES sorrendet mutatott. A cím és
                a jelvény EGY sorban áll -- Figma 8. kör, telefonos átültetés.
              */}
              <View style={styles.rowHeader}>
                <Text style={styles.rowTitle}>{item.subject}</Text>
                <View style={styles.statusChip}>
                  <Text style={styles.statusText}>
                    {worksheetStatusLabel[item.status]}
                  </Text>
                </View>
              </View>
              <Text style={styles.rowNumber}>
                {worksheetLabelOrDraft(item.label)}
              </Text>
              <View style={styles.rowFooter}>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {worksheetListSubtitle(item)}
                </Text>
                <Text style={styles.rowAssignee}>
                  {worksheetAssigneeLine(item.assigneeNames)}
                </Text>
                {/* A brutto osszeg 2026-09-17-en kikerult a listabol:
                    Balazs dontese ("B") szerint az ar sehol nem jelenik meg. */}
              </View>
              {versionNote ? (
                <Text style={styles.rowVersion}>{versionNote}</Text>
              ) : null}
            </Pressable>
          );
        })}

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

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    partnerMegjegyzes: {
      color: t.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 4,
    },
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 18, paddingBottom: 48, gap: 12 },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    eyebrow: {
      color: t.textMuted,
      fontSize: 10,
      fontWeight: "400",
    },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "900" },
    subtitle: { color: t.textSecondary },
    filterToggle: {
      alignSelf: "flex-start",
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    filterToggleOn: {
      backgroundColor: t.accentSoft,
      borderColor: t.accentBorder,
    },
    filterText: { color: t.textSecondary, fontSize: 12, fontWeight: "800" },
    partnerList: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 12,
      borderWidth: 1,
      gap: 2,
      padding: 6,
    },
    partnerRow: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
    partnerRowOn: { backgroundColor: t.accentSoft },
    partnerName: { color: t.textPrimary, fontSize: 14 },
    partnerMeta: { color: t.textMuted, fontSize: 11, marginTop: 2 },
    statusFilters: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    statusFilter: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 11,
      paddingVertical: 7,
    },
    statusFilterOn: {
      backgroundColor: t.accentSoft,
      borderColor: t.accentBorder,
    },
    statusFilterText: {
      color: t.textSecondary,
      fontSize: 11,
      fontWeight: "800",
    },
    statusFilterTextOn: { color: t.accentSoftText },
    filterSummary: { color: t.textMuted, fontSize: 12 },
    filterTextOn: { color: t.accentSoftText },
    input: {
      color: t.textPrimary,
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    row: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      gap: 4,
      padding: 14,
    },
    rowHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
    },
    rowTitle: {
      color: t.textPrimary,
      flex: 1,
      fontSize: 16,
      fontWeight: "800",
    },
    statusChip: {
      backgroundColor: t.accentSoft,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    statusText: { color: t.accentSoftText, fontSize: 11, fontWeight: "800" },
    rowMeta: { color: t.textSecondary, flex: 1, fontSize: 12 },
    /**
     * A SZÁM MOST A MÁSODLAGOS SOR (acrobot döntése, 2026-09-25): monospace,
     * hogy egy szám-szerű azonosító megkülönböztesse magát a tárgy szövegétől.
     */
    rowNumber: { color: t.textMuted, fontFamily: "monospace", fontSize: 12 },
    rowFooter: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
      marginTop: 2,
    },
    rowAssignee: { color: t.textSecondary, fontSize: 12 },
    rowVersion: { color: t.warning, fontSize: 11, fontWeight: "700" },
    empty: { color: t.textSecondary },
    newButton: {
      backgroundColor: t.accent,
      borderRadius: 12,
      padding: 13,
    },
    newButtonText: {
      color: t.textOnAccent,
      fontSize: 14,
      fontWeight: "900",
      textAlign: "center",
    },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
    errorTitle: { color: t.textPrimary, fontSize: 18, fontWeight: "900" },
    errorText: { color: t.textSecondary, marginTop: 6, textAlign: "center" },
    pager: { flexDirection: "row", alignItems: "center", gap: 12 },
    pagerButton: {
      backgroundColor: t.surfaceRaised,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 9,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    pagerText: { color: t.textPrimary, fontWeight: "800", fontSize: 12 },
    pagerLabel: { color: t.textSecondary, fontSize: 12 },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.75 },
  });
}
