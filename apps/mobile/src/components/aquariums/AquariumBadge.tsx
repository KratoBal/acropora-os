import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * KIS JELVÉNY (Tulajdon, Típus, Víztípus) -- A FIGMA-TERV (make-2) SZERKEZETE.
 *
 * A SZÍNEK 2026-09-24-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK (Balázs
 * döntése, emlék 1816): ez a komponens az akvárium-képernyők része, tehát
 * MÁR MOST világos/sötét módban is helyesen jelenik meg, a telefon
 * beállítása vagy a rendszer szerint.
 */
export function AquariumBadge({
  children,
  tone = "grey",
}: {
  children: string;
  tone?: "teal" | "grey";
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={[styles.badge, tone === "teal" && styles.teal]}>
      <Text style={[styles.text, tone === "teal" && styles.tealText]}>
        {children}
      </Text>
    </View>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    badge: {
      alignSelf: "flex-start",
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    teal: { backgroundColor: t.accentSoft, borderColor: t.accentBorder },
    text: { color: t.textSecondary, fontSize: 11, fontWeight: "700" },
    tealText: { color: t.accentSoftText },
  });
}
