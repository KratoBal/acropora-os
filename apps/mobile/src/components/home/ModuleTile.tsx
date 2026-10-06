import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { HomeModule } from "@/lib/home/modules";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

import { ModuleIcon } from "./ModuleIcon";

/**
 * A MODULE TILE (Figma 412:3, "Mobile Home / Module Tile"): the icon in a soft
 * accent box at the top left, a chevron at the top right, the title, and one
 * line under it. Two tiles to a row (`width: "48%"`).
 *
 * The line under the title is the module's static description in phase 1.
 * The Figma's status line ("7 nyitott · 2 sürgős") comes from the server's
 * summary in phase 2; nothing here invents a number.
 *
 * THE BADGE (card 4a6813db): what waits on me, from the server
 * (`GET /navigation/counters`), next to the chevron. The caller passes the
 * text and what it counts; no badge for none.
 */
export function ModuleTile({
  module,
  onPress,
  badge,
}: {
  module: HomeModule;
  onPress(): void;
  badge?: { label: string; accessibilityLabel: string } | null;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        badge
          ? `${module.title} megnyitása, ${badge.accessibilityLabel}`
          : `${module.title} megnyitása`
      }
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <View style={styles.iconBox}>
          <ModuleIcon name={module.icon} size={18} color={tokens.accent} />
        </View>
        <View style={styles.trailing}>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge.label}</Text>
            </View>
          ) : null}
          <ModuleIcon
            name="chevron-forward"
            size={16}
            color={tokens.textMuted}
          />
        </View>
      </View>
      <Text style={styles.title}>{module.title}</Text>
      <Text style={styles.line} numberOfLines={2}>
        {module.description}
      </Text>
    </Pressable>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    tile: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderRadius: 14,
      borderWidth: 1,
      gap: 6,
      padding: 12,
      width: "48%",
    },
    top: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    iconBox: {
      alignItems: "center",
      backgroundColor: t.accentSoft,
      borderRadius: 8,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    trailing: { alignItems: "center", flexDirection: "row", gap: 4 },
    badge: {
      alignItems: "center",
      backgroundColor: t.accent,
      borderRadius: 10,
      justifyContent: "center",
      minWidth: 20,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    badgeText: { color: "#ffffff", fontSize: 11, fontWeight: "700" },
    title: { color: t.textPrimary, fontSize: 15, fontWeight: "700" },
    line: { color: t.textMuted, fontSize: 12, lineHeight: 16 },
    pressed: { opacity: 0.7 },
  });
}
