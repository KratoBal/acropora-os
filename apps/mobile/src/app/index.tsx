import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect } from "expo-router";

import { env } from "@/config/env";
import { getApiHealth } from "@/lib/api/health";
import { useAuth } from "@/lib/auth/AuthProvider";

export default function HomeScreen() {
  const { status, user, signOut } = useAuth();
  const health = useQuery({
    queryKey: ["api-health"],
    queryFn: getApiHealth,
    retry: false,
    enabled: status === "authenticated",
  });

  // Stay mounted through "signingOut" so the button below can show its own
  // in-progress state; only bounce to the login screen once the sign-out
  // flow has actually finished (status becomes "unauthenticated").
  if ((status !== "authenticated" && status !== "signingOut") || !user) {
    return <Redirect href="/login" />;
  }

  const signingOut = status === "signingOut";

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>TEREPI RENDSZER</Text>
          <Text style={styles.title}>Szia, {user.displayName}!</Text>
          <Text style={styles.subtitle}>{user.email}</Text>
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
            accessibilityLabel="Kapcsolat újraellenőrzése"
            onPress={() => void health.refetch()}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>Kapcsolat újraellenőrzése</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Napi terepi feladatlista</Text>
          <Text style={styles.noticeText}>
            A napi terepi feladatlista és a ServiceJob-modul egy következő
            checkpointban készül el. Ez a képernyő egyelőre csak a bejelentkezett
            munkamenetet és az API-kapcsolatot mutatja.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kijelentkezés"
          accessibilityState={{ disabled: signingOut }}
          disabled={signingOut}
          onPress={() => void signOut()}
          style={({ pressed }) => [
            styles.signOutButton,
            (pressed || signingOut) && styles.signOutButtonPressed,
          ]}
        >
          {signingOut ? (
            <ActivityIndicator color="#ff9f92" />
          ) : (
            <Text style={styles.signOutButtonText}>Kijelentkezés</Text>
          )}
        </Pressable>
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
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
  },
  subtitle: {
    color: "#b7cedd",
    fontSize: 16,
    lineHeight: 22,
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
  noticeText: {
    color: "#b7cedd",
    fontSize: 14,
    lineHeight: 20,
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
  signOutButton: {
    alignItems: "center",
    borderColor: "#5c2b28",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 12,
  },
  signOutButtonPressed: {
    opacity: 0.7,
  },
  signOutButtonText: {
    color: "#ff9f92",
    fontSize: 15,
    fontWeight: "700",
  },
});
