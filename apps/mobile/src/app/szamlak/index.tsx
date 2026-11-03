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

import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";
import {
  listIncomingDocuments,
  listOutgoingDocuments,
} from "@/lib/api/billing";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getBillingCapabilities } from "@/lib/auth/webshop-authorization";
import {
  incomingRow,
  outgoingRow,
  type ListRow,
  type Tone,
} from "@/lib/billing/presentation";

const PAGE_SIZE = 25;

type Direction = "outgoing" | "incoming";

/**
 * SZÁMLÁK, telefonon, CSAK OLVASÁSRA (Balázs, 2026-11-03 17:01 UTC, kártya 050e138b): keresés, lista, megnyitás, a
 * kimenő (kiállított számla, díjbekérő, a külső bizonylatok) és a bejövő számlák. Létrehozás, szerkesztés, jóváhagyás
 * nincs: egy ilyen gomb itt nem hiányzik, hanem a weben van a helye.
 *
 * A láthatóság a szerver menüjéből jön (`billing`, `billing.view`); a képernyő mégis maga is megnézi a jogot, mert
 * mélylinkkel a csempe nélkül is ide lehet jutni.
 */
export default function BillingScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const canView = user ? getBillingCapabilities(user).billingView : false;
  const [direction, setDirection] = useState<Direction>("outgoing");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const enabled = canView && status === "authenticated";
  const outgoing = useQuery({
    queryKey: ["billing-outgoing", { page, search }],
    queryFn: () => listOutgoingDocuments(page, PAGE_SIZE, search),
    enabled: enabled && direction === "outgoing",
    placeholderData: keepPreviousData,
  });
  const incoming = useQuery({
    queryKey: ["billing-incoming", { page, search }],
    queryFn: () => listIncomingDocuments(page, PAGE_SIZE, search),
    enabled: enabled && direction === "incoming",
    placeholderData: keepPreviousData,
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;

  if (!canView)
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Nincs hozzáférésed a számlákhoz</Text>
          <Text style={styles.errorText}>
            A megnyitáshoz billing.view jogosultság szükséges.
          </Text>
        </View>
      </SafeAreaView>
    );

  const query = direction === "outgoing" ? outgoing : incoming;
  const rows: ListRow[] =
    direction === "outgoing"
      ? (outgoing.data?.items ?? []).map(outgoingRow)
      : (incoming.data?.items ?? []).map(incomingRow);
  const total = query.data?.pagination.totalItems ?? 0;
  const totalPages = query.data?.pagination.totalPages ?? 1;

  const switchTo = (next: Direction) => {
    setDirection(next);
    // Új irány = első oldal: a másik lista harmadik oldala itt nem ugyanaz.
    setPage(1);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isPending}
            onRefresh={() => void query.refetch()}
            tintColor={tokens.accent}
          />
        }
      >
        <Text style={styles.eyebrow}>PÉNZÜGY</Text>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Számlák</Text>
          <Text style={styles.subtitle}>
            {query.data
              ? `${total.toLocaleString("hu-HU")} bizonylat`
              : "Csak olvasásra"}
          </Text>
        </View>

        <View style={styles.segment} accessibilityRole="tablist">
          {(
            [
              ["outgoing", "Kimenő"],
              ["incoming", "Bejövő"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: direction === key }}
              onPress={() => switchTo(key)}
              style={[
                styles.segmentItem,
                direction === key && styles.segmentItemActive,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  direction === key && styles.segmentTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={search}
          onChangeText={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder={
            direction === "outgoing"
              ? "Keresés számra vagy vevőre"
              : "Keresés szállítóra vagy adószámra"
          }
          placeholderTextColor={tokens.textMuted}
          style={styles.input}
        />

        {query.isPending ? <ActivityIndicator color={tokens.accent} /> : null}

        {query.isError ? (
          <Text style={styles.error}>
            {query.error instanceof Error
              ? query.error.message
              : "A számlalista nem tölthető be."}
          </Text>
        ) : null}

        {!query.isPending && !query.isError && rows.length === 0 ? (
          <Text style={styles.empty}>
            {search.trim()
              ? "Erre a keresésre nincs számla."
              : direction === "outgoing"
                ? "Még nincs kimenő bizonylat."
                : "Még nincs bejövő számla."}
          </Text>
        ) : null}

        {rows.map((row) => {
          const content = (
            <>
              <View style={styles.rowTop}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {row.title}
                </Text>
                <Text
                  style={[styles.badge, badgeStyle(styles, row.badge.tone)]}
                >
                  {row.badge.label}
                </Text>
              </View>
              <Text style={styles.rowPartner} numberOfLines={1}>
                {row.partner}
              </Text>
              <View style={styles.rowBottom}>
                <Text style={styles.rowMeta}>{row.meta}</Text>
                <Text style={styles.rowAmount}>{row.amount}</Text>
              </View>
              {row.closedReason ? (
                <Text style={styles.rowClosed}>{row.closedReason}</Text>
              ) : null}
            </>
          );
          const opens = row.opens;
          return opens ? (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/szamlak/[id]",
                  params: { id: row.id, fajta: opens },
                })
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              {content}
            </Pressable>
          ) : (
            <View key={row.id} style={[styles.row, styles.rowDisabled]}>
              {content}
            </View>
          );
        })}

        {totalPages > 1 ? (
          <View style={styles.pager}>
            <Pressable
              disabled={page <= 1}
              onPress={() => setPage((value) => Math.max(1, value - 1))}
              style={[styles.pagerButton, page <= 1 && styles.disabled]}
            >
              <Text style={styles.pagerText}>‹ Előző</Text>
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
              <Text style={styles.pagerText}>Következő ›</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function badgeStyle(styles: ReturnType<typeof createStyles>, tone: Tone) {
  return tone === "success"
    ? styles.badgeSuccess
    : tone === "warning"
      ? styles.badgeWarning
      : tone === "danger"
        ? styles.badgeDanger
        : styles.badgeNeutral;
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 18, paddingBottom: 48, gap: 12 },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    eyebrow: {
      color: t.accent,
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 1,
    },
    titleRow: {
      alignItems: "baseline",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "900" },
    subtitle: { color: t.textSecondary },
    segment: {
      flexDirection: "row",
      backgroundColor: t.surfaceRaised,
      borderRadius: 10,
      padding: 3,
      gap: 3,
    },
    segmentItem: {
      flex: 1,
      alignItems: "center",
      borderRadius: 8,
      paddingVertical: 9,
    },
    segmentItemActive: { backgroundColor: t.accent },
    segmentText: { color: t.textSecondary, fontWeight: "800" },
    segmentTextActive: { color: t.textOnAccent },
    input: {
      color: t.textPrimary,
      backgroundColor: t.background,
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
      padding: 14,
      gap: 4,
    },
    rowDisabled: { opacity: 0.8 },
    pressed: { opacity: 0.75 },
    rowTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    rowTitle: {
      color: t.textPrimary,
      fontSize: 16,
      fontWeight: "800",
      flexShrink: 1,
    },
    rowPartner: { color: t.textSecondary, fontSize: 14 },
    rowBottom: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 8,
    },
    rowMeta: { color: t.textMuted, fontSize: 12, flexShrink: 1 },
    rowAmount: { color: t.textPrimary, fontSize: 14, fontWeight: "800" },
    rowClosed: { color: t.textMuted, fontSize: 12, fontStyle: "italic" },
    badge: {
      fontSize: 11,
      fontWeight: "800",
      borderRadius: 8,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeNeutral: { color: t.textSecondary, backgroundColor: t.surfaceRaised },
    badgeSuccess: { color: t.success, backgroundColor: t.successSoft },
    badgeWarning: { color: t.warning, backgroundColor: t.warningSoft },
    badgeDanger: { color: t.danger, backgroundColor: t.dangerSoft },
    empty: { color: t.textSecondary },
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
      borderRadius: 9,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    pagerText: { color: t.textPrimary, fontWeight: "800", fontSize: 12 },
    pagerLabel: { color: t.textSecondary, fontSize: 12 },
    disabled: { opacity: 0.5 },
  });
}
