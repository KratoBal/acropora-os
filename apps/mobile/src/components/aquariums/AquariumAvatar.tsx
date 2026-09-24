import { StyleSheet, Text, View } from "react-native";

import { avatarColorFor, initialsFor } from "@/lib/aquariums/aquarium-avatar";

/** KARBANTARTÓ KÖR, KEZDŐBETŰKKEL -- a Figma-terv "Karbantartók" avataraiból,
 * a mai sötét témával. A szín-logika `aquarium-avatar.ts`-ben él, mérhetően. */
export function AquariumAvatar({
  displayName,
  userId,
}: {
  displayName: string;
  userId: string;
}) {
  return (
    <View style={[styles.circle, { backgroundColor: avatarColorFor(userId) }]}>
      <Text style={styles.text}>{initialsFor(displayName)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: "#fff", fontSize: 11, fontWeight: "800" },
});
