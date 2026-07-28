import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { env } from "@/config/env";
import { getApiHealth } from "@/lib/api/health";

export default function HomeScreen() {
  const health = useQuery({
    queryKey: ["api-health"],
    queryFn: getApiHealth,
    retry: false,
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>TEREPI RENDSZER</Text>
          <Text style={styles.title}>A mobil fejlesztői alap elkészült.</Text>
          <Text style={styles.subtitle}>
            Expo Router, biztonságos token-tárolás, offline SQLite, hálózatfigyelés
            és push értesítési függőségek készen állnak a következő modulokra.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Környezet</Text>
          <DiagnosticRow label="Alkalmazás" value={env.appEnvironment} />
          <DiagnosticRow label="API" value={env.apiUrl} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>API-kapcsolat</Text>
          {health.isPending ? (
            <ActivityIndicator color="#52d6c7" />
          ) : (
            <Text style={health.isSuccess ? styles.success : styles.error}>
              {health.isSuccess
                ? `Elérhető · ${health.data.status}`
                : health.error instanceof Error
                  ? health.error.message
                  : "Az API nem érhető el."}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => void health.refetch()}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>Kapcsolat újraellenőrzése</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#071827",
  },
  container: {
    padding: 20,
    gap: 16,
  },
  hero: {
    paddingVertical: 20,
    gap: 10,
  },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  title: {
    color: "#f4fbff",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
  },
  subtitle: {
    color: "#b7cedd",
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    backgroundColor: "#0b263d",
    borderColor: "#164668",
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  cardTitle: {
    color: "#f4fbff",
    fontSize: 18,
    fontWeight: "700",
  },
  row: {
    gap: 4,
  },
  label: {
    color: "#7ea3b9",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  value: {
    color: "#d9edf7",
    fontSize: 14,
  },
  success: {
    color: "#52d6c7",
    fontSize: 15,
    fontWeight: "700",
  },
  error: {
    color: "#ff9f92",
    fontSize: 15,
    lineHeight: 21,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#166a7a",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
});
