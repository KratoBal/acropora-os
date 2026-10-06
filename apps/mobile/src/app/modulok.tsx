import { Redirect, useRouter, type Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "@/components/home/BottomNav";
import { ModuleTile } from "@/components/home/ModuleTile";
import { useNavigationCounters } from "@/components/home/useNavigationCounters";
import { tileBadge } from "@/lib/navigation/counters";
import { useAuth } from "@/lib/auth/AuthProvider";
import { servedTileIds, tileVisible } from "@/lib/auth/tile-visibility";
import { HOME_MODULES, launcherModules } from "@/lib/home/modules";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * MODULOK: EVERY MODULE THIS USER MAY OPEN (mobile Home V1, phase 1).
 *
 * The Home leads with the handful its view puts first; this screen has all of
 * them, so a module outside the view is never out of reach. The same rule as
 * the Home: the server's served navigation decides what is here, and a module
 * without a mobile screen is left out, because a tile that leads nowhere is
 * not shown (owner's answer 4, 2026-10-02).
 */
export default function ModulesScreen() {
  const router = useRouter();
  const { status, user, retryRestore } = useAuth();
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const counters = useNavigationCounters();

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;

  const servedIds = servedTileIds(user);
  const modules = launcherModules((code) => tileVisible(servedIds, code));

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        {modules.length === 0 ? (
          /*
            THE SAME ZERO STATE AS THE HOME, AND FOR THE SAME REASON: an empty
            list looks exactly like a user without permissions, so the text
            says it is not about permissions, and the retry asks for the menu
            again without signing out.
          */
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nincs megjeleníthető modul</Text>
            <Text style={styles.emptyText}>
              A kiszolgáló nem küldött menüt ehhez a munkamenethez. Ez nem a
              jogosultságaiddal függ össze: próbáld újra, és ha így marad, szólj
              a rendszergazdának.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Menü újrakérése"
              onPress={retryRestore}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Újrapróbálás</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.modules}>
            {modules.map((code) => {
              const entry = HOME_MODULES[code];
              return (
                <ModuleTile
                  key={code}
                  module={entry}
                  badge={tileBadge(code, counters)}
                  onPress={() => {
                    if (entry.route) router.push(entry.route as Href);
                  }}
                />
              );
            })}
          </View>
        )}
      </ScrollView>
      <BottomNav active="modules" />
    </SafeAreaView>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.background },
    container: { padding: 20, paddingBottom: 28 },
    modules: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 12,
    },
    emptyCard: {
      backgroundColor: t.dangerSoft,
      borderColor: t.danger,
      borderRadius: 18,
      borderWidth: 1,
      gap: 9,
      padding: 18,
    },
    emptyTitle: { color: t.danger, fontSize: 17, fontWeight: "800" },
    emptyText: { color: t.textSecondary, fontSize: 13, lineHeight: 20 },
    retryButton: {
      alignSelf: "flex-start",
      borderColor: t.danger,
      borderRadius: 9,
      borderWidth: 1,
      marginTop: 4,
      paddingHorizontal: 11,
      paddingVertical: 7,
    },
    retryText: { color: t.danger, fontSize: 12, fontWeight: "800" },
  });
}
