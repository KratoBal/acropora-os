import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
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
import { describeRegistrationOutcome } from "@/lib/notifications/push-registration";
import { usePushPreference } from "@/lib/notifications/usePushPreference";
import type { ThemePreference } from "@/lib/theme/theme-preference";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * BEÁLLÍTÁSOK.
 *
 * A Face ID zár kapcsolója SZÁNDÉKOSAN nincs itt: az biztonsági védelmet
 * venne le egy olyan készülékről, amin partner-eszközök és munkalapok
 * látszanak, és a gazda döntésére vár. Ha itt állna kiszürkítve, az azt
 * ígérné, hogy hamarosan jön.
 *
 * A KAPCSOLÓ NEM CSAK A TELEFONON JEGYEZ FEL VALAMIT. Kikapcsoláskor a
 * készülék tokenje LEKERÜL a szerverről is: amíg a token a táblában van, a
 * küldő oda is küld, tehát egy pusztán helyi jelölő mellett az értesítés
 * tovább érkezne. Egy kapcsoló, ami hazudik, rosszabb, mint a hiányzó
 * kapcsoló.
 *
 * A MEGJELENÉS VÁLASZTÓ (Világos/Sötét/Rendszer szerint, 2026-09-24, Balázs
 * döntése az emlék 1816 szerint) EZEN A KÉPERNYŐN 2026-09-24-IG SZÁNDÉKOSAN
 * NEM VÁLTOTT MEGJELENÉST MÁSHOL: ekkor MÉG csak az akvárium-képernyők
 * épültek rá (`useAppTheme`). A Figma 12. kör (2026-09-25) ezt a lapot IS
 * ráépíti, és a lenti magyarázó szöveg innentől azt mondja, ami igaz: a
 * választás az EGÉSZ appra hat.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const push = usePushPreference();
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme.tokens), [theme.tokens]);
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
      /*
        A NEGY KIMENETEL NEGY KULON MONDAT. Eddig EGY kozos mondat allt itt, es
        az Androidon valoszinuleg HAMIS: ha a keszulek ad tokent, de az nem
        APNs-alaku, akkor VAN engedely ES van push -- csak az alak-szabaly
        utasitja el. Egy hamis magyarazat rosszabb a hianyzonal: aki elolvassa,
        az engedelyeket fogja piszkalni, es soha nem jut el az igazi okig.
      */
      const uzenet = describeRegistrationOutcome(outcome);
      if (uzenet) setError(uzenet);
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
              <ActivityIndicator color={theme.tokens.accent} />
            ) : (
              <Switch
                value={enabled}
                onValueChange={(next) => void toggle(next)}
                trackColor={{
                  false: theme.tokens.border,
                  true: theme.tokens.accent,
                }}
                thumbColor={theme.tokens.textOnAccent}
              />
            )}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.rowTitle}>Megjelenés</Text>
          <Text style={styles.rowHint}>
            Ezután az egész app ezt a beállítást követi.
          </Text>
          {theme.loading ? (
            <ActivityIndicator
              color={theme.tokens.accent}
              style={styles.themeLoading}
            />
          ) : (
            <ThemeChoice
              value={theme.preference ?? "system"}
              onChange={(value) => void theme.save(value)}
            />
          )}
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

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Világos" },
  { value: "dark", label: "Sötét" },
  { value: "system", label: "Rendszer szerint" },
];

/**
 * SAJÁT `useAppTheme()`-HÍVÁS: ez a segédkomponens a fő függvényen KÍVÜL áll,
 * tehát nem éri el annak per-render `styles` állandóját -- ugyanaz a minta,
 * mint a `worksheets/new.tsx` `Section`/`FieldError` segédkomponensei.
 */
function ThemeChoice({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.themeRow}>
      {THEME_OPTIONS.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          style={[
            styles.themeChip,
            value === option.value && styles.themeChipSelected,
          ]}
        >
          <Text
            style={[
              styles.themeChipText,
              value === option.value && styles.themeChipTextSelected,
            ]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- Figma 12.
 * kör, ugyanaz a minta, mint a `login.tsx`-en (lásd ott a teljes indokot).
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { gap: 12, padding: 18, paddingBottom: 48 },
    eyebrow: {
      color: t.accent,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.4,
    },
    title: { color: t.textPrimary, fontSize: 26, fontWeight: "900" },
    subtitle: { color: t.textSecondary, fontSize: 13 },
    card: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 16,
      borderWidth: 1,
      marginTop: 8,
      padding: 16,
    },
    row: { alignItems: "center", flexDirection: "row", gap: 14 },
    rowText: { flex: 1, gap: 5 },
    rowTitle: { color: t.textPrimary, fontSize: 16, fontWeight: "800" },
    rowHint: { color: t.textSecondary, fontSize: 12, lineHeight: 18 },
    error: {
      backgroundColor: t.dangerSoft,
      borderRadius: 10,
      color: t.danger,
      fontSize: 12,
      lineHeight: 18,
      padding: 12,
    },
    back: {
      alignSelf: "flex-start",
      borderColor: t.border,
      borderRadius: 10,
      borderWidth: 1,
      marginTop: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    backText: { color: t.textSecondary, fontSize: 13, fontWeight: "700" },
    pressed: { opacity: 0.75 },
    themeLoading: { marginTop: 10, alignSelf: "flex-start" },
    themeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    themeChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    themeChipSelected: { backgroundColor: t.accent, borderColor: t.accent },
    themeChipText: { color: t.textSecondary, fontSize: 13, fontWeight: "700" },
    themeChipTextSelected: { color: t.textOnAccent },
  });
}
