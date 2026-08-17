import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { scanAsset } from "@/lib/api/assets";
import { useAuth } from "@/lib/auth/AuthProvider";

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.card}>
        {query.isError ? (
          <>
            <Text style={styles.title}>A QR-kód nem azonosítható</Text>
            <Text style={styles.text}>
              {query.error instanceof Error
                ? query.error.message
                : "A kód hibás vagy időközben lecserélték."}
            </Text>
          </>
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
});
