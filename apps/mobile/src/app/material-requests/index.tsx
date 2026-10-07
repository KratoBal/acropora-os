import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { RequestCard } from "@/components/material-requests/MaterialRequestParts";
import { ApiError } from "@/lib/api/client";
import {
  getMaterialRequestSummary,
  listMaterialRequestOverview,
} from "@/lib/api/material-requests";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import {
  MATERIAL_REQUEST_REFRESH_MS,
  MOBILE_EMPTY_MESSAGE,
  MOBILE_SEGMENTS,
  MOBILE_SEGMENT_LABEL,
  headerSummary,
  newRequestsBanner,
  segmentView,
  type MobileSegment,
} from "@/lib/material-requests/v2-presentation";
import type { ThemeTokens } from "@/lib/theme/tokens";
import { useAppTheme } from "@/lib/theme/useAppTheme";

/**
 * ANYAGIGÉNYEK, V2 LIST (Figma 404:369).
 *
 * The three segments (active, mine, received), the header counts and the
 * "új vár átvételre" bar all come from the server, scoped to the worksheets
 * this user can see. A failed read is an error, never an empty list.
 *
 * Left out on purpose (owner, 2026-10-02): "+ Új igény" (a request starts
 * only on a worksheet) and the Figma's bottom tab bar (the app has none).
 *
 * The tile stays where the server menu puts it (`material-requests-pending`,
 * `service.manage`); a partner technician gets the server's 403 and a
 * readable sentence, not a list.
 */
export default function MaterialRequestsScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const capabilities = user ? getServiceCapabilities(user) : null;
  const enabled = Boolean(
    capabilities?.worksheetsView && status === "authenticated",
  );
  const [segment, setSegment] = useState<MobileSegment>("active");
  const [now, setNow] = useState(() => new Date());

  const summary = useQuery({
    queryKey: ["material-requests", "summary"],
    queryFn: getMaterialRequestSummary,
    enabled,
    refetchInterval: MATERIAL_REQUEST_REFRESH_MS,
  });
  const list = useInfiniteQuery({
    queryKey: ["material-requests", "overview", segment],
    queryFn: ({ pageParam }) =>
      listMaterialRequestOverview({
        view: segmentView(segment),
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled,
    refetchInterval: MATERIAL_REQUEST_REFRESH_MS,
    retry: (failureCount, cause) =>
      !(cause instanceof ApiError && cause.status === 403) && failureCount < 2,
  });

  const { refetch: refetchList } = list;
  const { refetch: refetchSummary } = summary;
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      void refetchList();
      void refetchSummary();
    }, [refetchList, refetchSummary]),
  );

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.worksheetsView) return <Redirect href="/" />;

  const forbidden = list.error instanceof ApiError && list.error.status === 403;
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = summary.data ?? null;
  const subtitle = headerSummary(counts);
  const banner = newRequestsBanner(counts);

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => {
              setNow(new Date());
              void list.refetch();
              void summary.refetch();
            }}
            tintColor={tokens.accent}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Anyagigények</Text>
          {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
        </View>

        <View style={styles.segments} accessibilityRole="tablist">
          {MOBILE_SEGMENTS.map((option) => {
            const active = option === segment;
            return (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setSegment(option)}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    active && styles.segmentTextActive,
                  ]}
                >
                  {MOBILE_SEGMENT_LABEL[option]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {banner ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{banner}</Text>
          </View>
        ) : null}

        {forbidden ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Az anyagigények belsős kollégáknak érhetők el
            </Text>
            <Text style={styles.muted}>
              Ehhez a listához nincs jogosultságod.
            </Text>
          </View>
        ) : list.isPending ? (
          <ActivityIndicator color={tokens.accent} />
        ) : list.isError ? (
          <Text style={styles.error}>
            Az anyagigények jelenleg nem tölthetők be. Húzd le a frissítéshez.
          </Text>
        ) : items.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.muted}>{MOBILE_EMPTY_MESSAGE[segment]}</Text>
          </View>
        ) : (
          <>
            {items.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                now={now}
                onPress={() =>
                  router.push({
                    pathname: "/material-requests/request/[id]",
                    params: { id: request.id },
                  })
                }
              />
            ))}
            {list.hasNextPage ? (
              <Pressable
                accessibilityRole="button"
                disabled={list.isFetchingNextPage}
                onPress={() => void list.fetchNextPage()}
                style={[
                  styles.moreButton,
                  list.isFetchingNextPage && styles.disabled,
                ]}
              >
                <Text style={styles.moreText}>
                  {list.isFetchingNextPage
                    ? "Betöltés…"
                    : "Továbbiak betöltése"}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 16, paddingBottom: 48, gap: 12 },
    header: { gap: 2, marginBottom: 4 },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "800" },
    muted: { color: t.textSecondary, fontSize: 12 },
    segments: { flexDirection: "row", gap: 6 },
    segment: {
      backgroundColor: t.surface,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    segmentActive: { backgroundColor: t.accentSoft },
    segmentText: { color: t.textSecondary, fontSize: 12, fontWeight: "700" },
    segmentTextActive: { color: t.accentSoftText },
    banner: {
      backgroundColor: t.warningSoft,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    bannerText: { color: t.warning, fontSize: 14, fontWeight: "700" },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 14,
      gap: 6,
      padding: 14,
    },
    cardTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "700" },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
    moreButton: {
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
    },
    moreText: {
      color: t.textPrimary,
      fontWeight: "700",
      textAlign: "center",
    },
    disabled: { opacity: 0.55 },
  });
}
