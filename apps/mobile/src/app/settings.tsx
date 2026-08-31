import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  forgetDeviceToken,
  registerDeviceToken,
} from "@/lib/api/notifications";
import { useAuth } from "@/lib/auth/AuthProvider";
import { personDisplayName } from "@/lib/auth/person-name";
import {
  currentBundleId,
  obtainDeviceToken,
} from "@/lib/notifications/push-device";
import { usePushPreference } from "@/lib/notifications/usePushPreference";

/**
 * BEÁLLÍTÁSOK, EGYETLEN KAPCSOLÓVAL.
 *
 * A képernyő ma csak az értesítést kapcsolja. A Face ID zár kapcsolója
 * SZÁNDÉKOSAN nincs itt: az biztonsági védelmet venne le egy olyan
 * készülékről, amin partner-eszközök és munkalapok látszanak, és a gazda
 * döntésére vár. Ha itt állna kiszürkítve, az azt ígérné, hogy hamarosan jön.
 *
 * A KAPCSOLÓ NEM CSAK A TELEFONON JEGYEZ FEL VALAMIT. Kikapcsoláskor a
 * készülék tokenje LEKERÜL a szerverről is: amíg a token a táblában van, a
 * küldő oda is küld, tehát egy pusztán helyi jelölő mellett az értesítés
 * tovább érkezne. Egy kapcsoló, ami hazudik, rosszabb, mint a hiányzó
 * kapcsoló.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const push = usePushPreference();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;

  const enabled = push.preference !== "off";

  const toggle = async (next: boolean) => {
    if (busy || push.loading) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await obtainDeviceToken();
      const bundleId = currentBundleId();

      if (next) {
        /*
         * BEKAPCSOLÁSKOR AZONNAL REGISZTRÁLUNK, nem várunk a következő
         * indításra: aki most kapcsolta be, most várja az értesítést.
         */
        if (outcome.status === "ready" && bundleId)
          await registerDeviceToken({ token: outcome.token, bundleId });
      } else if (outcome.status === "ready") {
        await forgetDeviceToken(outcome.token);
      }

      await push.save(next ? "on" : "off");

      /*
       * A TOKEN HIÁNYA NEM HIBA, DE KI VAN MONDVA. Szimulátoron és megtagadott
       * engedélynél nincs token: a beállítás ilyenkor is elmentődik, de a
       * szerveren nincs mit levenni vagy felvenni -- és ezt jobb megmondani,
       * mint azt hinni, hogy megtörtént.
       */
      if (outcome.status !== "ready")
        setError(
          "A beállítás elmentve, de ez a készülék most nem tud értesítést fogadni (nincs engedély vagy nincs push a készüléken).",
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A beállítás mentése nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>BEÁLLÍTÁSOK</Text>
        <Text style={styles.title}>{personDisplayName(user)}</Text>
        <Text style={styles.subtitle}>{user.email}</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Értesítések</Text>
              <Text style={styles.rowHint}>
                Munkalap kiosztásakor szól ez a készülék. Kikapcsolva a telefon
                lekerül a szerverről is, tehát tényleg nem érkezik semmi.
              </Text>
            </View>
            {push.loading || busy ? (
              <ActivityIndicator color="#52d6c7" />
            ) : (
              <Switch
                value={enabled}
                onValueChange={(next) => void toggle(next)}
                trackColor={{ false: "#1c4963", true: "#166a7a" }}
                thumbColor="#f4fbff"
              />
            )}
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Text style={styles.backText}>Vissza</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { gap: 12, padding: 18, paddingBottom: 48 },
  eyebrow: {
    color: "#52d6c7",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#f4fbff", fontSize: 26, fontWeight: "900" },
  subtitle: { color: "#91afbe", fontSize: 13 },
  card: {
    backgroundColor: "#0d2b40",
    borderColor: "#1c4963",
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
    padding: 16,
  },
  row: { alignItems: "center", flexDirection: "row", gap: 14 },
  rowText: { flex: 1, gap: 5 },
  rowTitle: { color: "#f4fbff", fontSize: 16, fontWeight: "800" },
  rowHint: { color: "#86a7ba", fontSize: 12, lineHeight: 18 },
  error: {
    backgroundColor: "#3b2b2d",
    borderRadius: 10,
    color: "#ffd0ca",
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
  },
  back: {
    alignSelf: "flex-start",
    borderColor: "#28536a",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backText: { color: "#9ab8ca", fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.75 },
});
