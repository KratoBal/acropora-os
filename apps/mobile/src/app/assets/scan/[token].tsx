import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useEffect } from "react";

import { scanAsset } from "@/lib/api/assets";
import { describeScanFailure } from "@/lib/assets/scan-failure";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  readCachedAssetByToken,
  rememberAssetDetail,
} from "@/lib/offline/asset-cache";

export default function AssetScanScreen() {
  const params = useLocalSearchParams<{ token: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status } = useAuth();
  const query = useQuery({
    queryKey: ["service-asset-scan", token],
    queryFn: () => scanAsset(token!),
    enabled: status === "authenticated" && Boolean(token),
    retry: false,
  });

  /*
   * A MATRICA FELOLDÁSA TÉRERŐ NÉLKÜL.
   *
   * A készüléken tárolt másolat a `qrToken` mezőt is tartalmazza -- a szerver
   * pontosan ezért küldi a listán is --, tehát a beolvasott kódról offline is
   * meg tudjuk mondani, melyik eszköz az. A keresés CSAK akkor indul, ha a
   * szerverhez fordulás elhasalt: amíg van válasz, az a friss.
   */
  const cached = useQuery({
    queryKey: ["offline-scan", token],
    queryFn: () => readCachedAssetByToken(token!),
    enabled: query.isError && Boolean(token),
  });

  // Amit a matricáról nyitottak meg, az legyen meg a következő alkalomra is.
  useEffect(() => {
    if (!query.data) return;
    void rememberAssetDetail(query.data);
  }, [query.data]);

  const cachedId = cached.data?.detail?.id ?? cached.data?.summary?.id ?? null;

  if (status !== "authenticated")
    return token ? (
      <Redirect href={{ pathname: "/login", params: { assetToken: token } }} />
    ) : (
      <Redirect href="/login" />
    );
  if (query.data)
    return (
      <Redirect
        href={{ pathname: "/assets/[id]", params: { id: query.data.id } }}
      />
    );

  /*
   * A MENTETT PÉLDÁNYRA UGRUNK. Az adatlap maga mondja ki, hogy mentett
   * másolatot mutat, és azt is, ha csak a listasor van meg -- itt tehát nem
   * kell külön üzenet, csak a feloldás.
   */
  if (cachedId)
    return (
      <Redirect href={{ pathname: "/assets/[id]", params: { id: cachedId } }} />
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.card}>
        {query.isError && !cached.isPending ? (
          <ScanFailureCard
            error={query.error}
            searchedOfflineCopy={cached.isSuccess}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <ActivityIndicator color="#52d6c7" size="large" />
            <Text style={styles.title}>Eszköz azonosítása…</Text>
            <Text style={styles.text}>
              A QR-kódot biztonságosan ellenőrizzük az Acropora OS-ben.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

/**
 * Says which of the two failures happened. Without the distinction the
 * screen blamed the sticker for a missing signal, and someone standing in
 * a basement would go and replace a QR code that was never broken.
 */
function ScanFailureCard({
  error,
  searchedOfflineCopy,
  onRetry,
}: {
  error: unknown;
  searchedOfflineCopy: boolean;
  onRetry(): void;
}) {
  const failure = describeScanFailure(error, { searchedOfflineCopy });
  return (
    <>
      <Text style={styles.title}>{failure.title}</Text>
      <Text style={styles.text}>{failure.message}</Text>
      {failure.canRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Beolvasás újrapróbálása"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.retryText}>Újrapróbálás</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#071827",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#1c4963",
    backgroundColor: "#0d2b40",
    padding: 28,
    gap: 12,
  },
  title: {
    color: "#f4fbff",
    fontSize: 21,
    fontWeight: "900",
    textAlign: "center",
  },
  text: { color: "#a9c4d1", fontSize: 14, lineHeight: 21, textAlign: "center" },
  retryButton: {
    backgroundColor: "#177b74",
    borderRadius: 10,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  retryText: { color: "#fff", fontWeight: "800" },
  pressed: { opacity: 0.7 },
});
