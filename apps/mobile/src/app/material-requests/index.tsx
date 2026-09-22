import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
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
            tintColor="#52d6c7"
          />
        }
      >
        <Text style={styles.eyebrow}>SZERVIZ</Text>
        <Text style={styles.title}>Anyagigények</Text>
        <Text style={styles.subtitle}>
          A rád váró, beszerzésre elküldött anyagigények.
        </Text>

        {pending.isPending ? <ActivityIndicator color="#52d6c7" /> : null}

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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 48, gap: 12 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900" },
  subtitle: { color: "#91afbe" },
  card: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
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
  rowTitle: { color: "#f4fbff", fontSize: 15, fontWeight: "800" },
  link: {
    color: "#6de0ce",
    fontSize: 12,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  muted: { color: "#789cad", fontSize: 12 },
  itemLine: { color: "#f4fbff", fontSize: 14 },
  forbiddenTitle: { color: "#f4fbff", fontSize: 15, fontWeight: "800" },
  error: {
    color: "#fecaca",
    backgroundColor: "#541b2b",
    padding: 12,
    borderRadius: 10,
  },
  receiveButton: {
    backgroundColor: "#177b74",
    borderRadius: 10,
    marginTop: 4,
    padding: 12,
  },
  receiveButtonText: {
    color: "#fff",
    fontWeight: "900",
    textAlign: "center",
  },
  disabled: { opacity: 0.55 },
});
