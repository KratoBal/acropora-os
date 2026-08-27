import { StyleSheet, Text, View } from "react-native";

import type { OfflineNotice } from "@/lib/offline/offline-notice";

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

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#3a2f1c",
    borderColor: "#6b5326",
    borderRadius: 14,
    borderWidth: 1,
    gap: 5,
    marginTop: 12,
    padding: 13,
  },
  offline: { backgroundColor: "#1f3348", borderColor: "#2f5b7d" },
  empty: { backgroundColor: "#3b2b2d", borderColor: "#664047" },
  title: { color: "#ffe6b8", fontSize: 14, fontWeight: "800" },
  message: { color: "#d7c7a6", fontSize: 12, lineHeight: 18 },
  offlineTitle: { color: "#d9edf7" },
  offlineMessage: { color: "#9ab8ca" },
  emptyTitle: { color: "#ffd0ca" },
  emptyMessage: { color: "#dbaea9" },
});
