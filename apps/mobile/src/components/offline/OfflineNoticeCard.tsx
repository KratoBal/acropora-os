import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { OfflineNotice } from "@/lib/offline/offline-notice";
import { useAppTheme } from "@/lib/theme/useAppTheme";
import type { ThemeTokens } from "@/lib/theme/tokens";

/**
 * A MENTETT MÁSOLAT SÁVJA.
 *
 * Egy offline lista pontosan úgy néz ki, mint egy online. Ez a sáv az egyetlen
 * jel arról, hogy a képernyő nem a szerver mai állapotát mutatja -- ezért nem
 * lehet finom: saját háttere van, és a szöveg megmondja, MIÓTA áll az adat.
 *
 * A szövegek nem itt keletkeznek, hanem az `offline-notice.ts` modulban, ami
 * készülék nélkül is mérhető. Ez a komponens csak megjeleníti őket.
 */
export function OfflineNoticeCard({ notice }: { notice: OfflineNotice }) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.card,
        notice.tone === "offline" && styles.offline,
        notice.tone === "empty" && styles.empty,
      ]}
    >
      <Text
        style={[
          styles.title,
          notice.tone === "offline" && styles.offlineTitle,
          notice.tone === "empty" && styles.emptyTitle,
        ]}
      >
        {notice.title}
      </Text>
      <Text
        style={[
          styles.message,
          notice.tone === "offline" && styles.offlineMessage,
          notice.tone === "empty" && styles.emptyMessage,
        ]}
      >
        {notice.message}
      </Text>
    </View>
  );
}

/**
 * A SZÍNEK 2026-09-25-TŐL A KÖZÖS `useAppTheme()`-BŐL JÖNNEK -- lásd
 * `apps/mobile/src/app/assets/edit/[id].tsx` fejlécét ugyanerről a
 * jelentésről (Balázs, 2026-09-25 14:48, telefonos fényképek).
 *
 * NINCS KÜLÖN "INFO" TOKEN AZ "offline" HANGNEMHEZ, ezért az `accentSoft`
 * családra esik -- ugyanaz a döntés, mint a munkalap-űrlap "notice"/
 * "queued" dobozainál.
 */
function createStyles(t: ThemeTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.warningSoft,
      borderColor: t.warning,
      borderRadius: 14,
      borderWidth: 1,
      gap: 5,
      marginTop: 12,
      padding: 13,
    },
    offline: { backgroundColor: t.accentSoft, borderColor: t.accentBorder },
    empty: { backgroundColor: t.dangerSoft, borderColor: t.danger },
    title: { color: t.warning, fontSize: 14, fontWeight: "800" },
    message: { color: t.textSecondary, fontSize: 12, lineHeight: 18 },
    offlineTitle: { color: t.accentSoftText },
    offlineMessage: { color: t.textSecondary },
    emptyTitle: { color: t.danger },
    emptyMessage: { color: t.textSecondary },
  });
}
