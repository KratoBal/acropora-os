import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { LockReason } from "@/lib/auth/restore-session";

/**
 * Shown when a usable session is on the device but the owner has not been
 * confirmed. Deliberately not the login screen: there is a session here,
 * and on most phones one glance reopens it.
 *
 * The gate can be shut for three different reasons, and they do not
 * deserve the same screen:
 *
 * - nobody has been asked yet (came back from the background) - ask
 *   immediately, without making anyone tap first;
 * - the attempt ran and failed - offer another one;
 * - the device has no biometrics to offer - offer nothing, because a
 *   button that cannot work is worse than no button.
 */
export function LockedScreen({
  displayName,
  reason,
  onUnlock,
  onSignOut,
}: {
  displayName?: string;
  reason: LockReason | null;
  onUnlock: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [attempting, setAttempting] = useState(false);
  const askedOnArrival = useRef(false);

  const canTryBiometrics = reason !== "unavailable";

  // One automatic attempt when the screen appears with nothing tried yet.
  // Guarded by a ref rather than by state so a re-render cannot start a
  // second prompt on top of the first.
  useEffect(() => {
    if (askedOnArrival.current || reason !== null) return;
    askedOnArrival.current = true;
    setAttempting(true);
    void onUnlock().finally(() => setAttempting(false));
  }, [reason, onUnlock]);

  const attempt = () => {
    setAttempting(true);
    void onUnlock().finally(() => setAttempting(false));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.eyebrow}>ACROPORA OS</Text>
        <Text style={styles.title}>Zárolva</Text>
        <Text style={styles.text}>
          {displayName
            ? `${displayName} munkamenete nyitva van, csak meg kell erősíteni, hogy te vagy az.`
            : "A munkamenet nyitva van, csak meg kell erősíteni, hogy te vagy az."}
        </Text>

        {canTryBiometrics ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Feloldás"
            accessibilityState={{ disabled: attempting }}
            disabled={attempting}
            onPress={attempt}
            style={({ pressed }) => [
              styles.primaryButton,
              attempting && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
          >
            {attempting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Feloldás</Text>
            )}
          </Pressable>
        ) : (
          <Text style={styles.note}>
            Ezen a készüléken nincs beállítva arc- vagy ujjlenyomat-azonosítás,
            ezért jelszóval tudsz belépni.
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Belépés jelszóval"
          onPress={onSignOut}
          style={({ pressed }) => [
            styles.textButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.textButtonLabel}>Belépés jelszóval</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  title: { color: "#f4fbff", fontSize: 24, fontWeight: "800" },
  text: {
    color: "#a9c4d1",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  note: {
    color: "#9ab8ca",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#177b74",
    borderRadius: 12,
    marginTop: 6,
    minWidth: 180,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  buttonDisabled: { opacity: 0.6 },
  textButton: { paddingHorizontal: 12, paddingVertical: 10 },
  textButtonLabel: { color: "#6de0ce", fontSize: 14, fontWeight: "700" },
  pressed: { opacity: 0.75 },
});
