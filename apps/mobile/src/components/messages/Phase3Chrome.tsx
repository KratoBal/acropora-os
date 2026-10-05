import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * A 3. FÁZIS KÉPERNYŐINEK FEJLÉCE (Figma 454:533, 454:596, 450:474, 450:549,
 * 450:630): vissza-gomb és cím, az „Új üzenet” képernyő mintájára.
 */
export function ScreenHeader({
  title,
  tokens,
}: {
  title: string;
  tokens: ThemeTokens;
}) {
  const router = useRouter();
  const styles = phase3Styles(tokens);
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Vissza"
        onPress={() => router.back()}
        style={styles.back}
      >
        <Ionicons name="chevron-back" size={22} color={tokens.textPrimary} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

/** A 3. fázis képernyőinek közös stílusa. */
export const phase3Styles = (t: ThemeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: t.surface,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    back: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.background,
    },
    title: { flex: 1, color: t.textPrimary, fontSize: 24, fontWeight: "700" },
    content: { padding: 18, gap: 10, paddingBottom: 32 },
    lead: { color: t.textSecondary, fontSize: 14 },
    muted: { color: t.textMuted, fontSize: 13 },
    sectionTitle: {
      color: t.textSecondary,
      fontSize: 13,
      fontWeight: "600",
      marginTop: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
      color: t.textPrimary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
    },
    card: { backgroundColor: t.surface, padding: 12, gap: 4 },
    cardChosen: { backgroundColor: t.warningSoft },
    cardTitle: { color: t.textPrimary, fontSize: 15, fontWeight: "600" },
    cardText: { color: t.textPrimary, fontSize: 14 },
    cardMeta: { color: t.textSecondary, fontSize: 12 },
    link: { color: t.accent, fontSize: 13, fontWeight: "600" },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    error: { color: t.danger, fontSize: 13 },
    notice: {
      color: t.warning,
      backgroundColor: t.warningSoft,
      padding: 10,
      fontSize: 13,
    },
    primary: {
      marginTop: 12,
      backgroundColor: t.warning,
      paddingVertical: 16,
      alignItems: "center",
    },
    primaryDisabled: { opacity: 0.4 },
    primaryText: { color: t.textOnAccent, fontSize: 16, fontWeight: "600" },
    tabs: { flexDirection: "row", gap: 8 },
    tab: {
      flex: 1,
      paddingVertical: 10,
      alignItems: "center",
      backgroundColor: t.surface,
    },
    tabActive: { borderBottomWidth: 2, borderBottomColor: t.warning },
    tabText: { color: t.textSecondary, fontSize: 14 },
    tabTextActive: { color: t.textPrimary, fontWeight: "600" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tile: { width: "31%", aspectRatio: 1, backgroundColor: t.surface },
  });
