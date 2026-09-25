import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

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
  configProblems,
}: {
  networkError: boolean;
  onRetry: () => void;
  /**
   * What is wrong with the app's configuration, if anything. Takes
   * precedence over everything else on this screen: with no usable server
   * address there is nothing to restore, nothing to retry, and no point
   * showing a spinner. Before this existed the app simply died on launch
   * with no message at all.
   */
  configProblems?: string[];
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.eyebrow}>ACROPORA OS</Text>
        <Text style={styles.title}>Terepi rendszer</Text>

        {configProblems && configProblems.length > 0 ? (
          <View style={styles.statusBlock}>
            <Text style={styles.errorText}>
              Az alkalmazás beállítása hiányos, ezért nem tud elindulni.
            </Text>
            {configProblems.map((problem) => (
              <Text key={problem} style={styles.problemText}>
                {problem}
              </Text>
            ))}
            <Text style={styles.statusText}>
              Ezt az alkalmazás beállításában kell javítani, újraindítással nem
              múlik el. Szólj a fejlesztőnek, és mondd meg neki a fenti sort.
            </Text>
          </View>
        ) : networkError ? (
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
            <ActivityIndicator color={tokens.accent} />
            <Text style={styles.statusText}>Munkamenet ellenőrzése…</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- lásd
 * `apps/mobile/src/app/assets/edit/[id].tsx` fejlécét ugyanerről a
 * jelentésről (Balázs, 2026-09-25 14:48, telefonos fényképek).
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: t.background,
    },
    container: {
      alignItems: "center",
      flex: 1,
      gap: 16,
      justifyContent: "center",
      paddingHorizontal: 24,
    },
    eyebrow: {
      color: t.accent,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 1.6,
    },
    title: {
      color: t.textPrimary,
      fontSize: 24,
      fontWeight: "800",
    },
    statusBlock: {
      alignItems: "center",
      gap: 12,
      marginTop: 24,
    },
    statusText: {
      color: t.textSecondary,
      fontSize: 14,
    },
    errorText: {
      color: t.danger,
      fontSize: 14,
      textAlign: "center",
    },
    problemText: {
      color: t.danger,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
    },
    button: {
      alignItems: "center",
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    buttonPressed: {
      opacity: 0.75,
    },
    buttonText: {
      color: t.textOnAccent,
      fontSize: 14,
      fontWeight: "700",
    },
  });
}
