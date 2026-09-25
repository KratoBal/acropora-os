import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useMemo } from "react";
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

import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";
import {
  listPendingMaterialRequests,
  receiveMaterialRequest,
} from "@/lib/api/material-requests";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";
import { formatDateTime } from "@/lib/orders/presentation";
import {
  describePendingMaterialRequestWorksheet,
  materialRequestByline,
} from "@/lib/worksheets/material-request-presentation";

/**
 * A BESZERZO SAJAT LISTAJA -- "RAM VARO ANYAGIGENYEK".
 *
 * Balazs kerese, 2026-09-22 12:15:46 UTC: "beszerzi az anyagot, majd ha
 * megvan, akkor a sajat feluleten ranyom az anyag beerkezett gombra". Ugyanaz
 * a kepernyo-szereposztas, mint a weben (`material-request-pending-page.tsx`).
 *
 * === KET SZINTU KAPU, ES A MASODIK CSAK A SZERVEREN DOL EL ===
 *
 * A csempe es a menupont a `SERVICE_MANAGE` jogon all (aki munkalapra irhat,
 * latja a menupontot) -- ez a `capabilities.worksheetsManage`, es a kozos
 * `packages/types/src/navigation.ts` `material-requests-pending` tetele adja
 * ki a szervernek megfelelo felhasznaloknak. A LISTA TARTALMA viszont a
 * `MATERIAL_REQUEST_MARK_RECEIVED` per-felhasznalo kepessegen all, amit a
 * telefon (a webhez hasonloan) NEM tud a szerepbol levezetni -- a szerver
 * 403-at ad annak, akinel nincs bejelolve, es ezt a lap KULON, ertelmezheto
 * uzenettel mondja ki, nem altalanos hibakent.
 */
export default function MaterialRequestsPendingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const capabilities = user ? getServiceCapabilities(user.role) : null;

  const pending = useQuery({
    queryKey: ["material-requests-pending"],
    queryFn: listPendingMaterialRequests,
    enabled: Boolean(
      capabilities?.worksheetsManage && status === "authenticated",
    ),
    retry: (failureCount, cause) =>
      !(cause instanceof ApiError && cause.status === 403) && failureCount < 2,
  });

  const receive = useMutation({
    mutationFn: (id: string) => receiveMaterialRequest(id),
    onSuccess: (response) => {
      queryClient.setQueryData(["material-requests-pending"], response);
    },
  });

  if (status !== "authenticated" || !user || !capabilities)
    return <Redirect href="/login" />;
  if (!capabilities.worksheetsManage) return <Redirect href="/" />;

  const forbidden =
    pending.error instanceof ApiError && pending.error.status === 403;
  const items = pending.data?.items ?? [];

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={pending.isRefetching && !pending.isPending}
            onRefresh={() => void pending.refetch()}
            tintColor={tokens.accent}
          />
        }
      >
        <Text style={styles.eyebrow}>SZERVIZ</Text>
        <Text style={styles.title}>Anyagigények</Text>
        <Text style={styles.subtitle}>
          A rád váró, beszerzésre elküldött anyagigények.
        </Text>

        {pending.isPending ? <ActivityIndicator color={tokens.accent} /> : null}

        {forbidden ? (
          <View style={styles.card}>
            <Text style={styles.forbiddenTitle}>
              Ehhez a listához nincs jogosultságod
            </Text>
            <Text style={styles.muted}>
              Csak azok a kollégák látják, akiknél be van jelölve az „anyag
              beérkezett” jelölés joga a felhasználói profilon.
            </Text>
          </View>
        ) : (
          <>
            {pending.isError && !forbidden ? (
              <Text style={styles.error}>
                {pending.error instanceof Error
                  ? pending.error.message
                  : "A lista nem tölthető be."}
              </Text>
            ) : null}

            {!pending.isPending && items.length === 0 && !pending.isError ? (
              <View style={styles.card}>
                <Text style={styles.muted}>
                  Nincs rád váró anyagigény. Amint egy szervizes elküld egy
                  igényt, itt jelenik meg.
                </Text>
              </View>
            ) : null}

            {items.map((request) => (
              <View key={request.id} style={styles.card}>
                <View style={styles.headerRow}>
                  <View style={styles.headerText}>
                    <Text style={styles.rowTitle}>
                      {request.customerDisplayName} · {request.departmentName}
                    </Text>
                    <Text style={styles.muted}>
                      {describePendingMaterialRequestWorksheet(
                        request.worksheetNumber,
                      )}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: "/worksheets/[id]",
                        params: { id: request.worksheetId },
                      })
                    }
                  >
                    <Text style={styles.link}>Munkalap</Text>
                  </Pressable>
                </View>

                <Text style={styles.muted}>
                  {materialRequestByline(request, formatDateTime)}
                </Text>

                {request.items.map((item) => (
                  <Text key={item.id} style={styles.itemLine}>
                    {item.name} — {item.quantity} {item.unit}
                  </Text>
                ))}

                <Pressable
                  accessibilityRole="button"
                  disabled={
                    receive.isPending && receive.variables === request.id
                  }
                  onPress={() => receive.mutate(request.id)}
                  style={[
                    styles.receiveButton,
                    receive.isPending &&
                      receive.variables === request.id &&
                      styles.disabled,
                  ]}
                >
                  <Text style={styles.receiveButtonText}>
                    {receive.isPending && receive.variables === request.id
                      ? "Jelölés…"
                      : "Anyag beérkezett"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- Figma 12.
 * kör, ugyanaz a minta, mint a `login.tsx`-en (lásd ott a teljes indokot).
 * Az `error` doboz régi hexei (`#fecaca`/`#541b2b`) NEM VÉLETLENÜL egyeznek
 * a `t.danger`/`t.dangerSoft` tokenekkel -- a `tokens.ts` saját fejléce
 * kimondja, hogy épp ennek a képernyőnek a piros hibaszíneiből lettek
 * mintázva.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 18, paddingBottom: 48, gap: 12 },
    /*
      A SZÍN A TERV SZÜRKÉJE (grey-400 -> t.textMuted), NEM AZ AKCENT. acrobot
      kérése, 2026-09-25, barracuda mérése alapján: a méret/vastagság/betűköz
      már egyezett a tervvel (`MobileLabel`), csak a szín tért el.
    */
    eyebrow: {
      color: t.textMuted,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.4,
    },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "900" },
    subtitle: { color: t.textSecondary },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: 16,
      gap: 8,
      padding: 14,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 10,
    },
    headerText: { flex: 1, gap: 2 },
    rowTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "800" },
    link: {
      color: t.accentSoftText,
      fontSize: 12,
      fontWeight: "800",
      textDecorationLine: "underline",
    },
    muted: { color: t.textMuted, fontSize: 12 },
    itemLine: { color: t.textPrimary, fontSize: 14 },
    forbiddenTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "800" },
    error: {
      color: t.danger,
      backgroundColor: t.dangerSoft,
      padding: 12,
      borderRadius: 10,
    },
    receiveButton: {
      backgroundColor: t.accent,
      borderRadius: 10,
      marginTop: 4,
      padding: 12,
    },
    receiveButtonText: {
      color: t.textOnAccent,
      fontWeight: "900",
      textAlign: "center",
    },
    disabled: { opacity: 0.55 },
  });
}
