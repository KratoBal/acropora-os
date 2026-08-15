import { useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AssetCard } from "@/components/assets/AssetCard";
import { listAssets } from "@/lib/api/assets";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

export default function AssetListScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const query = useQuery({
    queryKey: ["service-assets", { page: 1, pageSize: 50 }],
    queryFn: () => listAssets(1, 50),
    enabled: status === "authenticated" && Boolean(capabilities?.assetsView),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.assetsView) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <FlatList
        data={query.data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.container}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.eyebrow}>ASSET MANAGEMENT</Text>
            <Text style={styles.title}>Partnereszközök</Text>
            <Text style={styles.subtitle}>
              Húzd le a listát a frissítéshez, vagy olvasd le a matricán lévő
              QR-kódot a telefon kamerájával.
            </Text>
          </View>
        }
        ListEmptyComponent={
          query.isPending ? (
            <ActivityIndicator color="#52d6c7" />
          ) : query.isError ? (
            <View style={styles.messageCard}>
              <Text style={styles.errorTitle}>Az eszközök nem tölthetők be</Text>
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
              <Text style={styles.errorTitle}>Még nincs aktív eszköz</Text>
              <Text style={styles.messageText}>
                Az adminfelületen rögzített partnereszközök itt jelennek meg.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <AssetCard
            asset={item}
            onPress={() =>
              router.push({ pathname: "/assets/[id]", params: { id: item.id } })
            }
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 36 },
  header: { marginBottom: 20 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  title: { color: "#f4fbff", fontSize: 28, fontWeight: "900", marginTop: 6 },
  subtitle: { color: "#91afbe", fontSize: 14, lineHeight: 21, marginTop: 6 },
  separator: { height: 12 },
  messageCard: {
    borderRadius: 18,
    backgroundColor: "#0d2b40",
    borderWidth: 1,
    borderColor: "#1c4963",
    padding: 18,
    gap: 8,
  },
  errorTitle: { color: "#f4fbff", fontSize: 17, fontWeight: "800" },
  messageText: { color: "#a9c4d1", lineHeight: 20 },
  button: {
    alignSelf: "flex-start",
    borderRadius: 10,
    backgroundColor: "#177b74",
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 5,
  },
  buttonText: { color: "white", fontWeight: "800" },
});
