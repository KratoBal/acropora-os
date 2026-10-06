import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  listPendingServiceDrafts,
  type ServiceDraftListItem,
} from "@/lib/api/service-drafts";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  canReviewServiceDrafts,
  draftFilterLabel,
  draftMetaLine,
} from "@/lib/service-drafts/presentation";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * A CÁPASULI PISZKOZATOK A TELEFONON (kártya 49210cdd).
 *
 * IDE VISZ az „Új Cápasuli piszkozatok” értesítés (`serviceDrafts` célpont).
 * Addig a koppintás a nyitólapra vitt, mert a Piszkozatok oldal csak a weben
 * létezett (Balázs kapta így 2026-10-06 17:05-kor).
 *
 * EGYELŐRE CSAK OLVAS: a várakozó kérések listája. Az elfogadás (osztály és
 * bejelentő választásával), az elutasítás és a kiszűrt tételek a weben vannak,
 * és ezt a képernyő ki is mondja: egy hiányzó gomb ugyanúgy néz ki, mint egy
 * elromlott. Az értesítés `id` paramétere (a levél azonosítója) itt nem kell:
 * a lista a levél ÖSSZES várakozó kérését úgyis mutatja.
 */
export default function ServiceDraftsScreen() {
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const allowed = canReviewServiceDrafts(user);
  const drafts = useQuery({
    queryKey: ["service-drafts", "PENDING"],
    queryFn: listPendingServiceDrafts,
    enabled: status === "authenticated" && allowed,
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;

  if (!allowed)
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centered}>
          <Text style={styles.title}>Nincs hozzáférésed</Text>
          <Text style={styles.hint}>
            A piszkozatokat csak a belső adminisztrátorok látják.
          </Text>
        </View>
      </SafeAreaView>
    );

  const items = drafts.data?.items ?? [];
  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <FlatList
        contentContainerStyle={styles.list}
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={drafts.isRefetching && !drafts.isPending}
            onRefresh={() => void drafts.refetch()}
            tintColor={tokens.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Várakozó piszkozatok</Text>
            <Text style={styles.hint}>
              {drafts.data
                ? `${items.length}${drafts.data.nextCursor ? "+" : ""} kérés vár elbírálásra.`
                : "A Cápasuli napi jelentőiből."}{" "}
              Elfogadni és elutasítani egyelőre a weben lehet (Szerviz /
              Piszkozatok).
            </Text>
            {drafts.isPending ? (
              <ActivityIndicator color={tokens.accent} size="large" />
            ) : null}
            {drafts.isError ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>
                  {drafts.error instanceof Error
                    ? drafts.error.message
                    : "A piszkozatok betöltése nem sikerült."}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void drafts.refetch()}
                  style={({ pressed }) => [
                    styles.retry,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.retryText}>Újrapróbálás</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          drafts.isSuccess ? (
            <View style={styles.card}>
              <Text style={styles.hint}>Nincs várakozó piszkozat.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <DraftCard
            item={item}
            filterEnabled={drafts.data?.filterEnabled ?? false}
            styles={styles}
          />
        )}
      />
    </SafeAreaView>
  );
}

function DraftCard({
  item,
  filterEnabled,
  styles,
}: {
  item: ServiceDraftListItem;
  filterEnabled: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const badge = draftFilterLabel(item, filterEnabled);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.meta}>{draftMetaLine(item)}</Text>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      <Text style={styles.problem}>{item.originalProblem}</Text>
    </View>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { backgroundColor: t.background, flex: 1 },
    list: { gap: 12, padding: 16 },
    header: { gap: 10, paddingBottom: 4 },
    centered: { flex: 1, gap: 10, justifyContent: "center", padding: 24 },
    title: { color: t.textPrimary, fontSize: 22, fontWeight: "700" },
    hint: { color: t.textSecondary, fontSize: 13, lineHeight: 18 },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 12,
      borderWidth: 1,
      gap: 6,
      padding: 14,
    },
    cardTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "600" },
    meta: { color: t.textMuted, fontSize: 12 },
    badge: {
      alignSelf: "flex-start",
      backgroundColor: t.warningSoft,
      borderRadius: 999,
      color: t.textPrimary,
      fontSize: 11,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    problem: { color: t.textSecondary, fontSize: 13, lineHeight: 18 },
    errorCard: {
      alignItems: "flex-start",
      backgroundColor: t.dangerSoft,
      borderRadius: 12,
      gap: 10,
      padding: 14,
    },
    errorText: { color: t.danger, fontSize: 13, lineHeight: 18 },
    retry: {
      borderColor: t.danger,
      borderRadius: 9,
      borderWidth: 1,
      paddingHorizontal: 11,
      paddingVertical: 7,
    },
    retryText: { color: t.danger, fontWeight: "600" },
    pressed: { opacity: 0.7 },
  });
}
