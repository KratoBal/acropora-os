import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * "NINCS KAPCSOLAT" SÁV -- a Figma-terv (make-2, mobil szekció) szerkezete.
 *
 * A SZÍNEK 2026-09-24-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK (Balázs
 * döntése, emlék 1816), a `warning` tokenpárral: a kapcsolat hiánya
 * figyelmeztető jellegű állapot, nem hiba -- a mérés folytatódik, csak
 * később megy fel.
 *
 * NEM UGYANAZ, MINT AZ `OfflineNoticeCard`: az egy MENTETT MÁSOLAT korát írja
 * le, cache-adatból építve. Az akvárium-képernyőknek nincs mentett
 * másolatuk -- ez a sáv egyetlen, fix szövegű jelzés, ami közvetlenül a
 * készülék `useIsOnline()` állapotát mutatja.
 */
export function ConnectivityBanner() {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>Nincs kapcsolat, a mérés később megy el</Text>
    </View>
  );
}

function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    banner: {
      backgroundColor: t.warningSoft,
      borderColor: t.warning,
      borderWidth: 1,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginBottom: 12,
    },
    text: {
      color: t.warning,
      fontSize: 12,
      fontWeight: "700",
      textAlign: "center",
    },
  });
}
