import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Shown while `AuthProvider` is checking SecureStore + `/auth/me` at app
 * start. Rendered instead of the route Stack entirely (see
 * src/app/_layout.tsx), so neither the login screen nor the authenticated
 * home screen ever mounts — and therefore never flashes — while a valid
 * token is still being confirmed.
 */
export function RestoringScreen({
  networkError,
  onRetry,
}: {
  networkError: boolean;
  onRetry: () => void;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.eyebrow}>ACROPORA OS</Text>
        <Text style={styles.title}>Terepi rendszer</Text>

        {networkError ? (
          <View style={styles.statusBlock}>
            <Text style={styles.errorText}>
              Nem sikerült kapcsolódni a szerverhez a munkamenet ellenőrzéséhez.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kapcsolat újrapróbálása"
              onPress={onRetry}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonText}>Újrapróbálás</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.statusBlock}>
            <ActivityIndicator color="#52d6c7" />
            <Text style={styles.statusText}>Munkamenet ellenőrzése…</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#071827",
  },
  container: {
    alignItems: "center",
    flex: 1,
    gap: 16,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  title: {
    color: "#f4fbff",
    fontSize: 24,
    fontWeight: "800",
  },
  statusBlock: {
    alignItems: "center",
    gap: 12,
    marginTop: 24,
  },
  statusText: {
    color: "#b7cedd",
    fontSize: 14,
  },
  errorText: {
    color: "#ff9f92",
    fontSize: 14,
    textAlign: "center",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#166a7a",
    borderRadius: 12,
    paddingHorizontal: 20,
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
