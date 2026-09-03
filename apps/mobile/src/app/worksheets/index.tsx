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

import {
  listSelectableWorksheetPartners,
  listWorksheets,
  type WorksheetSelectablePartner,
  type WorksheetVersionStatus,
} from "@/lib/api/worksheets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import {
  formatWorksheetAmount,
  worksheetAssigneeLine,
  worksheetFilterSummary,
  worksheetLabelOrDraft,
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
 * A SZŰRŐ ÁLLAPOTA LÁTSZIK, és ez nem díszítés. A szerelőnek alapból a saját
 * lapjai kellenek, az irodai szerepköröknek viszont mind -- de egyik oldalon
 * sem szabad, hogy a lista CSENDBEN legyen szűkebb, mint amit a felirata ígér.
 * Ezért a kapcsoló mindig kiírja, épp melyik halmazt mutatja.
 */
export default function WorksheetsScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [mineOnly, setMineOnly] = useState(user?.role === "SERVICE");
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
            tintColor="#52d6c7"
          />
        }
      >
        <Text style={styles.eyebrow}>SZERVIZ</Text>
        <Text style={styles.title}>Munkalapok</Text>
        <Text style={styles.subtitle}>
          {worksheets.data
            ? `${total.toLocaleString("hu-HU")} munkalap${mineOnly ? ", rád kiosztva" : ""}`
            : "Munkalapok a helyszíni munkához"}
        </Text>

        {/*
          ÚJ LAP A HELYSZÍNRŐL. Csak `worksheetsManage` joggal látszik, ugyanaz a
          kapu, ami a szerveren az írást védi -- egy gomb, ami 403-mal tér
          vissza, rosszabb, mint egy gomb, ami nincs ott.
        */}
        {capabilities?.worksheetsManage ? (
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            partner
              ? `Partner szűrő: ${partner.name}. Koppints a módosításhoz.`
              : "Partner szűrő: mind. Koppints a választáshoz."
          }
          onPress={() => setPartnerPickerOpen((open) => !open)}
          style={({ pressed }) => [
            styles.filterToggle,
            partner && styles.filterToggleOn,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.filterText, partner && styles.filterTextOn]}>
            {partner ? `Partner: ${partner.name}` : "Partner: mind"}
          </Text>
        </Pressable>

        {partnerPickerOpen ? (
          <View style={styles.partnerList}>
            {partners.isPending ? <ActivityIndicator color="#52d6c7" /> : null}
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
              <Text style={styles.partnerName}>Mind</Text>
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
          placeholderTextColor="#668798"
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

        {worksheets.isPending ? <ActivityIndicator color="#52d6c7" /> : null}

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
            {mineOnly || partner || statusFilter || search.trim()
              ? "Erre a szűrésre nincs munkalap."
              : "Még nincs munkalap."}
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
              <View style={styles.rowHeader}>
                <Text style={styles.rowTitle}>
                  {worksheetLabelOrDraft(item.label)}
                </Text>
                <View style={styles.statusChip}>
                  <Text style={styles.statusText}>
                    {worksheetStatusLabel[item.status]}
                  </Text>
                </View>
              </View>
              <Text style={styles.rowMeta}>{worksheetListSubtitle(item)}</Text>
              <Text style={styles.rowSubject}>{item.subject}</Text>
              <View style={styles.rowFooter}>
                <Text style={styles.rowAssignee}>
                  {worksheetAssigneeLine(item.assigneeNames)}
                </Text>
                <Text style={styles.rowAmount}>
                  {formatWorksheetAmount(item.grossAmount)}
                </Text>
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
  filterToggle: {
    alignSelf: "flex-start",
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  filterToggleOn: { backgroundColor: "#123f3b", borderColor: "#1f6b62" },
  filterText: { color: "#91afbe", fontSize: 12, fontWeight: "800" },
  partnerList: {
    backgroundColor: "#071f31",
    borderColor: "#28536a",
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
    padding: 6,
  },
  partnerRow: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
  partnerRowOn: { backgroundColor: "#123f3b" },
  partnerName: { color: "#f4fbff", fontSize: 14 },
  partnerMeta: { color: "#789cad", fontSize: 11, marginTop: 2 },
  statusFilters: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statusFilter: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  statusFilterOn: { backgroundColor: "#123f3b", borderColor: "#1f6b62" },
  statusFilterText: { color: "#91afbe", fontSize: 11, fontWeight: "800" },
  statusFilterTextOn: { color: "#6de0ce" },
  filterSummary: { color: "#6f93a8", fontSize: 12 },
  filterTextOn: { color: "#6de0ce" },
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
    gap: 4,
    padding: 14,
  },
  rowHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  rowTitle: { color: "#f4fbff", flex: 1, fontSize: 16, fontWeight: "800" },
  statusChip: {
    backgroundColor: "#123f3b",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: { color: "#6de0ce", fontSize: 11, fontWeight: "800" },
  rowMeta: { color: "#789cad", fontSize: 12 },
  rowSubject: { color: "#d9edf7", fontSize: 14 },
  rowFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    marginTop: 2,
  },
  rowAssignee: { color: "#91afbe", flex: 1, fontSize: 12 },
  rowAmount: { color: "#f4fbff", fontSize: 13, fontWeight: "800" },
  rowVersion: { color: "#e2b168", fontSize: 11, fontWeight: "700" },
  empty: { color: "#91afbe" },
  newButton: {
    backgroundColor: "#177b74",
    borderRadius: 12,
    padding: 13,
  },
  newButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
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
  pressed: { opacity: 0.75 },
});
