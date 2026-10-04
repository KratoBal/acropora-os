import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BOTTOM_NAV_ITEMS, type BottomNavItem } from "@/lib/home/bottom-nav";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

import { ModuleIcon } from "./ModuleIcon";

/**
 * THE BOTTOM BAR (Figma 412:3): the same items for everyone, in the same
 * order (`BOTTOM_NAV_ITEMS`); the screen only says which one it is.
 *
 * It sits on the screens of the existing Stack instead of a tab navigator, so
 * every route and deep link stays where it is (discovery §5). `navigate`
 * returns to a screen already in the stack rather than stacking a copy.
 */
export function BottomNav({
  active,
}: {
  /**
   * `null` ON THE SERVICE SCREENS (decision E9, 2026-10-04): the jobs and
   * worksheets belong under "Feladatok", which comes with the Home's phase
   * 2; until then no item is lit there.
   */
  active: BottomNavItem["key"] | null;
}) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <SafeAreaView edges={["bottom"]} style={styles.bar}>
      <View accessibilityRole="tablist" style={styles.row}>
        {BOTTOM_NAV_ITEMS.map((item) => {
          const selected = item.key === active;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onPress={() => {
                if (!selected) router.navigate(item.route);
              }}
              style={styles.item}
            >
              <View style={[styles.iconWrap, selected && styles.iconActive]}>
                <ModuleIcon
                  name={item.icon}
                  size={22}
                  color={selected ? tokens.accent : tokens.textMuted}
                />
              </View>
              <Text style={[styles.label, selected && styles.labelActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    bar: {
      backgroundColor: t.surface,
      borderTopColor: t.border,
      borderTopWidth: 1,
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-around",
      paddingTop: 8,
      paddingBottom: 4,
    },
    item: { alignItems: "center", gap: 2, minWidth: 64 },
    iconWrap: {
      alignItems: "center",
      borderRadius: 8,
      height: 28,
      justifyContent: "center",
      width: 32,
    },
    iconActive: { backgroundColor: t.accentSoft },
    label: { color: t.textMuted, fontSize: 12 },
    labelActive: { color: t.accent, fontWeight: "600" },
  });
}
